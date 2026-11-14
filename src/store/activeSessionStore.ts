// ============================================
// ActiveSessionStore - 追踪所有 session 的活跃状态
// ============================================
//
// 职责单一：只管 session 是否活跃、在等什么
//
// 数据来源：
// 1. GET /session/status → 按 directory 分组的全量 session 状态（applyScopeSnapshot 对账）
// 2. SSE session.status / session.idle / permission / question 事件（实时更新）
//
// 对账语义（applyScopeSnapshot）：
// - 服务端状态接口只返回仍 busy/retry 的会话，已完成的会话不会出现在返回里
// - 因此每次拉取按 directory 分组后，只替换「本目录名下」的活跃条目；
//   目录外的条目保持不动，避免误删仍在运行的其他目录会话
// - 无 directory 的全局拉取只对账无归属条目
//
// 与 notificationStore 完全独立，不互相依赖

import { useCallback, useSyncExternalStore } from 'react'
import type { SessionStatus, SessionStatusMap } from '../types/api/session'

// ============================================
// Types
// ============================================

export interface PendingRequest {
  requestId: string
  sessionId: string
  type: 'permission' | 'question'
  description?: string
}

export interface ActiveSessionEntry {
  sessionId: string
  status: SessionStatus
  title?: string
  directory?: string
  /** session 当前等待的用户操作 */
  pendingAction?: {
    type: 'permission' | 'question'
    description?: string
  }
}

interface SessionMetaEntry {
  sessionId: string
  title?: string
  directory?: string
}

interface ActiveSessionState {
  statusMap: SessionStatusMap
  initialized: boolean
}

/** 单个目录范围的拉取结果（sessionId / sessionID 均为 serverId::原始id 复合 key） */
export interface ScopeStatusGroup {
  /** 该组数据对应的拉取目录；undefined 表示全局范围 */
  directory?: string
  statusMap: SessionStatusMap
  permissions: Array<{ id: string; sessionID: string; permission: string; patterns?: string[] }>
  questions: Array<{ id: string; sessionID: string; questions?: Array<{ header?: string }> }>
}

type Subscriber = () => void

function isSameBusySessions(a: ActiveSessionEntry[], b: ActiveSessionEntry[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const left = a[i]
    const right = b[i]
    if (left.sessionId !== right.sessionId) return false
    if (left.title !== right.title || left.directory !== right.directory) return false
    if (left.pendingAction?.type !== right.pendingAction?.type) return false
    if (left.pendingAction?.description !== right.pendingAction?.description) return false
    if (left.status.type !== right.status.type) return false
    if (left.status.type === 'retry' && right.status.type === 'retry') {
      if (
        left.status.attempt !== right.status.attempt ||
        left.status.message !== right.status.message ||
        left.status.next !== right.status.next
      ) {
        return false
      }
    }
  }
  return true
}

function hasPendingIn(pending: Map<string, PendingRequest>, sessionId: string): boolean {
  for (const req of pending.values()) {
    if (req.sessionId === sessionId) return true
  }
  return false
}

function isDifferentStatus(prev: SessionStatus | undefined, next: SessionStatus): boolean {
  if (!prev) return true
  if (prev.type !== next.type) return true
  if (next.type === 'retry' && prev.type === 'retry') {
    return (
      prev.attempt !== next.attempt ||
      prev.message !== next.message ||
      prev.next !== next.next
    )
  }
  return false
}

/** 有 pending 但服务端未报 busy 的会话：置 busy 并标记 deferred，等 pending 解决后再移出。返回是否新增了条目 */
function ensurePendingBusy(
  statusMap: SessionStatusMap,
  deferred: Set<string>,
  sessionIndex: Map<string, string | undefined>,
  sessionId: string,
  directory: string | undefined,
): boolean {
  const existing = statusMap[sessionId]
  if (!existing || existing.type === 'idle') {
    statusMap[sessionId] = { type: 'busy' }
    deferred.add(sessionId)
    sessionIndex.set(sessionId, directory)
    return true
  }
  return false
}

// ============================================
// Store
// ============================================

class ActiveSessionStore {
  private state: ActiveSessionState = {
    statusMap: {},
    initialized: false,
  }
  private subscribers = new Set<Subscriber>()

  // session 元信息缓存（title, directory）
  private sessionMeta = new Map<string, { title?: string; directory?: string }>()

  // 未回复的 permission/question 请求 — requestId → PendingRequest
  private pendingRequests = new Map<string, PendingRequest>()

  // 服务端已报告 idle，但因有未回复请求而暂缓移出的 session
  private deferredIdleSessions = new Set<string>()

  // 拉取范围归属索引：复合 sessionId → 该条目上次被哪个 directory 的拉取接管
  // （undefined 表示全局拉取建立，无目录归属）
  private sessionScopeIndex = new Map<string, string | undefined>()

  // pending 归属索引：requestId → directory
  private pendingScopeIndex = new Map<string, string | undefined>()

  // 派生数据缓存
  private cachedBusySessions: ActiveSessionEntry[] = []
  private cachedBusyCount: number = 0

  subscribe = (callback: Subscriber): (() => void) => {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }

  private notify() {
    this.recomputeDerived()
    this.subscribers.forEach(cb => {
      cb()
    })
  }

  private recomputeDerived() {
    const entries = Object.entries(this.state.statusMap)
      .filter(([, status]) => status.type === 'busy' || status.type === 'retry')
      .map(([sessionId, status]) => {
        const meta = this.sessionMeta.get(sessionId)
        // 从自身 pendingRequests 查 pending action
        const pending = this.findPendingForSession(sessionId)
        return {
          sessionId,
          status,
          title: meta?.title,
          directory: meta?.directory,
          pendingAction: pending ? { type: pending.type, description: pending.description } : undefined,
        } as ActiveSessionEntry
      })
    // 内容不变时复用旧数组引用，避免 useBusySessions 订阅方因引用抖动重渲染
    if (!isSameBusySessions(this.cachedBusySessions, entries)) {
      this.cachedBusySessions = entries
    }
    this.cachedBusyCount = entries.length
  }

  private findPendingForSession(sessionId: string): PendingRequest | undefined {
    for (const req of this.pendingRequests.values()) {
      if (req.sessionId === sessionId) return req
    }
    return undefined
  }

  private hasPendingForSession(sessionId: string): boolean {
    return hasPendingIn(this.pendingRequests, sessionId)
  }

  getSnapshot = (): ActiveSessionState => this.state
  getBusySessionsSnapshot = (): ActiveSessionEntry[] => this.cachedBusySessions
  getBusyCountSnapshot = (): number => this.cachedBusyCount

  private applyStatusSnapshot(statusMap: SessionStatusMap, baseMap: SessionStatusMap): SessionStatusMap {
    const nextMap = { ...baseMap }

    for (const [sessionId, status] of Object.entries(statusMap)) {
      if (status.type === 'idle') {
        delete nextMap[sessionId]
        continue
      }

      nextMap[sessionId] = status.type === 'retry' ? { ...status } : { type: 'busy' }
    }

    return nextMap
  }

  // ============================================
  // 初始化：全量替换状态（仅测试与特殊场景使用）
  // ============================================

  initialize(statusMap: SessionStatusMap) {
    this.state = {
      statusMap: this.applyStatusSnapshot(statusMap, {}),
      initialized: true,
    }
    this.pendingRequests.clear()
    this.deferredIdleSessions.clear()
    this.sessionScopeIndex.clear()
    this.pendingScopeIndex.clear()
    for (const sessionId of Object.keys(this.state.statusMap)) {
      this.sessionScopeIndex.set(sessionId, undefined)
    }
    this.notify()
  }

  // ============================================
  // 按拉取范围对账：各组只替换「本目录名下」的条目
  // ============================================

  applyScopeSnapshot(serverId: string, groups: ScopeStatusGroup[]) {
    const prefix = `${serverId}::`
    const groupDirs = groups.map(group => group.directory)
    const hasGlobalGroup = groupDirs.some(directory => directory === undefined)

    const reportedSessionsByDir = new Map<string | undefined, Set<string>>()
    const reportedPendingByDir = new Map<string | undefined, Set<string>>()
    for (const group of groups) {
      reportedSessionsByDir.set(
        group.directory,
        new Set(Object.keys(group.statusMap)),
      )
      reportedPendingByDir.set(
        group.directory,
        new Set([...group.permissions.map(p => p.id), ...group.questions.map(q => q.id)]),
      )
    }

    // 范围判定：有归属的条目只由对应目录的拉取对账；无归属条目仅在全局拉取时对账
    const inScope = (directory: string | undefined) =>
      directory === undefined ? hasGlobalGroup : groupDirs.includes(directory)

    const nextMap = { ...this.state.statusMap }
    const nextPending = new Map(this.pendingRequests)
    const nextDeferred = new Set(this.deferredIdleSessions)
    let changed = false

    // 1) 修剪 pending：本服务器范围内、本次未返回的请求视为已失效
    for (const [requestId, directory] of this.pendingScopeIndex) {
      const req = this.pendingRequests.get(requestId)
      if (!req || !req.sessionId.startsWith(prefix)) continue
      if (!inScope(directory)) continue
      if (reportedPendingByDir.get(directory)?.has(requestId)) continue
      nextPending.delete(requestId)
      this.pendingScopeIndex.delete(requestId)
      changed = true
    }

    // 2) 修剪 session 状态：本服务器范围内、本次未报告且已无 pending 的会话移出活跃
    for (const [sessionId, directory] of this.sessionScopeIndex) {
      if (!sessionId.startsWith(prefix)) continue
      if (!nextMap[sessionId]) {
        this.sessionScopeIndex.delete(sessionId)
        continue
      }
      if (!inScope(directory)) continue
      if (reportedSessionsByDir.get(directory)?.has(sessionId)) continue
      if (hasPendingIn(nextPending, sessionId)) continue
      nextMap.delete(sessionId)
      nextDeferred.delete(sessionId)
      this.sessionScopeIndex.delete(sessionId)
      changed = true
    }

    // 3) 合入本次快照
    for (const group of groups) {
      for (const [sessionId, status] of Object.entries(group.statusMap)) {
        if (status.type === 'idle') {
          if (nextMap[sessionId]) changed = true
          nextMap.delete(sessionId)
          nextDeferred.delete(sessionId)
          this.sessionScopeIndex.delete(sessionId)
          continue
        }
        const next: SessionStatus = status.type === 'retry' ? { ...status } : { type: 'busy' }
        if (isDifferentStatus(nextMap[sessionId], next)) {
          nextMap[sessionId] = next
          changed = true
        }
        // 已有目录归属的条目保留原归属（全局合入不改写，避免失去目录对账能力）
        if (this.sessionScopeIndex.get(sessionId) === undefined) {
          this.sessionScopeIndex.set(sessionId, group.directory)
        }
      }
      for (const p of group.permissions) {
        const desc = p.patterns?.length ? `${p.permission}: ${p.patterns[0]}` : p.permission
        const prevReq = nextPending.get(p.id)
        if (!prevReq || prevReq.type !== 'permission' || prevReq.description !== desc) changed = true
        nextPending.set(p.id, {
          requestId: p.id,
          sessionId: p.sessionID,
          type: 'permission',
          description: desc,
        })
        this.pendingScopeIndex.set(p.id, group.directory)
        if (ensurePendingBusy(nextMap, nextDeferred, this.sessionScopeIndex, p.sessionID, group.directory)) {
          changed = true
        }
      }
      for (const q of group.questions) {
        const desc = q.questions?.[0]?.header || 'Waiting for input'
        const prevReq = nextPending.get(q.id)
        if (!prevReq || prevReq.type !== 'question' || prevReq.description !== desc) changed = true
        nextPending.set(q.id, {
          requestId: q.id,
          sessionId: q.sessionID,
          type: 'question',
          description: desc,
        })
        this.pendingScopeIndex.set(q.id, group.directory)
        if (ensurePendingBusy(nextMap, nextDeferred, this.sessionScopeIndex, q.sessionID, group.directory)) {
          changed = true
        }
      }
    }

    this.pendingRequests = nextPending
    this.deferredIdleSessions = nextDeferred
    if (changed) {
      this.state = { ...this.state, statusMap: nextMap }
      this.notify()
    }
  }

  // ============================================
  // SSE 事件：permission/question asked → 注册 pending
  // ============================================

  addPendingRequest(
    requestId: string,
    sessionId: string,
    type: 'permission' | 'question',
    description?: string,
    directory?: string,
  ) {
    this.pendingRequests.set(requestId, { requestId, sessionId, type, description })
    this.pendingScopeIndex.set(requestId, directory)
    // 确保 session 在 busy 列表
    if (!this.state.statusMap[sessionId] || this.state.statusMap[sessionId].type === 'idle') {
      const newMap = { ...this.state.statusMap, [sessionId]: { type: 'busy' as const } }
      this.deferredIdleSessions.add(sessionId)
      this.sessionScopeIndex.set(sessionId, directory)
      this.state = { ...this.state, statusMap: newMap }
    }
    this.notify()
  }

  // ============================================
  // SSE 事件：permission/question replied → 移除 pending
  // ============================================

  resolvePendingRequest(requestId: string) {
    const req = this.pendingRequests.get(requestId)
    if (!req) return
    this.pendingRequests.delete(requestId)
    this.pendingScopeIndex.delete(requestId)

    // 检查该 session 是否还有其他 pending，没有且 deferred 就移出 busy
    if (this.deferredIdleSessions.has(req.sessionId) && !this.hasPendingForSession(req.sessionId)) {
      this.deferredIdleSessions.delete(req.sessionId)
      const newMap = { ...this.state.statusMap }
      delete newMap[req.sessionId]
      this.sessionScopeIndex.delete(req.sessionId)
      this.state = { ...this.state, statusMap: newMap }
    }
    this.notify()
  }

  // ============================================
  // SSE 事件：session status 更新
  // ============================================

  updateStatus(sessionId: string, status: SessionStatus) {
    const newMap = { ...this.state.statusMap }

    if (status.type === 'idle') {
      if (this.hasPendingForSession(sessionId)) {
        this.deferredIdleSessions.add(sessionId)
      } else {
        this.deferredIdleSessions.delete(sessionId)
        delete newMap[sessionId]
        this.sessionScopeIndex.delete(sessionId)
      }
    } else if (status.type === 'retry') {
      this.deferredIdleSessions.delete(sessionId)
      newMap[sessionId] = { ...status }
      if (!this.sessionScopeIndex.has(sessionId)) this.sessionScopeIndex.set(sessionId, undefined)
    } else {
      this.deferredIdleSessions.delete(sessionId)
      newMap[sessionId] = { type: 'busy' }
      if (!this.sessionScopeIndex.has(sessionId)) this.sessionScopeIndex.set(sessionId, undefined)
    }

    this.state = { ...this.state, statusMap: newMap }
    this.notify()
  }

  removeSession(sessionId: string) {
    let changed = false
    let nextMap = this.state.statusMap

    if (nextMap[sessionId]) {
      nextMap = { ...nextMap }
      delete nextMap[sessionId]
      this.sessionScopeIndex.delete(sessionId)
      changed = true
    }

    for (const [requestId, request] of this.pendingRequests) {
      if (request.sessionId !== sessionId) continue
      this.pendingRequests.delete(requestId)
      this.pendingScopeIndex.delete(requestId)
      changed = true
    }

    if (this.deferredIdleSessions.delete(sessionId)) changed = true
    if (this.sessionMeta.delete(sessionId)) changed = true

    if (!changed) return
    this.state = { ...this.state, statusMap: nextMap }
    this.notify()
  }

  // ============================================
  // Session 元信息管理
  // ============================================

  setSessionMeta(sessionId: string, title?: string, directory?: string) {
    const existing = this.sessionMeta.get(sessionId)
    const newTitle = title ?? existing?.title
    const newDir = directory ?? existing?.directory
    if (newTitle !== existing?.title || newDir !== existing?.directory) {
      this.sessionMeta.set(sessionId, { title: newTitle, directory: newDir })
      this.notify()
    }
  }

  setSessionMetaBulk(entries: SessionMetaEntry[]) {
    let changed = false

    for (const entry of entries) {
      const existing = this.sessionMeta.get(entry.sessionId)
      const newTitle = entry.title ?? existing?.title
      const newDir = entry.directory ?? existing?.directory

      if (newTitle !== existing?.title || newDir !== existing?.directory) {
        this.sessionMeta.set(entry.sessionId, { title: newTitle, directory: newDir })
        changed = true
      }
    }

    if (changed) {
      this.notify()
    }
  }

  getSessionMeta(sessionId: string) {
    return this.sessionMeta.get(sessionId)
  }

  getBusySessions(): ActiveSessionEntry[] {
    return this.cachedBusySessions
  }

  get busyCount(): number {
    return this.cachedBusyCount
  }
}

// ============================================
// Singleton & React Hooks
// ============================================

export const activeSessionStore = new ActiveSessionStore()

export function useActiveSessionStore() {
  return useSyncExternalStore(activeSessionStore.subscribe, activeSessionStore.getSnapshot)
}

export function useBusySessions(): ActiveSessionEntry[] {
  return useSyncExternalStore(activeSessionStore.subscribe, activeSessionStore.getBusySessionsSnapshot)
}

export function useBusyCount(): number {
  return useSyncExternalStore(activeSessionStore.subscribe, activeSessionStore.getBusyCountSnapshot)
}

/** 按 sessionId 查活跃状态，不活跃时返回 undefined */
export function useSessionActiveEntry(sessionId: string): ActiveSessionEntry | undefined {
  const getSnapshot = useCallback(
    () => activeSessionStore.getBusySessions().find(e => e.sessionId === sessionId),
    [sessionId],
  )
  return useSyncExternalStore(activeSessionStore.subscribe, getSnapshot)
}
