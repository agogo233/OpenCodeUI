import { memo, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ToolPart, StepFinishPart } from '../../../types/message'
import { useDelayedRender } from '../../../hooks'
import { formatToolName, formatDuration } from '../../../utils/formatUtils'
import {
  extractToolData,
  getToolConfig,
  getToolCategory,
  DefaultRenderer,
  TodoRenderer,
  TaskRenderer,
  hasTodos,
  categorizeTools,
} from '../tools'
import type { ToolCategory } from '../tools'
import { SmoothHeight } from '../../../components/ui'
import { StepFinishPartView } from './StepFinishPartView'
import { useAmbientPermission, findPermissionForTool, findQuestionForTool } from '../../chat/AmbientPermissionContext'
import { InlinePermission } from '../../chat/InlinePermission'
import { InlineQuestion } from '../../chat/InlineQuestion'

// ============================================
// AmbientToolGroup — 融入正文的工具调用摘要
//
// 设计原则：
// 1. 和正文同字号、同行高、同 font-family、同字体样式
// 2. 用 text-300 略淡于正文，但不跳出阅读流
// 3. running 时用 reasoning-shimmer-text 扫光动画
// 4. 错误信息自然融入句子："执行了 8 次，失败 1 次"
// 5. 没有 icon、没有箭头、没有控件外观
// ============================================

interface AmbientToolGroupProps {
  parts: ToolPart[]
  stepFinish?: StepFinishPart
  duration?: number
  turnDuration?: number
  isStreaming?: boolean
}

export const AmbientToolGroup = memo(function AmbientToolGroup({
  parts,
  stepFinish,
  duration,
  turnDuration,
  isStreaming,
}: AmbientToolGroupProps) {
  const { t } = useTranslation('message')
  const [expanded, setExpanded] = useState(false)
  const shouldRenderBody = useDelayedRender(expanded)

  const hasRunning = parts.some(p => p.state.status === 'running' || p.state.status === 'pending')
  const errorCount = parts.filter(p => p.state.status === 'error').length

  // 统计分类 + 错误
  const summaryText = useMemo(() => {
    const categories = categorizeTools(parts.map(p => p.tool))
    return buildNaturalSummary(categories, errorCount, hasRunning, t)
  }, [parts, errorCount, hasRunning, t])

  return (
    <SmoothHeight isActive={!!isStreaming}>
      <div className="py-0.5">
        {/* 摘要 — 纯文字，点击展开 */}
        <span
          role="button"
          tabIndex={0}
          onClick={() => setExpanded(!expanded)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') setExpanded(!expanded)
          }}
          aria-expanded={expanded}
          className={`text-sm leading-relaxed cursor-pointer hover:text-text-200 transition-colors ${
            hasRunning ? 'reasoning-shimmer-text' : 'text-text-300'
          }`}
        >
          {summaryText}
        </span>

        {/* 展开后的工具详情列表 */}
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-250 ease-out ${
            expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}
        >
          <div className="min-h-0 min-w-0 overflow-hidden" style={{ clipPath: 'inset(0 -100% 0 -100%)' }}>
            {shouldRenderBody && (
              <div className="pt-1.5 flex flex-col gap-0.5">
                {parts.map(part => (
                  <AmbientToolItem key={part.id} part={part} />
                ))}
              </div>
            )}
          </div>
        </div>

        {stepFinish && (
          <div className="mt-1">
            <StepFinishPartView part={stepFinish} duration={duration} turnDuration={turnDuration} />
          </div>
        )}
      </div>
    </SmoothHeight>
  )
})

// ============================================
// AmbientToolItem — 展开后的单个工具行
// 依然是文字风格，不是卡片，没有箭头
// ============================================

const AmbientToolItem = memo(function AmbientToolItem({ part }: { part: ToolPart }) {
  const { t } = useTranslation('message')

  // 有副作用的工具（编辑/写入/执行）完成后默认展开，方便审查
  const category = getToolCategory(part.tool)
  const hasSideEffect = category === 'edit' || category === 'execute'
  const isFinished = part.state.status === 'completed' || part.state.status === 'error'
  const [expanded, setExpanded] = useState(hasSideEffect && isFinished)
  const shouldRenderBody = useDelayedRender(expanded)

  const { state, tool: toolName } = part
  const title = state.title || ''
  const dur = state.time?.start && state.time?.end ? state.time.end - state.time.start : undefined
  const isActive = state.status === 'running' || state.status === 'pending'
  const isError = state.status === 'error'

  // 关联的权限请求 / 提问请求
  const { pendingPermissions, pendingQuestions, onPermissionReply, onQuestionReply, onQuestionReject, isReplying } =
    useAmbientPermission()
  const permissionRequest = findPermissionForTool(pendingPermissions, part.callID)
  const questionRequest = findQuestionForTool(pendingQuestions, part.callID)

  return (
    <div className="min-w-0">
      <span
        role="button"
        tabIndex={0}
        className="group/item inline-flex items-baseline gap-1.5 w-full text-left py-0.5 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') setExpanded(!expanded)
        }}
        aria-expanded={expanded}
      >
        {/* 工具名 */}
        <span
          className={`text-[12px] leading-5 shrink-0 ${
            isActive
              ? 'reasoning-shimmer-text'
              : isError
                ? 'text-danger-100'
                : 'text-text-400 group-hover/item:text-text-300'
          }`}
        >
          {formatToolName(toolName)}
        </span>

        {/* title / file path */}
        {title && (
          <span className="text-[12px] leading-5 text-text-400 truncate min-w-0 flex-1 opacity-60">{title}</span>
        )}

        {/* 状态 */}
        <span className="inline-flex items-center gap-1.5 ml-auto shrink-0">
          {isActive && <span className="text-[11px] reasoning-shimmer-text">{t('ambient.running')}</span>}
          {isError && <span className="text-[11px] text-danger-100">{t('ambient.failed')}</span>}
          {dur !== undefined && state.status === 'completed' && (
            <span className="text-[11px] text-text-500 tabular-nums">{formatDuration(dur)}</span>
          )}
        </span>
      </span>

      {/* 权限请求 — 融入工具调用位置 */}
      {permissionRequest && (
        <InlinePermission request={permissionRequest} onReply={onPermissionReply} isReplying={isReplying} />
      )}

      {/* 提问请求 — 融入工具调用位置 */}
      {questionRequest && (
        <InlineQuestion
          request={questionRequest}
          onReply={onQuestionReply}
          onReject={onQuestionReject}
          isReplying={isReplying}
        />
      )}

      {/* 可展开的详情 */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
          expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="min-h-0 min-w-0 overflow-hidden">
          {shouldRenderBody && (
            <div className="pl-2 pr-1 pb-2 pt-0.5">
              <AmbientToolBody part={part} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

// ============================================
// AmbientToolBody — 复用现有 renderer
// ============================================

function AmbientToolBody({ part }: { part: ToolPart }) {
  const { tool } = part
  const lowerTool = tool.toLowerCase()
  const data = extractToolData(part)

  if (lowerTool === 'task') {
    return <TaskRenderer part={part} data={data} />
  }

  if (lowerTool.includes('todo') && hasTodos(part)) {
    return <TodoRenderer part={part} data={data} />
  }

  const config = getToolConfig(tool)
  if (config?.renderer) {
    const CustomRenderer = config.renderer
    return <CustomRenderer part={part} data={data} />
  }

  return <DefaultRenderer part={part} data={data} />
}

// ============================================
// 自然语言摘要构建
// ============================================

function buildNaturalSummary(
  categories: Array<{ category: ToolCategory; count: number }>,
  errorCount: number,
  hasRunning: boolean,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const parts = categories.map(({ category, count }) => t(`ambient.${category}`, { count }))

  let text = parts.join(t('ambient.separator'))

  if (errorCount > 0) {
    text += t('ambient.errorSuffix', { count: errorCount })
  }

  if (hasRunning) {
    text += t('ambient.runningSuffix')
  }

  return text
}
