/**
 * AmbientPermissionContext
 *
 * 在 ambient 模式下，把权限请求和提问请求注入到消息流中。
 * AmbientToolItem 通过 callID 匹配到自己对应的权限/提问，渲染 inline UI。
 */

import { createContext, useContext } from 'react'
import type { ApiPermissionRequest, ApiQuestionRequest, PermissionReply, QuestionAnswer } from '../../api'

export interface AmbientPermissionContextValue {
  /** 当前 pending 的权限请求 */
  pendingPermissions: ApiPermissionRequest[]
  /** 当前 pending 的提问请求 */
  pendingQuestions: ApiQuestionRequest[]
  /** 回复权限 */
  onPermissionReply: (requestId: string, reply: PermissionReply) => void
  /** 回复提问 */
  onQuestionReply: (requestId: string, answers: QuestionAnswer[]) => void
  /** 拒绝提问 */
  onQuestionReject: (requestId: string) => void
  /** 是否正在发送回复 */
  isReplying: boolean
}

const defaultValue: AmbientPermissionContextValue = {
  pendingPermissions: [],
  pendingQuestions: [],
  onPermissionReply: () => {},
  onQuestionReply: () => {},
  onQuestionReject: () => {},
  isReplying: false,
}

export const AmbientPermissionContext = createContext<AmbientPermissionContextValue>(defaultValue)

export function useAmbientPermission() {
  return useContext(AmbientPermissionContext)
}

/**
 * 根据 callID 查找关联的权限请求
 */
export function findPermissionForTool(
  pendingPermissions: ApiPermissionRequest[],
  callID: string,
): ApiPermissionRequest | undefined {
  return pendingPermissions.find(p => p.tool?.callID === callID)
}

/**
 * 根据 callID 查找关联的提问请求
 */
export function findQuestionForTool(
  pendingQuestions: ApiQuestionRequest[],
  callID: string,
): ApiQuestionRequest | undefined {
  return pendingQuestions.find(q => q.tool?.callID === callID)
}
