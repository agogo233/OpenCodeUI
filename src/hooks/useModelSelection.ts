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

  const manualSelectionRef = useRef<string | null>(null)

  if (prevSessionIdRef.current !== sessionId) {
    prevSessionIdRef.current = sessionId
    sessionSelectionRef.current = sessionId ? getSessionModelSelection(sessionId) : undefined
    manualSelectionRef.current = null
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

  useLayoutEffect(() => {
    if (models.length === 0) return
    if (selectedModelKey === null) return
    if (findModelByKey(models, selectedModelKey)) return

    const fallbackKey = getModelKey(models[0])
    setSelection({
      selectedModelKey: fallbackKey,
      selectedVariant: getModelVariantPref(fallbackKey),
    })
  }, [models, selectedModelKey])

  useLayoutEffect(() => {
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

// 写入前校验 key 有效性：若 selectedModelKey 指向的模型不再存在，
    // 改用回退 key，防止 stale key 被持久化到 storage
    const effectiveKey = (selectedModelKey && findModelByKey(models, selectedModelKey))
      ? selectedModelKey
      : (models.length > 0 ? getModelKey(models[0]) : null)

    if (effectiveKey) {
      serverStorage.set(STORAGE_KEY_SELECTED_MODEL, effectiveKey)
      if (sessionId) {
        saveSessionModelSelection(sessionId, effectiveKey, resolvedSelectedVariant)
      }
    }
  }, [selectedModelKey, resolvedSelectedVariant, sessionId, models])

  const handleModelChange = useCallback(
    (modelKey: string, _model: ModelInfo) => {
      manualSelectionRef.current = modelKey

      if (selectedModelKey && resolvedSelectedVariant) {
        saveModelVariantPref(selectedModelKey, resolvedSelectedVariant)
      }

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

  const restoreFromMessage = useCallback(
    (model: { providerID: string; modelID: string } | null | undefined, variant: string | null | undefined) => {
      if (!model) return

      const modelKey = `${model.providerID}:${model.modelID}`
      // 只在用户仍持有一个有效的、不同的手动选择时跳过恢复
      if (manualSelectionRef.current && manualSelectionRef.current !== modelKey) {
        if (findModelByKey(models, manualSelectionRef.current)) return
      }

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
