import { useSyncExternalStore, useCallback } from 'react'
import { getActiveModels, type ModelInfo } from '../api'
import { serverStorage } from '../utils/perServerStorage'

// ============================================
// Storage cache for model list — survives page refresh so users don't
// lose model visibility/selection when the backend API temporarily
// returns fewer models or is unreachable.
// ============================================

const STORAGE_KEY_CACHED_MODELS = 'cached-models'

function readCachedModels(): ModelInfo[] {
  const data = serverStorage.getJSON<ModelInfo[]>(STORAGE_KEY_CACHED_MODELS)
  if (!Array.isArray(data) || data.length === 0) return []
  return data
}

function writeCachedModels(models: ModelInfo[]) {
  serverStorage.setJSON(STORAGE_KEY_CACHED_MODELS, models)
}

function getModelKey(m: ModelInfo): string {
  return `${m.providerId}:${m.id}`
}

function mergeModels(existing: ModelInfo[], incoming: ModelInfo[]): ModelInfo[] {
  const map = new Map<string, ModelInfo>()
  for (const m of existing) map.set(getModelKey(m), m)
  for (const m of incoming) map.set(getModelKey(m), m)
  return Array.from(map.values())
}

// ============================================
// Global singleton so every ChatPane shares one models array.
// Prevents duplicate API requests and the race condition where a
// late-mounting pane sees an empty models list, falls back to
// models[0], and overwrites the persisted model selection.
// ============================================

interface ModelsState {
  models: ModelInfo[]
  isLoading: boolean
  error: Error | null
}

type Listener = () => void

const cached = readCachedModels()
let _state: ModelsState = { models: cached, isLoading: cached.length === 0, error: null }
let _fetchPromise: Promise<void> | null = null
const _listeners = new Set<Listener>()

function _notify() {
  for (const fn of _listeners) fn()
}

function _setState(patch: Partial<ModelsState>) {
  _state = { ..._state, ...patch }
  _notify()
}

async function _fetchModels() {
  if (_fetchPromise) return _fetchPromise

  _fetchPromise = (async () => {
    _setState({ isLoading: true, error: null })
    try {
      const data = await getActiveModels()
      if (data.length > 0) {
        const merged = mergeModels(_state.models, data)
        writeCachedModels(merged)
        _setState({ models: merged, isLoading: false })
      } else {
        // API returned empty — keep current models (cache fallback)
        _setState({ isLoading: false, error: new Error('No active models returned from API') })
      }
    } catch (e) {
      _setState({
        error: e instanceof Error ? e : new Error('Failed to fetch models'),
        isLoading: false,
      })
    } finally {
      _fetchPromise = null
    }
  })()

  return _fetchPromise
}

// First fetch on module load — models are ready before any component mounts.
_fetchModels()

function _subscribe(listener: Listener) {
  _listeners.add(listener)
  return () => _listeners.delete(listener)
}

function _getSnapshot(): ModelsState {
  return _state
}

// ============================================
// Hook — drop-in replacement, same return type
// ============================================

interface UseModelsResult {
  models: ModelInfo[]
  isLoading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

export function useModels(): UseModelsResult {
  const state = useSyncExternalStore(_subscribe, _getSnapshot)
  const refetch = useCallback(() => _fetchModels(), [])

  return {
    models: state.models,
    isLoading: state.isLoading,
    error: state.error,
    refetch,
  }
}
