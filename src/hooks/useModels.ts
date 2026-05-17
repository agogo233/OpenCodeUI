import { useSyncExternalStore, useCallback } from 'react'
import { getActiveModels, type ModelInfo } from '../api'
import { getSDKClientAsync } from '../api/sdk'
import { serverStore } from '../store/serverStore'
import { serverStorage } from '../utils/perServerStorage'

const STORAGE_KEY_CACHED_MODELS = 'cached-models'

function readCachedModels(): ModelInfo[] {
  const data = serverStorage.getJSON<ModelInfo[]>(STORAGE_KEY_CACHED_MODELS)
  if (!Array.isArray(data) || data.length === 0) return []
  return data
}

function writeCachedModels(models: ModelInfo[]) {
  serverStorage.setJSON(STORAGE_KEY_CACHED_MODELS, models)
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
let _fetchGeneration = 0
const _listeners = new Set<Listener>()

function _notify() {
  for (const fn of _listeners) fn()
}

function _setState(patch: Partial<ModelsState>) {
  _state = { ..._state, ...patch }
  _notify()
}

async function _fetchModels(force = false) {
  if (_fetchPromise && !force) return _fetchPromise

  const generation = ++_fetchGeneration

  _fetchPromise = (async () => {
    _setState({ isLoading: true, error: null })
    try {
      await getSDKClientAsync()
      const data = await getActiveModels()
      if (data.length > 0) {
        writeCachedModels(data)
        _setState({ models: data, isLoading: false })
      } else {
        _setState({ isLoading: false, error: new Error('No active models returned from API') })
      }
    } catch (e) {
      _setState({
        error: e instanceof Error ? e : new Error('Failed to fetch models'),
        isLoading: false,
      })
    } finally {
      if (generation === _fetchGeneration) {
        _fetchPromise = null
      }
    }
  })()

  return _fetchPromise
}

export function refreshModels() {
  return _fetchModels(true)
}

// First fetch on module load — models are ready before any component mounts.
_fetchModels()

serverStore.onServerChange(() => {
  void refreshModels()
})

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
  const refetch = useCallback(() => refreshModels(), [])

  return {
    models: state.models,
    isLoading: state.isLoading,
    error: state.error,
    refetch,
  }
}
