// ============================================
// usePermissionHandler - Permission & Question 处理 (Enhanced)
// ============================================

import { useState, useCallback, useRef } from 'react'
import {
  replyPermission,
  replyQuestion,
  rejectQuestion,
  getPendingPermissions,
  getPendingQuestions,
  type ApiPermissionRequest,
  type ApiQuestionRequest,
  type PermissionReply,
  type QuestionAnswer,
} from '../api'
import { activeSessionStore, notificationStore } from '../store'
import { makeSessionKey } from '../utils/sessionKey'
import { permissionErrorHandler } from '../utils'

export interface UsePermissionHandlerResult {
  // State
  pendingPermissionRequests: ApiPermissionRequest[]
  pendingQuestionRequests: ApiQuestionRequest[]
  // Setters (for SSE events)
  setPendingPermissionRequests: React.Dispatch<React.SetStateAction<ApiPermissionRequest[]>>
  setPendingQuestionRequests: React.Dispatch<React.SetStateAction<ApiQuestionRequest[]>>
  // Handlers
  handlePermissionReply: (
    requestId: string,
    reply: PermissionReply,
    directory?: string,
    sessionId?: string,
  ) => Promise<boolean>
  handleQuestionReply: (
    requestId: string,
    answers: QuestionAnswer[],
    directory?: string,
    sessionId?: string,
  ) => Promise<boolean>
  handleQuestionReject: (requestId: string, directory?: string, sessionId?: string) => Promise<boolean>
  // Refresh (fallback sync for pending requests) - 支持单个或多个 session IDs
  refreshPendingRequests: (sessionIds?: string | string[], directory?: string) => Promise<void>
  // Reset
  resetPendingRequests: () => void
  // Loading state
  isReplying: boolean
}

const MAX_RETRIES = 3
const RETRY_DELAY = 500

async function isPermissionStillPending(
  requestId: string,
  directory?: string,
  sessionId?: string,
  serverId?: string,
): Promise<boolean | undefined> {
  try {
    const pending = await getPendingPermissions(sessionId, directory, serverId)
    return pending.some(request => request.id === requestId)
  } catch {
    return undefined
  }
}

async function isQuestionStillPending(
  requestId: string,
  directory?: string,
  sessionId?: string,
  serverId?: string,
): Promise<boolean | undefined> {
  try {
    const pending = await getPendingQuestions(sessionId, directory, serverId)
    return pending.some(request => request.id === requestId)
  } catch {
    return undefined
  }
}

// 回复失败后的补偿查询上下文：入参 directory 可能已因切目录指向错误实例，
// 优先用 store 登记的请求归属（ask 事件时的会话/目录）反查真实位置。
function resolvePendingLookupContext(requestId: string, directory?: string) {
  const recorded = activeSessionStore.getPendingRequest(requestId)
  const meta = recorded ? activeSessionStore.getSessionMeta(recorded.sessionId) : undefined
  return {
    sessionId: recorded?.sessionId,
    directory: recorded?.directory ?? meta?.directory ?? directory,
  }
}

async function withRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES, delay = RETRY_DELAY): Promise<T> {
  let lastError: Error | undefined

  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      console.warn(`[Permission] Attempt ${i + 1} failed:`, lastError.message)

      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay * (i + 1)))
      }
    }
  }

  throw lastError
}

export function usePermissionHandler(serverId: string): UsePermissionHandlerResult {
  const [pendingPermissionRequests, setPendingPermissionRequests] = useState<ApiPermissionRequest[]>([])
  const [pendingQuestionRequests, setPendingQuestionRequests] = useState<ApiQuestionRequest[]>([])
  const [isReplying, setIsReplying] = useState(false)

  // 防止重复回复
  const replyingIdsRef = useRef<Set<string>>(new Set())

  // serverId 是本 hook 的作用域：所有发起请求的回调都必须把它列入依赖。
  // pane 的服务器绑定会变（切会话、多服务器、WSL sidecar 就绪后切回），
  // 空依赖数组会把 serverId 冻在首次渲染的值上，回复被发到旧服务器：
  // 旧服务器报错 → 请求在真实服务器上仍 pending → 弹窗消失后又冒出来，对话不前进。
  const handlePermissionReply = useCallback(
    async (requestId: string, reply: PermissionReply, directory?: string, sessionId?: string): Promise<boolean> => {
      // 防止重复回复
      if (replyingIdsRef.current.has(requestId)) {
        console.warn(`[Permission] Already replying to ${requestId}`)
        return false
      }

      replyingIdsRef.current.add(requestId)
      setIsReplying(true)

      // reply 本体也按登记归属路由：切目录后入参 directory 可能指向错误实例，
      // 用登记目录才能让重试直接命中真实实例（无登记时回落入参，行为不变）
      const lookup = resolvePendingLookupContext(requestId, directory)
      try {
        await withRetry(() =>
          replyPermission(requestId, reply, undefined, lookup.directory, lookup.sessionId ?? sessionId, serverId),
        )
        setPendingPermissionRequests(prev =>
          prev.some(r => r.id === requestId) ? prev.filter(r => r.id !== requestId) : prev,
        )
        activeSessionStore.resolvePendingRequest(requestId)
        return true
      } catch (error) {
        const stillPending = await isPermissionStillPending(
          requestId,
          lookup.directory,
          lookup.sessionId ?? sessionId,
          serverId,
        )
        if (stillPending === false) {
          setPendingPermissionRequests(prev =>
            prev.some(r => r.id === requestId) ? prev.filter(r => r.id !== requestId) : prev,
          )
          activeSessionStore.resolvePendingRequest(requestId)
          return true
        }

        permissionErrorHandler('reply after retries', error)
        notificationStore.push(
          'error',
          'Permission reply failed',
          'The reply did not reach the server. Please retry.',
          lookup.sessionId ?? sessionId ?? '',
          lookup.directory,
        )
        return false
      } finally {
        replyingIdsRef.current.delete(requestId)
        setIsReplying(false)
      }
    },
    [serverId],
  )

  const handleQuestionReply = useCallback(
    async (requestId: string, answers: QuestionAnswer[], directory?: string, sessionId?: string): Promise<boolean> => {
      if (replyingIdsRef.current.has(requestId)) {
        console.warn(`[Question] Already replying to ${requestId}`)
        return false
      }

      replyingIdsRef.current.add(requestId)
      setIsReplying(true)

      // 与 permission 同理：reply 本体按登记归属路由，切目录后重试也能命中真实实例
      const lookup = resolvePendingLookupContext(requestId, directory)
      try {
        await withRetry(() => replyQuestion(requestId, answers, lookup.directory, serverId))
        setPendingQuestionRequests(prev => prev.filter(r => r.id !== requestId))
        activeSessionStore.resolvePendingRequest(requestId)
        return true
      } catch (error) {
        // 回复失败 ≠ 服务端已解：用登记归属确认服务端状态再决定。
        // 仍等待时必须保留 pending（对话框保持打开可重试），静默清除会让用户误以为回答成功。
        const stillPending = await isQuestionStillPending(
          requestId,
          lookup.directory,
          lookup.sessionId ?? sessionId,
          serverId,
        )
        if (stillPending === false) {
          setPendingQuestionRequests(prev => prev.filter(r => r.id !== requestId))
          activeSessionStore.resolvePendingRequest(requestId)
          return true
        }
        permissionErrorHandler('question reply after retries', error)
        notificationStore.push(
          'error',
          'Question reply failed',
          'The reply did not reach the server. Please retry.',
          lookup.sessionId ?? sessionId ?? '',
          lookup.directory,
        )
        return false
      } finally {
        replyingIdsRef.current.delete(requestId)
        setIsReplying(false)
      }
    },
    [serverId],
  )

  const handleQuestionReject = useCallback(
    async (requestId: string, directory?: string, sessionId?: string): Promise<boolean> => {
      if (replyingIdsRef.current.has(requestId)) {
        return false
      }

      replyingIdsRef.current.add(requestId)
      setIsReplying(true)

      // 与 reply 同理：reject 本体按登记归属路由
      const lookup = resolvePendingLookupContext(requestId, directory)
      try {
        await withRetry(() => rejectQuestion(requestId, lookup.directory, serverId))
        setPendingQuestionRequests(prev => prev.filter(r => r.id !== requestId))
        activeSessionStore.resolvePendingRequest(requestId)
        return true
      } catch (error) {
        // 与 handleQuestionReply 同理：拒绝失败时先确认服务端状态，避免静默丢请求
        const stillPending = await isQuestionStillPending(
          requestId,
          lookup.directory,
          lookup.sessionId ?? sessionId,
          serverId,
        )
        if (stillPending === false) {
          setPendingQuestionRequests(prev => prev.filter(r => r.id !== requestId))
          activeSessionStore.resolvePendingRequest(requestId)
          return true
        }
        permissionErrorHandler('question reject after retries', error)
        notificationStore.push(
          'error',
          'Question dismiss failed',
          'The request was not dismissed on the server. Please retry.',
          lookup.sessionId ?? sessionId ?? '',
          lookup.directory,
        )
        return false
      } finally {
        replyingIdsRef.current.delete(requestId)
        setIsReplying(false)
      }
    },
    [serverId],
  )

  // 主动轮询获取 pending 请求（用于 SSE 可能丢失事件的情况）
  // 一次拉取全量数据，用 sessionFamily 过滤后直接替换本地状态
  const refreshPendingRequests = useCallback(async (sessionIds?: string | string[], directory?: string) => {
    try {
      // 规范化为 Set 用于过滤（family 是复合 key；API 返回的 sessionID 是原始 id）
      const familySet = new Set(sessionIds ? (Array.isArray(sessionIds) ? sessionIds : [sessionIds]) : [])
      // 原始 id → 复合 key（按当前 pane 的服务器），两种形式都匹配
      const matchesFamily = (rawSessionId: string) => {
        if (familySet.size === 0) return true
        if (familySet.has(rawSessionId)) return true
        return familySet.has(makeSessionKey(serverId, rawSessionId))
      }

      // 只请求一次全量数据（不按 sessionId 分别请求）
      const [allPermissions, allQuestions] = await Promise.all([
        getPendingPermissions(undefined, directory, serverId).catch(() => []),
        getPendingQuestions(undefined, directory, serverId).catch(() => []),
      ])

      const nextPermissions =
        familySet.size > 0
          ? allPermissions.filter(p => matchesFamily(p.sessionID) && !replyingIdsRef.current.has(p.id))
          : allPermissions.filter(p => !replyingIdsRef.current.has(p.id))

      // OMO background subagents can emit permission.asked over SSE before /permission
      // exposes the request for the routed instance. Refresh 时序下子 session 关系可能
      // 尚未注册，因此 SSE 已知请求无条件保留（family 过滤只作用于新拉取的数据）
      setPendingPermissionRequests(prev => {
        const merged = new Map(nextPermissions.map(p => [p.id, p]))
        for (const request of prev) {
          if (replyingIdsRef.current.has(request.id)) continue
          if (!merged.has(request.id)) merged.set(request.id, request)
        }
        return Array.from(merged.values())
      })
      setPendingQuestionRequests(prev => {
        const nextQuestions =
          familySet.size > 0
            ? allQuestions.filter(q => matchesFamily(q.sessionID) && !replyingIdsRef.current.has(q.id))
            : allQuestions.filter(q => !replyingIdsRef.current.has(q.id))
        const merged = new Map(nextQuestions.map(q => [q.id, q]))
        for (const q of prev) {
          if (replyingIdsRef.current.has(q.id)) continue
          if (!merged.has(q.id)) merged.set(q.id, q)
        }
        return Array.from(merged.values())
      })
    } catch (error) {
      permissionErrorHandler('refresh pending requests', error)
    }
  }, [serverId])

  const resetPendingRequests = useCallback(() => {
    setPendingPermissionRequests([])
    setPendingQuestionRequests([])
    replyingIdsRef.current.clear()
  }, [])

  return {
    pendingPermissionRequests,
    pendingQuestionRequests,
    setPendingPermissionRequests,
    setPendingQuestionRequests,
    handlePermissionReply,
    handleQuestionReply,
    handleQuestionReject,
    refreshPendingRequests,
    resetPendingRequests,
    isReplying,
  }
}
