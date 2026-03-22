/**
 * BashRenderer - Bash 工具专用渲染器
 *
 * 整体终端风格：
 * - 统一背景，命令和输出连续排列
 * - $ prompt + 命令（Shiki 语法高亮）
 * - 输出支持 ANSI 颜色，带高度限制
 * - 运行中用光标闪烁
 * - exit code 内联在输出末尾
 * - 复制 + 全屏按钮在右上角 hover 显示
 */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MaximizeIcon, CopyIcon, CheckIcon } from '../../../../components/Icons'
import { FullscreenViewer } from '../../../../components/FullscreenViewer'
import { useSyntaxHighlight } from '../../../../hooks/useSyntaxHighlight'
import { useResponsiveMaxHeight } from '../../../../hooks/useResponsiveMaxHeight'
import { parseAnsi, stripAnsi, type AnsiSegment } from '../../../../utils/ansiUtils'
import { copyTextToClipboard, clipboardErrorHandler } from '../../../../utils'
import type { ToolRendererProps } from '../types'

// ============================================
// Main
// ============================================

export function BashRenderer({ part, data }: ToolRendererProps) {
  const { t } = useTranslation(['components'])
  const { state } = part
  const isActive = state.status === 'running' || state.status === 'pending'
  const hasError = !!data.error
  const command = data.input?.trim()
  const output = data.output?.trim()
  const exitCode = data.exitCode
  const maxHeight = useResponsiveMaxHeight()
  const [fullscreenOpen, setFullscreenOpen] = useState(false)

  // 解析 ANSI
  const outputSegments = useMemo(() => {
    if (!output) return null
    return parseAnsi(output)
  }, [output])

  const plainOutput = useMemo(() => {
    if (!output) return ''
    return stripAnsi(output)
  }, [output])

  // 空状态
  if (!isActive && !hasError && !command && !output) {
    return null
  }

  const hasOutput = !!(outputSegments && outputSegments.length > 0)
  const isDone = !isActive

  return (
    <div className="rounded-lg border border-border-200/40 bg-bg-100 overflow-hidden font-mono text-[11px] leading-[1.6] group/terminal">
      {/* 滚动区：命令 + 输出 */}
      <div className="px-3 pt-2 pb-0.5 overflow-y-auto custom-scrollbar" style={{ maxHeight }}>
        {command && (
          <div className="flex items-start gap-1.5">
            <span className="text-accent-main-100 shrink-0 select-none font-semibold">$</span>
            <HighlightedCommand command={command} />
          </div>
        )}

        {isActive && !hasOutput && !hasError && (
          <div className="mt-0.5">
            <TerminalCursor />
          </div>
        )}

        {hasOutput && (
          <div className="text-text-300 whitespace-pre-wrap break-all mt-0.5">
            <AnsiOutput segments={outputSegments!} />
            {isActive && <TerminalCursor />}
          </div>
        )}

        {hasError && <div className="text-danger-100 whitespace-pre-wrap break-all mt-0.5">{data.error}</div>}
      </div>

      {/* 固定底行：看起来和终端内容一样，但不在滚动区内 */}
      <div className="flex items-center px-3 pb-2 pt-0.5">
        {isDone && exitCode !== undefined && (
          <span
            className={`text-[10px] font-medium ${exitCode === 0 ? 'text-accent-secondary-100' : 'text-warning-100'}`}
          >
            {t('contentBlock.exitCode', { code: exitCode })}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1 text-text-400 opacity-100 sm:opacity-0 sm:group-hover/terminal:opacity-100 transition-opacity">
          {command && <TerminalCopyButton text={command} />}
          {(hasOutput || hasError) && (
            <button
              className="hover:text-text-200 transition-colors"
              onClick={() => setFullscreenOpen(true)}
              title={t('contentBlock.fullscreen')}
            >
              <MaximizeIcon size={12} />
            </button>
          )}
        </span>
      </div>

      {/* 全屏查看器 */}
      {(plainOutput || data.error) && (
        <FullscreenViewer
          mode="code"
          isOpen={fullscreenOpen}
          onClose={() => setFullscreenOpen(false)}
          content={[command && `$ ${command}`, plainOutput, data.error].filter(Boolean).join('\n')}
          language="text"
        />
      )}
    </div>
  )
}

// ============================================
// Terminal Copy Button
// ============================================

function TerminalCopyButton({ text, size = 12 }: { text: string; size?: number }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await copyTextToClipboard(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      clipboardErrorHandler('copy', err)
    }
  }

  return (
    <button
      className={`p-0.5 rounded transition-colors ${copied ? 'text-success-100' : 'text-text-400 hover:text-text-200'}`}
      onClick={handleCopy}
      title={copied ? 'Copied!' : 'Copy'}
    >
      {copied ? <CheckIcon size={size} /> : <CopyIcon size={size} />}
    </button>
  )
}

// ============================================
// Highlighted Command (Shiki)
// ============================================

function HighlightedCommand({ command }: { command: string }) {
  const { output: highlighted } = useSyntaxHighlight(command, { lang: 'bash' })

  if (highlighted) {
    return (
      <span
        className="whitespace-pre-wrap break-all [&>pre]:!bg-transparent [&>pre]:!p-0 [&>pre]:!m-0 [&_code]:!bg-transparent [&_code]:!p-0"
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    )
  }

  return <span className="text-text-100 whitespace-pre-wrap break-all">{command}</span>
}

// ============================================
// Terminal Cursor (blinking block)
// ============================================

function TerminalCursor() {
  return (
    <span
      className="inline-block w-[6px] h-[14px] bg-text-300 rounded-[1px] align-middle ml-px"
      style={{ animation: 'terminal-blink 1s step-end infinite' }}
    />
  )
}

// ============================================
// ANSI Output
// ============================================

function AnsiOutput({ segments }: { segments: AnsiSegment[] }) {
  return (
    <>
      {segments.map((seg, i) => {
        if (!seg.fg && !seg.bold && !seg.dim && !seg.italic) {
          return <span key={i}>{seg.text}</span>
        }

        const style: React.CSSProperties = {}
        if (seg.fg) style.color = seg.fg
        if (seg.bold) style.fontWeight = 600
        if (seg.dim) style.opacity = 0.6
        if (seg.italic) style.fontStyle = 'italic'

        return (
          <span key={i} style={style}>
            {seg.text}
          </span>
        )
      })}
    </>
  )
}
