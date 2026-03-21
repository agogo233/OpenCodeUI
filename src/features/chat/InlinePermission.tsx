/**
 * InlinePermission — 融入信息流的权限确认
 *
 * 紧凑的 inline 卡片，拥有弹窗的全部功能：
 * - Diff 预览（文件编辑类）
 * - Patterns 内容（命令类）
 * - Always 规则
 * - Allow once / Always allow / Reject 按钮
 */

import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApiPermissionRequest, PermissionReply } from '../../api'
import { DiffView } from '../../components/DiffView'
import { ContentBlock } from '../../components'
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
  const hasPatterns = request.patterns && request.patterns.length > 0
  const hasRules = request.always && request.always.length > 0

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
    <div className="my-1.5 rounded-lg border border-border-200/50 bg-bg-200/20 overflow-hidden">
      {/* 内容区 */}
      <div className="space-y-2 max-h-[200px] overflow-auto custom-scrollbar">
        {/* Diff 预览 */}
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

        {/* 请求内容 — 命令类 */}
        {hasPatterns && !isFileEdit && (
          <div className="px-3 pt-2.5">
            <ContentBlock
              label={t('permissionDialog.request')}
              content={request.patterns.map(p => p.replace(/\\n/g, '\n')).join('\n\n')}
              language="bash"
              maxHeight={120}
              collapsible={false}
            />
          </div>
        )}

        {/* 规则 */}
        {hasRules && (
          <div className="px-3 pt-1">
            <ContentBlock
              label={t('permissionDialog.rule')}
              content={request.always.join('\n')}
              language="bash"
              maxHeight={60}
              collapsible={false}
            />
          </div>
        )}
      </div>

      {/* 操作栏 */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-border-200/30">
        <button
          onClick={() => onReply(request.id, 'once')}
          disabled={isReplying}
          className="px-3 py-1 rounded-md bg-text-100 text-bg-000 text-[13px] font-medium hover:bg-text-200 transition-colors disabled:opacity-50"
        >
          {t('permissionDialog.allowOnce')}
        </button>
        <button
          onClick={handleAlways}
          disabled={isReplying}
          className="px-3 py-1 rounded-md border border-border-200/60 text-[13px] text-text-200 hover:bg-bg-200 transition-colors disabled:opacity-50"
        >
          {t('permissionDialog.alwaysAllow')}
        </button>
        <button
          onClick={() => onReply(request.id, 'reject')}
          disabled={isReplying}
          className="px-3 py-1 rounded-md text-[13px] text-text-400 hover:text-danger-100 hover:bg-bg-200 transition-colors disabled:opacity-50"
        >
          {t('common:reject')}
        </button>
        <span className="ml-auto text-[11px] text-text-500">
          {autoApproveStore.enabled ? t('permissionDialog.browserSession') : t('permissionDialog.thisSession')}
        </span>
      </div>
    </div>
  )
})
