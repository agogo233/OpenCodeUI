/**
 * InlinePermission — 融入信息流的权限确认
 *
 * 不是弹窗，不是卡片。渲染在对应的工具调用下方。
 * 视觉上就是一段文字 + 几个文字按钮。
 */

import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApiPermissionRequest, PermissionReply } from '../../api'
import { DiffView } from '../../components/DiffView'
import { autoApproveStore } from '../../store'

interface InlinePermissionProps {
  request: ApiPermissionRequest
  onReply: (requestId: string, reply: PermissionReply) => void
  isReplying: boolean
}

export const InlinePermission = memo(function InlinePermission({
  request,
  onReply,
  isReplying,
}: InlinePermissionProps) {
  const { t } = useTranslation(['chat', 'common'])

  const metadata = request.metadata
  const diff = metadata?.diff as string | undefined
  const filepath = metadata?.filepath as string | undefined

  let before: string | undefined
  let after: string | undefined
  if (metadata?.filediff && typeof metadata.filediff === 'object') {
    const fd = metadata.filediff as Record<string, unknown>
    before = String(fd.before || '')
    after = String(fd.after || '')
  }

  const isFileEdit = request.permission === 'edit' || request.permission === 'write'

  const handleAlways = () => {
    if (autoApproveStore.enabled) {
      const rulePatterns = [...(request.always || []), ...(request.patterns || [])]
      const unique = [...new Set(rulePatterns)]
      if (unique.length > 0) {
        autoApproveStore.addRules(request.sessionID, request.permission, unique)
        onReply(request.id, 'once')
        return
      }
    }
    onReply(request.id, 'always')
  }

  return (
    <div className="py-1.5 space-y-2">
      {/* Diff 预览 — 文件编辑类 */}
      {isFileEdit && diff && (
        <DiffView
          diff={diff}
          before={before}
          after={after}
          filePath={filepath}
          defaultCollapsed={false}
          maxHeight={150}
        />
      )}

      {/* 请求内容 — 非文件编辑类 */}
      {!isFileEdit && request.patterns && request.patterns.length > 0 && (
        <div className="text-[12px] text-text-400 font-mono whitespace-pre-wrap">
          {request.patterns.map(p => p.replace(/\\n/g, '\n')).join('\n')}
        </div>
      )}

      {/* 操作 — 纯文字按钮，融入阅读流 */}
      <div className="flex items-center gap-3 text-sm">
        <button
          onClick={() => onReply(request.id, 'once')}
          disabled={isReplying}
          className="text-text-100 hover:text-accent-main-100 transition-colors font-medium disabled:opacity-50 cursor-pointer bg-transparent border-0 p-0"
        >
          {t('permissionDialog.allowOnce')}
        </button>
        <span className="text-text-500">·</span>
        <button
          onClick={handleAlways}
          disabled={isReplying}
          className="text-text-300 hover:text-text-100 transition-colors disabled:opacity-50 cursor-pointer bg-transparent border-0 p-0"
        >
          {t('permissionDialog.alwaysAllow')}
        </button>
        <span className="text-text-500">·</span>
        <button
          onClick={() => onReply(request.id, 'reject')}
          disabled={isReplying}
          className="text-text-400 hover:text-danger-100 transition-colors disabled:opacity-50 cursor-pointer bg-transparent border-0 p-0"
        >
          {t('common:reject')}
        </button>
      </div>
    </div>
  )
})
