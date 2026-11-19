import { beforeEach, describe, expect, it, vi } from 'vitest'
import { activeSessionStore } from './activeSessionStore'

describe('activeSessionStore scoped refresh handling', () => {
  beforeEach(() => {
    activeSessionStore.reset()
  })

  it('drops same-server sessions missing from the snapshot (snapshot is absolute per server)', () => {
    // 断连期间 child 已结束（active() 只列运行中），快照不含它就必须落 idle——
    // 否则永远卡在 busy（断流恢复后「信息流状态不刷新」的根因）
    activeSessionStore.initialize({
      'local::root': { type: 'busy' },
      'local::child': { type: 'busy' },
    })

    activeSessionStore.applyServerStatusSnapshot('local', {
      'local::root': { type: 'busy' },
    })

    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual(['local::root'])
  })

  it('keeps other servers’ entries when applying one server’s snapshot', () => {
    // keepOtherServers（多服务器 merge 策略）只跨 server 保留，不影响本 server 的绝对语义
    activeSessionStore.initialize({
      'local::root': { type: 'busy' },
      'wsl::child': { type: 'busy' },
    })

    activeSessionStore.applyServerStatusSnapshot('local', {}, { keepOtherServers: true })

    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual(['wsl::child'])
  })

  it('drops missing sessions on full status replacement refreshes', () => {
    activeSessionStore.initialize({
      'local::root': { type: 'busy' },
      'local::child': { type: 'busy' },
    })

    activeSessionStore.initialize({
      'local::root': { type: 'busy' },
    })

    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual(['local::root'])
  })

  it('overrides the snapshot with status events that arrive while the fetch is in flight', () => {
    // 官方 activeUpdates 缓冲同款：拉取窗口内 session 开始运行（事件），
    // 旧快照里没有它——快照应用时事件必须赢，否则 busy 丢失
    activeSessionStore.beginStatusSnapshot('local')
    activeSessionStore.updateStatus('local::late', { type: 'busy' })

    activeSessionStore.applyServerStatusSnapshot('local', {
      'local::root': { type: 'busy' },
    })
    activeSessionStore.endStatusSnapshot('local')

    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId).sort()).toEqual([
      'local::late',
      'local::root',
    ])
  })

  it('an idle event in flight wins over a stale busy snapshot entry', () => {
    activeSessionStore.initialize({
      'local::root': { type: 'busy' },
    })

    activeSessionStore.beginStatusSnapshot('local')
    activeSessionStore.updateStatus('local::root', { type: 'idle' })

    // 快照（拉取开始时发出）仍认为 root 在跑——事件更新更晚，必须覆盖
    activeSessionStore.applyServerStatusSnapshot('local', {
      'local::root': { type: 'busy' },
    })
    activeSessionStore.endStatusSnapshot('local')

    expect(activeSessionStore.getBusySessions()).toEqual([])
  })

  it('keeps existing pending child requests during scoped pending refresh merges', () => {
    activeSessionStore.addPendingRequest('req-child', 'child', 'question', 'Need approval')

    activeSessionStore.mergePendingRequests([], [])

    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual(['child'])
    expect(activeSessionStore.getBusySessions()[0]?.pendingAction).toEqual({
      type: 'question',
      description: 'Need approval',
    })
  })

  it('reuses the busySessions array reference when content is unchanged', () => {
    activeSessionStore.initialize({
      'local::root': { type: 'busy' },
    })
    activeSessionStore.setSessionMeta('local::root', 'Root', '/repo')

    const first = activeSessionStore.getBusySessionsSnapshot()
    activeSessionStore.applyServerStatusSnapshot('local', {
      'local::root': { type: 'busy' },
    })
    const second = activeSessionStore.getBusySessionsSnapshot()

    expect(second).toBe(first)
    expect(second).toEqual([
      {
        sessionId: 'local::root',
        status: { type: 'busy' },
        title: 'Root',
        directory: '/repo',
        pendingAction: undefined,
      },
    ])
  })

  it('replaces the busySessions array reference when status content changes', () => {
    activeSessionStore.initialize({
      'local::root': { type: 'busy' },
    })
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

  it('dedupes same-value status events into a single notification', () => {
    activeSessionStore.initialize({
      'local::root': { type: 'busy' },
    })
    const listener = vi.fn()
    const unsubscribe = activeSessionStore.subscribe(listener)
    try {
      const baseline = listener.mock.calls.length

      // 同值 busy 重复推送：不重复通知（避免订阅端无谓重渲染）
      activeSessionStore.updateStatus('local::root', { type: 'busy' })
      expect(listener).toHaveBeenCalledTimes(baseline)

      // retry 参数变化：重新通知
      activeSessionStore.updateStatus('local::root', {
        type: 'retry',
        attempt: 1,
        message: 'retrying',
        next: 1000,
      })
      expect(listener).toHaveBeenCalledTimes(baseline + 1)

      // 同参 retry 重复：不再通知
      activeSessionStore.updateStatus('local::root', {
        type: 'retry',
        attempt: 1,
        message: 'retrying',
        next: 1000,
      })
      expect(listener).toHaveBeenCalledTimes(baseline + 1)
    } finally {
      unsubscribe()
    }
  })

  it('skips idle events for sessions that were never busy', () => {
    const listener = vi.fn()
    const unsubscribe = activeSessionStore.subscribe(listener)
    try {
      activeSessionStore.updateStatus('local::ghost', { type: 'idle' })

      expect(listener).not.toHaveBeenCalled()
      expect(activeSessionStore.getSnapshot().statusMap['local::ghost']).toBeUndefined()
    } finally {
      unsubscribe()
    }
  })

  it('records in-flight idle events for unknown sessions so the snapshot cannot revive them', () => {
    // 断线重连的拉取窗口开启时，本地从未记录过的会话推来 idle（抓取快照时
    // 它还在跑，快照里是 busy）：窗口内 idle 必须先记账、在快照应用时覆盖，
    // 否则已结束的会话会被旧快照复活成 busy
    activeSessionStore.beginStatusSnapshot('local')
    activeSessionStore.updateStatus('local::ghost', { type: 'idle' })

    activeSessionStore.applyServerStatusSnapshot('local', {
      'local::ghost': { type: 'busy' },
    })
    activeSessionStore.endStatusSnapshot('local')

    expect(activeSessionStore.getSnapshot().statusMap['local::ghost']).toBeUndefined()
  })

  it('keeps processing idle events while a deferred entry exists', () => {
    // pending 未回复 → idle 被 defer（会话仍显示 busy）；重复 idle 事件
    // 不得被「无变化」早退吞掉，deferred 记账必须维持
    activeSessionStore.addPendingRequest('req-1', 'local::root', 'permission', 'edit: src/app.tsx')
    activeSessionStore.updateStatus('local::root', { type: 'idle' })
    expect(activeSessionStore.getSnapshot().statusMap['local::root']).toEqual({ type: 'busy' })

    activeSessionStore.updateStatus('local::root', { type: 'idle' })
    expect(activeSessionStore.getSnapshot().statusMap['local::root']).toEqual({ type: 'busy' })

    // pending 回复后，暂缓的 idle 落地：会话移出活跃列表
    activeSessionStore.resolvePendingRequest('req-1')
    expect(activeSessionStore.getSnapshot().statusMap['local::root']).toBeUndefined()
  })

  it('drops a replayed pending request after it has been replied', () => {
    // 症状：本地乐观回复清掉了 store，但 useGlobalEvents 闭包里的
    // latePendingRequests 没清；下一次 fetch 重放就把已回复的请求补回来，
    // 侧边栏徽标卡住不消失。settled 记录必须把它挡住。
    activeSessionStore.addPendingRequest('req-1', 'local::root', 'permission', 'bash: rm -rf')
    expect(activeSessionStore.getBusySessions()[0]?.pendingAction).toEqual({
      type: 'permission',
      description: 'bash: rm -rf',
    })

    activeSessionStore.resolvePendingRequest('req-1')

    // 模拟下一次 fetch 快照里的迟到事件重放
    activeSessionStore.addPendingRequest('req-1', 'local::root', 'permission', 'bash: rm -rf')

    expect(activeSessionStore.getBusySessions()).toEqual([])
  })

  it('still accepts a fresh request id after another one settled', () => {
    activeSessionStore.addPendingRequest('req-1', 'local::root', 'question', 'first')
    activeSessionStore.resolvePendingRequest('req-1')
    activeSessionStore.addPendingRequest('req-2', 'local::root', 'question', 'second')

    expect(activeSessionStore.getBusySessions()[0]?.pendingAction).toEqual({
      type: 'question',
      description: 'second',
    })
  })

  it('lets a server snapshot revive a request the local side had settled', () => {
    // 服务端快照是权威：它说还 pending 就要显示（本地乐观回复可能没真正生效），
    // 所以 settled 只拦 addPendingRequest，不拦 applyPendingSnapshot。
    activeSessionStore.addPendingRequest('req-1', 'local::root', 'permission', 'x')
    activeSessionStore.resolvePendingRequest('req-1')

    activeSessionStore.initializePendingRequests(
      [{ id: 'req-1', sessionID: 'local::root', action: 'bash', resources: ['x'] }],
      [],
    )

    expect(activeSessionStore.getBusySessions()[0]?.pendingAction).toEqual({
      type: 'permission',
      description: 'bash: x',
    })
  })
})
