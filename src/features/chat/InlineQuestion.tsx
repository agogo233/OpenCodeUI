/**
 * InlineQuestion — 融入信息流的提问交互
 *
 * 渲染在对话流中，用户直接在流里选择/输入回答。
 */

import { memo, useState, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApiQuestionRequest, ApiQuestionInfo, QuestionAnswer } from '../../api'

interface InlineQuestionProps {
  request: ApiQuestionRequest
  onReply: (requestId: string, answers: QuestionAnswer[]) => void
  onReject: (requestId: string) => void
  isReplying: boolean
}

export const InlineQuestion = memo(function InlineQuestion({
  request,
  onReply,
  onReject,
  isReplying,
}: InlineQuestionProps) {
  const { t } = useTranslation(['chat', 'common'])

  const [answers, setAnswers] = useState<Map<number, Set<string>>>(() => {
    const map = new Map<number, Set<string>>()
    request.questions.forEach((_, idx) => map.set(idx, new Set()))
    return map
  })

  const [customEnabled, setCustomEnabled] = useState<Map<number, boolean>>(() => {
    const map = new Map<number, boolean>()
    request.questions.forEach((_, idx) => map.set(idx, false))
    return map
  })

  const [customValues, setCustomValues] = useState<Map<number, string>>(() => {
    const map = new Map<number, string>()
    request.questions.forEach((_, idx) => map.set(idx, ''))
    return map
  })

  const selectOption = useCallback((qIdx: number, label: string) => {
    setAnswers(prev => {
      const newMap = new Map(prev)
      newMap.set(qIdx, new Set([label]))
      return newMap
    })
    setCustomEnabled(prev => {
      const newMap = new Map(prev)
      newMap.set(qIdx, false)
      return newMap
    })
  }, [])

  const selectCustom = useCallback((qIdx: number) => {
    setAnswers(prev => {
      const newMap = new Map(prev)
      newMap.set(qIdx, new Set())
      return newMap
    })
    setCustomEnabled(prev => {
      const newMap = new Map(prev)
      newMap.set(qIdx, true)
      return newMap
    })
  }, [])

  const toggleOption = useCallback((qIdx: number, label: string) => {
    setAnswers(prev => {
      const newMap = new Map(prev)
      const current = new Set(prev.get(qIdx) || [])
      if (current.has(label)) current.delete(label)
      else current.add(label)
      newMap.set(qIdx, current)
      return newMap
    })
  }, [])

  const toggleCustom = useCallback((qIdx: number) => {
    setCustomEnabled(prev => {
      const newMap = new Map(prev)
      newMap.set(qIdx, !prev.get(qIdx))
      return newMap
    })
  }, [])

  const updateCustomValue = useCallback((qIdx: number, value: string) => {
    setCustomValues(prev => {
      const newMap = new Map(prev)
      newMap.set(qIdx, value)
      return newMap
    })
  }, [])

  const handleSubmit = useCallback(() => {
    const result: QuestionAnswer[] = request.questions.map((q, idx) => {
      const selected = Array.from(answers.get(idx) || [])
      const isCustom = customEnabled.get(idx)
      const customValue = customValues.get(idx)?.trim()
      if (q.multiple) {
        return isCustom && customValue && q.custom !== false ? [...selected, customValue] : selected
      }
      return isCustom && customValue ? [customValue] : selected
    })
    onReply(request.id, result)
  }, [request, answers, customEnabled, customValues, onReply])

  const canSubmit = request.questions.every((_q, idx) => {
    const selected = answers.get(idx) || new Set()
    const isCustom = customEnabled.get(idx)
    const customValue = customValues.get(idx)?.trim()
    return selected.size > 0 || (isCustom && customValue)
  })

  return (
    <div className="py-1.5 space-y-3">
      {request.questions.map((question, qIdx) => (
        <InlineQuestionItem
          key={qIdx}
          question={question}
          selected={answers.get(qIdx) || new Set()}
          isCustomEnabled={customEnabled.get(qIdx) || false}
          customValue={customValues.get(qIdx) || ''}
          onSelectOption={label => selectOption(qIdx, label)}
          onSelectCustom={() => selectCustom(qIdx)}
          onToggleOption={label => toggleOption(qIdx, label)}
          onToggleCustom={() => toggleCustom(qIdx)}
          onCustomValueChange={value => updateCustomValue(qIdx, value)}
        />
      ))}

      {/* 操作 — 纯文字按钮 */}
      <div className="flex items-center gap-3 text-sm">
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || isReplying}
          className="text-text-100 hover:text-accent-main-100 transition-colors font-medium disabled:opacity-50 cursor-pointer bg-transparent border-0 p-0"
        >
          {t('common:submit')}
        </button>
        <span className="text-text-500">·</span>
        <button
          onClick={() => onReject(request.id)}
          disabled={isReplying}
          className="text-text-400 hover:text-text-200 transition-colors disabled:opacity-50 cursor-pointer bg-transparent border-0 p-0"
        >
          {t('common:skip')}
        </button>
      </div>
    </div>
  )
})

// ============================================
// InlineQuestionItem — 单个问题
// ============================================

interface InlineQuestionItemProps {
  question: ApiQuestionInfo
  selected: Set<string>
  isCustomEnabled: boolean
  customValue: string
  onSelectOption: (label: string) => void
  onSelectCustom: () => void
  onToggleOption: (label: string) => void
  onToggleCustom: () => void
  onCustomValueChange: (value: string) => void
}

function InlineQuestionItem({
  question,
  selected,
  isCustomEnabled,
  customValue,
  onSelectOption,
  onSelectCustom,
  onToggleOption,
  onToggleCustom,
  onCustomValueChange,
}: InlineQuestionItemProps) {
  const { t } = useTranslation('chat')
  const isMultiple = question.multiple || false
  const allowCustom = question.custom !== false
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isCustomEnabled && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isCustomEnabled])

  return (
    <div className="space-y-1.5">
      {/* 问题文字 — 就是正文 */}
      <div className="text-sm text-text-100">{question.question}</div>

      {/* 选项 — 轻量文字按钮列表 */}
      <div className="flex flex-wrap gap-1.5">
        {question.options.map((option, idx) => {
          const isSelected = selected.has(option.label)
          return (
            <button
              key={idx}
              onClick={() => (isMultiple ? onToggleOption(option.label) : onSelectOption(option.label))}
              className={`px-2.5 py-1 text-[13px] rounded-md border transition-colors cursor-pointer bg-transparent ${
                isSelected
                  ? 'border-text-100 text-text-100'
                  : 'border-border-200/60 text-text-300 hover:border-border-300 hover:text-text-200'
              }`}
              title={option.description}
            >
              {option.label}
            </button>
          )
        })}
      </div>

      {/* 自定义输入 */}
      {allowCustom && (
        <div
          onClick={() => {
            if (!isCustomEnabled) {
              if (isMultiple) onToggleCustom()
              else onSelectCustom()
            }
          }}
          className={`rounded-md border px-2.5 py-1.5 transition-colors cursor-text ${
            isCustomEnabled ? 'border-text-100' : 'border-border-200/60'
          }`}
        >
          <textarea
            ref={textareaRef}
            value={customValue}
            onChange={e => onCustomValueChange(e.target.value)}
            onClick={e => {
              e.stopPropagation()
              if (!isCustomEnabled) {
                if (isMultiple) onToggleCustom()
                else onSelectCustom()
              }
            }}
            placeholder={t('questionDialog.typeYourAnswer')}
            rows={1}
            className="w-full bg-transparent text-sm text-text-100 placeholder:text-text-500 focus:outline-none resize-none min-h-[20px]"
          />
        </div>
      )}
    </div>
  )
}
