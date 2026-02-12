// ============================================
// Message Cache Store - IndexedDB
// ============================================

import type { Part } from '../types/message'

interface CachedMessageParts {
  sessionId: string
  messageId: string
  parts: Part[]
  updatedAt: number
}

const DB_NAME = 'opencode-webui-cache'
const DB_VERSION = 1
const STORE_NAME = 'messageParts'

// 缓存过期时间：7 天
const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000

// 最大缓存条目数
const MAX_CACHE_ENTRIES = 1000

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' })
        store.createIndex('bySession', 'sessionId', { unique: false })
        store.createIndex('byUpdatedAt', 'updatedAt', { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function makeKey(sessionId: string, messageId: string): string {
  return `${sessionId}:${messageId}`
}

export class MessageCacheStore {
  private dbPromise: Promise<IDBDatabase> | null = null
  private cleanupScheduled = false

  private getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDb()
      // 首次打开数据库时，调度清理任务
      this.scheduleCleanup()
    }
    return this.dbPromise
  }

  /**
   * 调度清理任务（延迟执行，不阻塞主线程）
   */
  private scheduleCleanup() {
    if (this.cleanupScheduled) return
    this.cleanupScheduled = true

    // 使用 requestIdleCallback 或 setTimeout 在空闲时执行
    const runCleanup = () => {
      this.cleanupExpired().catch(err => {
        if (import.meta.env.DEV) {
          console.warn('[MessageCacheStore] Cleanup failed:', err)
        }
      })
    }

    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(runCleanup, { timeout: 5000 })
    } else {
      setTimeout(runCleanup, 3000)
    }
  }

  /**
   * 清理过期缓存
   * - 删除超过 CACHE_EXPIRY_MS 的条目
   * - 如果条目数超过 MAX_CACHE_ENTRIES，删除最旧的
   */
  async cleanupExpired(): Promise<{ deleted: number }> {
    let deleted = 0

    try {
      const db = await this.getDb()
      const now = Date.now()
      const expiryThreshold = now - CACHE_EXPIRY_MS

      // 第一步：删除过期条目
      const tx1 = db.transaction(STORE_NAME, 'readwrite')
      const store1 = tx1.objectStore(STORE_NAME)
      const index1 = store1.index('byUpdatedAt')

      // 获取所有过期的条目（updatedAt < expiryThreshold）
      const expiredRequest = index1.openCursor(IDBKeyRange.upperBound(expiryThreshold))

      await new Promise<void>((resolve, reject) => {
        expiredRequest.onsuccess = () => {
          const cursor = expiredRequest.result
          if (cursor) {
            cursor.delete()
            deleted++
            cursor.continue()
          } else {
            resolve()
          }
        }
        expiredRequest.onerror = () => reject(expiredRequest.error)
      })

      await new Promise<void>((resolve, reject) => {
        tx1.oncomplete = () => resolve()
        tx1.onerror = () => reject(tx1.error)
        tx1.onabort = () => reject(tx1.error)
      })

      // 第二步：检查总条目数，如果超过限制则删除最旧的
      const tx2 = db.transaction(STORE_NAME, 'readwrite')
      const store2 = tx2.objectStore(STORE_NAME)
      const countRequest = store2.count()

      const count = await new Promise<number>((resolve, reject) => {
        countRequest.onsuccess = () => resolve(countRequest.result)
        countRequest.onerror = () => reject(countRequest.error)
      })

      if (count > MAX_CACHE_ENTRIES) {
        const excess = count - MAX_CACHE_ENTRIES
        const index2 = store2.index('byUpdatedAt')
        const oldestRequest = index2.openCursor()
        let deletedForLimit = 0

        await new Promise<void>((resolve, reject) => {
          oldestRequest.onsuccess = () => {
            const cursor = oldestRequest.result
            if (cursor && deletedForLimit < excess) {
              cursor.delete()
              deleted++
              deletedForLimit++
              cursor.continue()
            } else {
              resolve()
            }
          }
          oldestRequest.onerror = () => reject(oldestRequest.error)
        })

        await new Promise<void>((resolve, reject) => {
          tx2.oncomplete = () => resolve()
          tx2.onerror = () => reject(tx2.error)
          tx2.onabort = () => reject(tx2.error)
        })
      }

      if (deleted > 0 && import.meta.env.DEV) {
        console.log(`[MessageCacheStore] Cleaned up ${deleted} expired/excess entries`)
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[MessageCacheStore] Cleanup error:', error)
      }
    }

    this.cleanupScheduled = false
    return { deleted }
  }

  /**
   * 获取缓存统计信息
   */
  async getStats(): Promise<{ count: number; oldestAge: number | null }> {
    try {
      const db = await this.getDb()
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)

      const countRequest = store.count()
      const count = await new Promise<number>((resolve, reject) => {
        countRequest.onsuccess = () => resolve(countRequest.result)
        countRequest.onerror = () => reject(countRequest.error)
      })

      let oldestAge: number | null = null
      if (count > 0) {
        const index = store.index('byUpdatedAt')
        const oldestRequest = index.openCursor()
        const oldest = await new Promise<CachedMessageParts | null>((resolve, reject) => {
          oldestRequest.onsuccess = () => {
            const cursor = oldestRequest.result
            resolve(cursor ? cursor.value : null)
          }
          oldestRequest.onerror = () => reject(oldestRequest.error)
        })
        if (oldest) {
          oldestAge = Date.now() - oldest.updatedAt
        }
      }

      return { count, oldestAge }
    } catch {
      return { count: 0, oldestAge: null }
    }
  }

  async setMessageParts(sessionId: string, messageId: string, parts: Part[]): Promise<void> {
    try {
      const db = await this.getDb()
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const payload = {
        key: makeKey(sessionId, messageId),
        sessionId,
        messageId,
        parts,
        updatedAt: Date.now(),
      }
      store.put(payload)
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[MessageCacheStore] Failed to persist parts', error)
      }
    }
  }

  async getMessageParts(sessionId: string, messageId: string): Promise<CachedMessageParts | null> {
    try {
      const db = await this.getDb()
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const key = makeKey(sessionId, messageId)
      const request = store.get(key)
      const result = await new Promise<CachedMessageParts | null>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result || null)
        request.onerror = () => reject(request.error)
      })
      return result
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[MessageCacheStore] Failed to read parts', error)
      }
      return null
    }
  }

  async deleteMessageParts(sessionId: string, messageId: string): Promise<void> {
    try {
      const db = await this.getDb()
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      store.delete(makeKey(sessionId, messageId))
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[MessageCacheStore] Failed to delete parts', error)
      }
    }
  }

  /**
   * 清空所有缓存（服务器切换时调用）
   */
  async clearAll(): Promise<void> {
    try {
      const db = await this.getDb()
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      store.clear()
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[MessageCacheStore] Failed to clear all cache', error)
      }
    }
  }

  async clearSession(sessionId: string): Promise<void> {
    try {
      const db = await this.getDb()
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const index = store.index('bySession')
      const request = index.openCursor(IDBKeyRange.only(sessionId))
      await new Promise<void>((resolve, reject) => {
        request.onsuccess = () => {
          const cursor = request.result
          if (cursor) {
            cursor.delete()
            cursor.continue()
          } else {
            resolve()
          }
        }
        request.onerror = () => reject(request.error)
      })
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[MessageCacheStore] Failed to clear session cache', error)
      }
    }
  }
}

export const messageCacheStore = new MessageCacheStore()
