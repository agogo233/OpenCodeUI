import { beforeEach, describe, expect, it } from 'vitest'
import { activeSessionStore } from './activeSessionStore'
import type { ScopeStatusGroup } from './activeSessionStore'
import type { SessionStatus, SessionStatusMap } from '../types/api/session'

interface GroupOptions {
  statusMap?: SessionStatusMap
  statusKnown?: boolean
  permissions?: Array<{ id: string; sessionID: string; permission: string; patterns?: string[] }>
  questions?: Array<{ id: string; sessionID: string; questions?: Array<{ header?: string }> }>
  pendingKnown?: boolean
}

const group = (directory: string | undefined, options: GroupOptions = {}): ScopeStatusGroup => ({
  directory,
  statusMap: options.statusMap ?? {},
  statusKnown: options.statusKnown ?? true,
  permissions: options.permissions ?? [],
  questions: options.questions ?? [],
  pendingKnown: options.pendingKnown ?? true,
})

const busy: SessionStatus = { type: 'busy' }

describe('activeSessionStore scope reconciliation', () => {
  beforeEach(() => {
    activeSessionStore.initialize({})
  })

  it('removes finished sessions that are no longer reported within the same scope', () => {
    activeSessionStore.applyScopeSnapshot('local', [
      group('/one', { statusMap: { 'local::root': busy, 'local::child': busy } }),
    ])
    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual([
      'local::root',
      'local::child',
    ])

    activeSessionStore.applyScopeSnapshot('local', [group('/one', { statusMap: { 'local::root': busy } })])

    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual(['local::root'])
  })

  it('keeps sessions from directories outside the refreshed scope', () => {
    activeSessionStore.applyScopeSnapshot('local', [group('/one', { statusMap: { 'local::root': busy } })])

    activeSessionStore.applyScopeSnapshot('local', [group('/two', { statusMap: { 'local::other': busy } })])

    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual([
      'local::root',
      'local::other',
    ])
  })

  it('reconciles unattributed sessions on global snapshots without touching attributed ones', () => {
    activeSessionStore.applyScopeSnapshot('local', [group(undefined, { statusMap: { 'local::boot': busy } })])
    activeSessionStore.applyScopeSnapshot('local', [group('/one', { statusMap: { 'local::root': busy } })])

    // 全局拉取：无归属的 boot 已完成 → 清除；/one 归属的 root 不受影响
    activeSessionStore.applyScopeSnapshot('local', [group(undefined)])

    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual(['local::root'])
  })

  it('does not touch other servers when reconciling one server', () => {
    activeSessionStore.applyScopeSnapshot('local', [group('/one', { statusMap: { 'local::root': busy } })])
    activeSessionStore.applyScopeSnapshot('remote', [group('/one', { statusMap: { 'remote::root': busy } })])

    activeSessionStore.applyScopeSnapshot('local', [group('/one')])

    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual(['remote::root'])
  })

  it('drops pending requests that disappear from their scope and keeps cross-scope ones', () => {
    const permissions = [
      { id: 'perm-a', sessionID: 'local::root', permission: 'edit', patterns: ['src/app.tsx'] },
    ]
    activeSessionStore.applyScopeSnapshot('local', [group('/one', { permissions })])
    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual(['local::root'])
    expect(activeSessionStore.getBusySessions()[0]?.pendingAction).toEqual({
      type: 'permission',
      description: 'edit: src/app.tsx',
    })

    // /two 的拉取不应清掉 /one 的 pending
    activeSessionStore.applyScopeSnapshot('local', [group('/two')])
    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual(['local::root'])

    // /one 再拉取，pending 已消失且服务端不再报 busy → 移出活跃
    activeSessionStore.applyScopeSnapshot('local', [group('/one')])
    expect(activeSessionStore.getBusySessions()).toEqual([])
  })

  it('keeps pending sessions busy across repeated scope refreshes', () => {
    const permissions = [{ id: 'perm-1', sessionID: 'local::child', permission: 'edit', patterns: ['a'] }]
    activeSessionStore.applyScopeSnapshot('local', [group('/one', { permissions })])
    activeSessionStore.applyScopeSnapshot('local', [group('/one', { permissions })])

    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual(['local::child'])
    expect(activeSessionStore.getBusySessions()[0]?.pendingAction).toEqual({
      type: 'permission',
      description: 'edit: a',
    })
  })

  it('tracks pending requests added via SSE events and cleans up on resolve', () => {
    activeSessionStore.addPendingRequest('req-1', 'local::child', 'question', 'Need approval', '/one')
    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual(['local::child'])
    expect(activeSessionStore.getBusySessions()[0]?.pendingAction).toEqual({
      type: 'question',
      description: 'Need approval',
    })

    activeSessionStore.resolvePendingRequest('req-1')
    expect(activeSessionStore.getBusySessions()).toEqual([])
  })

  it('exposes the recorded pending request for compensation lookups', () => {
    activeSessionStore.addPendingRequest('req-1', 'local::child', 'question', 'Need input', '/one')
    expect(activeSessionStore.getPendingRequest('req-1')).toEqual({ sessionId: 'local::child', directory: '/one' })

    activeSessionStore.resolvePendingRequest('req-1')
    expect(activeSessionStore.getPendingRequest('req-1')).toBeUndefined()
    expect(activeSessionStore.getPendingRequest('missing')).toBeUndefined()
  })

  it('keeps busy sessions when updateStatus reports idle with pending requests', () => {
    activeSessionStore.addPendingRequest('req-1', 'local::child', 'question', 'Need approval', '/one')

    activeSessionStore.updateStatus('local::child', { type: 'idle' })
    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual(['local::child'])

    activeSessionStore.resolvePendingRequest('req-1')
    expect(activeSessionStore.getBusySessions()).toEqual([])
  })

  it('reuses the busySessions array reference when a scope refresh changes nothing', () => {
    activeSessionStore.applyScopeSnapshot('local', [group('/one', { statusMap: { 'local::root': busy } })])
    activeSessionStore.setSessionMeta('local::root', 'Root', '/one')

    const first = activeSessionStore.getBusySessionsSnapshot()
    activeSessionStore.applyScopeSnapshot('local', [group('/one', { statusMap: { 'local::root': busy } })])
    const second = activeSessionStore.getBusySessionsSnapshot()

    expect(second).toBe(first)
    expect(second).toEqual([
      {
        sessionId: 'local::root',
        status: { type: 'busy' },
        title: 'Root',
        directory: '/one',
        pendingAction: undefined,
      },
    ])
  })

  it('replaces the busySessions array reference when status content changes', () => {
    activeSessionStore.applyScopeSnapshot('local', [group('/one', { statusMap: { 'local::root': busy } })])
    const first = activeSessionStore.getBusySessionsSnapshot()

    activeSessionStore.updateStatus('local::root', {
      type: 'retry',
      attempt: 1,
      message: 'retrying',
      next: 1000,
    })

    const second = activeSessionStore.getBusySessionsSnapshot()
    expect(second).not.toBe(first)
    expect(second[0]?.status).toEqual({
      type: 'retry',
      attempt: 1,
      message: 'retrying',
      next: 1000,
    })
  })

  it('does not notify subscribers when updateStatus reports an unchanged status', () => {
    activeSessionStore.updateStatus('local::root', { type: 'busy' })
    let notifications = 0
    const unsubscribe = activeSessionStore.subscribe(() => {
      notifications += 1
    })

    activeSessionStore.updateStatus('local::root', { type: 'busy' })
    expect(notifications).toBe(0)

    activeSessionStore.updateStatus('unknown', { type: 'idle' })
    expect(notifications).toBe(0)

    activeSessionStore.updateStatus('local::root', { type: 'idle' })
    expect(notifications).toBe(1)
    unsubscribe()
  })

  it('keeps retry status reported by a scope snapshot', () => {
    activeSessionStore.applyScopeSnapshot('local', [
      group('/one', {
        statusMap: { 'local::root': { type: 'retry', attempt: 2, message: 'rate limited', next: 5000 } },
      }),
    ])

    expect(activeSessionStore.getBusySessions()[0]?.status).toEqual({
      type: 'retry',
      attempt: 2,
      message: 'rate limited',
      next: 5000,
    })
  })

  it('reconciles sessions first reported busy via SSE events on later global snapshots', () => {
    activeSessionStore.updateStatus('local::late', { type: 'busy' })
    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual(['local::late'])

    activeSessionStore.applyScopeSnapshot('local', [group(undefined)])
    expect(activeSessionStore.getBusySessions()).toEqual([])
  })

  it('keeps sessions when the scope status fetch failed and clears only after a successful refresh', () => {
    activeSessionStore.applyScopeSnapshot('local', [group('/one', { statusMap: { 'local::root': busy } })])

    // status 拉取失败：不能当作服务端确认完成，不修剪
    activeSessionStore.applyScopeSnapshot('local', [group('/one', { statusKnown: false })])
    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual(['local::root'])

    // 拉取成功且未报告 → 才清除
    activeSessionStore.applyScopeSnapshot('local', [group('/one')])
    expect(activeSessionStore.getBusySessions()).toEqual([])
  })

  it('keeps pending requests when the scope pending fetch failed', () => {
    const permissions = [{ id: 'perm-1', sessionID: 'local::child', permission: 'edit', patterns: ['a'] }]
    activeSessionStore.applyScopeSnapshot('local', [group('/one', { permissions })])

    // pending 拉取失败：不清 pending，会话保持等待中
    activeSessionStore.applyScopeSnapshot('local', [group('/one', { pendingKnown: false })])
    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual(['local::child'])
    expect(activeSessionStore.getBusySessions()[0]?.pendingAction).toEqual({
      type: 'permission',
      description: 'edit: a',
    })

    // pending 拉取恢复且未返回该请求 → pending 清除，会话无 pending 且未报 busy → 移出
    activeSessionStore.applyScopeSnapshot('local', [group('/one')])
    expect(activeSessionStore.getBusySessions()).toEqual([])
  })

  it('reconciles unattributed sessions against their known meta directory instead of the global snapshot', () => {
    // SSE 先报 busy（无归属），meta 中已登记目录
    activeSessionStore.updateStatus('local::late', { type: 'busy' })
    activeSessionStore.setSessionMeta('local::late', 'Late', '/one')

    // 全局拉取只覆盖其他实例（不含 /one）→ 不能确认 /one 会话完成，保留
    activeSessionStore.applyScopeSnapshot('local', [group(undefined)])
    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual(['local::late'])

    // /one 拉取成功且未报告 → 清除
    activeSessionStore.applyScopeSnapshot('local', [group('/one')])
    expect(activeSessionStore.getBusySessions()).toEqual([])
  })

  it('handles empty scope groups without changes', () => {
    activeSessionStore.applyScopeSnapshot('local', [group('/one', { statusMap: { 'local::root': busy } })])
    const first = activeSessionStore.getBusySessionsSnapshot()

    activeSessionStore.applyScopeSnapshot('local', [])

    expect(activeSessionStore.getBusySessionsSnapshot()).toBe(first)
    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual(['local::root'])
  })

  it('matches server ids containing colons when reconciling', () => {
    activeSessionStore.applyScopeSnapshot('wsl:Ubuntu', [group('/one', { statusMap: { 'wsl:Ubuntu::root': busy } })])
    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual(['wsl:Ubuntu::root'])

    activeSessionStore.applyScopeSnapshot('wsl:Ubuntu', [group('/one')])
    expect(activeSessionStore.getBusySessions()).toEqual([])
  })

  it('lets the last group win when one session appears in multiple groups', () => {
    activeSessionStore.applyScopeSnapshot('local', [
      group('/one', { statusMap: { 'local::root': busy } }),
      group('/two', { statusMap: { 'local::root': { type: 'retry', attempt: 1, message: 'm', next: 1 } } }),
    ])

    expect(activeSessionStore.getBusySessions()[0]?.status).toEqual({
      type: 'retry',
      attempt: 1,
      message: 'm',
      next: 1,
    })
  })
})
