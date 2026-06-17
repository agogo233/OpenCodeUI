// ============================================
// useModelSelection - 模型选择逻辑
// ============================================

import { useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef } from 'react'
import type { ModelInfo } from '../api'
import {
  getModelKey,
  findModelByKey,
  saveModelVariantPref,
  getModelVariantPref,
  getSessionModelSelection,
  saveSessionModelSelection,
} from '../utils/modelUtils'
import { serverStorage } from '../utils/perServerStorage'
import { STORAGE_KEY_SELECTED_MODEL } from '../constants'

interface UseModelSelectionOptions {
  models: ModelInfo[]
  sessionId?: string | null
}

interface UseModelSelectionReturn {
  selectedModelKey: string | null
  selectedVariant: string | undefined
  currentModel: ModelInfo | undefined
  handleModelChange: (modelKey: string, model: ModelInfo) => void
  handleVariantChange: (variant: string | undefined) => void
  restoreFromMessage: (
    model: { providerID: string; modelID: string } | null | undefined,
    variant: string | null | undefined,
  ) => void
}

export function useModelSelection({ models, sessionId = null }: UseModelSelectionOptions): UseModelSelectionReturn {
  const prevSessionIdRef = useRef(sessionId)
  const sessionSelectionRef = useRef<{ modelKey: string; variant?: string } | undefined>(undefined)

  if (prevSessionIdRef.current !== sessionId) {
    prevSessionIdRef.current = sessionId
    sessionSelectionRef.current = sessionId ? getSessionModelSelection(sessionId) : undefined
  }

  const sessionSelection = sessionSelectionRef.current
  const initialSessionModel = sessionSelection ? findModelByKey(models, sessionSelection.modelKey) : undefined

  const [{ selectedModelKey, selectedVariant }, setSelection] = useState<{
    selectedModelKey: string | null
    selectedVariant: string | undefined
  }>(() => {
    if (sessionSelection && initialSessionModel) {
      return {
        selectedModelKey: sessionSelection.modelKey,
        selectedVariant: sessionSelection.variant ?? getModelVariantPref(sessionSelection.modelKey),
      }
    }

    const initialModelKey = serverStorage.get(STORAGE_KEY_SELECTED_MODEL)

    return {
      selectedModelKey: initialModelKey,
      selectedVariant: initialModelKey ? getModelVariantPref(initialModelKey) : undefined,
    }
  })
  const hydratedSessionRef = useRef<string | null>(sessionSelection && !initialSessionModel ? null : sessionId)
  const skipPersistenceRef = useRef<string | null>(null)
  const selectedModelKeyRef = useRef(selectedModelKey)
  selectedModelKeyRef.current = selectedModelKey

  const persistedModel = selectedModelKey ? findModelByKey(models, selectedModelKey) : undefined
  const currentModel = useMemo(() => persistedModel ?? models[0], [models, persistedModel])
  // resolvedModelKey: 优先用用户选择的 key，否则回退到当前模型（保证总有有效值）
  // 如果 selectedModelKey 指向的模型已不在列表中（被隐藏/下线），立即回退到 currentModel
  const isKeyStale = selectedModelKey !== null && models.length > 0 && !persistedModel
  const resolvedModelKey = isKeyStale
    ? (currentModel ? getModelKey(currentModel) : null)
    : (selectedModelKey || (currentModel ? getModelKey(currentModel) : null))
  // 计算 variant 偏好：如果模型存在且是用户选择的，用当前 variant；否则从存储读取
  const resolvedSelectedVariant = useMemo(() => {
    if (!selectedModelKey) return undefined
    if (persistedModel) return selectedVariant
    return getModelVariantPref(selectedModelKey)
  }, [selectedModelKey, persistedModel, selectedVariant])

  useEffect(() => {
    if (!sessionId) {
      hydratedSessionRef.current = null
      return
    }

    if (hydratedSessionRef.current === sessionId) return

    if (!sessionSelection) {
      hydratedSessionRef.current = sessionId
      return
    }

    // 用户已手动选择了不同于存储值的模型，跳过 hydration
    if (selectedModelKey && selectedModelKey !== sessionSelection.modelKey) {
      hydratedSessionRef.current = sessionId
      return
    }

    const restoredModel = findModelByKey(models, sessionSelection.modelKey)
    if (!restoredModel) {
      if (models.length > 0) {
        hydratedSessionRef.current = sessionId
      }
      return
    }

    const nextVariant = sessionSelection.variant ?? getModelVariantPref(sessionSelection.modelKey)
    // Restoring the session-local model needs to happen before persistence runs,
    // otherwise the previous session's selection can be briefly written into the new session.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelection({
      selectedModelKey: sessionSelection.modelKey,
      selectedVariant: nextVariant,
    })
    skipPersistenceRef.current = sessionId
    hydratedSessionRef.current = sessionId
  }, [models, sessionId])

  // ============================================
  // Stale key 检测：当 models 列表变化后，如果 selectedModelKey 指向的模型
  // 不再存在于列表中（被隐藏/下线/移除），自动回退到 models[0] 并清除无效 key。
  // 这防止了 UI 显示 "选择模型" 而 API 仍然发送已不存在的旧 key 的问题。
  //
  // 使用 setTimeout(0) 延迟回退，避免模型批量加载期间的竞态条件：
  // 当 models 因 SSE 重连/服务器切换等原因过渡性地改变时，用户显式选择的
  // 模型可能暂时不在列表中。延迟执行让模型列表先稳定下来再决定是否回退。
  // ============================================
  useEffect(() => {
    if (models.length === 0) return
    if (!selectedModelKey) return
    if (findModelByKey(models, selectedModelKey)) return

    const timer = setTimeout(() => {
      const currentKey = selectedModelKeyRef.current
      if (!currentKey) return
      if (findModelByKey(models, currentKey)) return

      const fallbackKey = getModelKey(models[0])
      setSelection({
        selectedModelKey: fallbackKey,
        selectedVariant: getModelVariantPref(fallbackKey),
      })
    }, 0)
    return () => clearTimeout(timer)
  }, [models, selectedModelKey])

  useLayoutEffect(() => {
    // 有存储的 session 选择且尚未 hydration 时，延迟持久化。
    // 但如果用户已手动选择不同模型，允许立即持久化（防止被 hydration 覆盖）
    if (
      sessionId &&
      sessionSelection &&
      hydratedSessionRef.current !== sessionId &&
      (!selectedModelKey || selectedModelKey === sessionSelection.modelKey)
    ) return

    if (sessionId && skipPersistenceRef.current === sessionId) {
      skipPersistenceRef.current = null
      return
    }

    if (selectedModelKey) {
      serverStorage.set(STORAGE_KEY_SELECTED_MODEL, selectedModelKey)
      if (sessionId) {
        saveSessionModelSelection(sessionId, selectedModelKey, resolvedSelectedVariant)
      }
    }
  }, [selectedModelKey, resolvedSelectedVariant, sessionId])

  // 切换模型
  const handleModelChange = useCallback(
    (modelKey: string, _model: ModelInfo) => {
      // 先保存当前模型的 variant 偏好
      if (selectedModelKey && resolvedSelectedVariant) {
        saveModelVariantPref(selectedModelKey, resolvedSelectedVariant)
      }

      // 切换模型
      setSelection({
        selectedModelKey: modelKey,
        selectedVariant: getModelVariantPref(modelKey),
      })
    },
    [selectedModelKey, resolvedSelectedVariant],
  )

  // Variant 变化时保存偏好
  const handleVariantChange = useCallback(
    (variant: string | undefined) => {
      setSelection(prev => ({ ...prev, selectedVariant: variant }))
      if (selectedModelKey) {
        saveModelVariantPref(selectedModelKey, variant)
      }
    },
    [selectedModelKey],
  )

  // 从消息中恢复模型选择（仅更新内存状态，不写 storage）
  // 如果用户已手动选择了不同的模型，跳过恢复
  const restoreFromMessage = useCallback(
    (model: { providerID: string; modelID: string } | null | undefined, variant: string | null | undefined) => {
      if (!model) return

      const modelKey = `${model.providerID}:${model.modelID}`
      if (selectedModelKeyRef.current && selectedModelKeyRef.current !== modelKey) return

      const exists = findModelByKey(models, modelKey)

      if (exists) {
        setSelection({
          selectedModelKey: modelKey,
          selectedVariant: variant ?? getModelVariantPref(modelKey),
        })
      }
    },
    [models],
  )

  return {
    selectedModelKey: resolvedModelKey,
    selectedVariant: resolvedSelectedVariant,
    currentModel,
    handleModelChange,
    handleVariantChange,
    restoreFromMessage,
  }
}
