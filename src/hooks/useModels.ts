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
      if (generation === _fetchGeneration) {
        if (data.length > 0) {
          writeCachedModels(data)
          _setState({ models: data, isLoading: false })
        } else {
          _setState({ isLoading: false, error: new Error('No active models returned from API') })
        }
      }
    } catch (e) {
      if (generation === _fetchGeneration) {
        const cached = readCachedModels()
        _setState({
          models: cached.length > 0 ? cached : [],
          error: e instanceof Error ? e : new Error('Failed to fetch models'),
          isLoading: false,
        })
      }
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

_fetchModels()

serverStore.onServerChange(() => {
  serverStorage.remove(STORAGE_KEY_CACHED_MODELS)
  void refreshModels()
})

function _subscribe(listener: Listener) {
  _listeners.add(listener)
  return () => _listeners.delete(listener)
}

function _getSnapshot(): ModelsState {
  return _state
}

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