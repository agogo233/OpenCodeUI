import { beforeEach, describe, expect, it, vi } from 'vitest'
import { notificationStore } from './notificationStore'

const STORAGE_KEY = 'opencode:notifications'

function storedCount(): number {
  return (JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as unknown[]).length
}

describe('notificationStore.dedupeBySession', () => {
  beforeEach(() => {
    localStorage.clear()
    notificationStore.clearAll()
  })

  it('keeps only the newest entry per session', () => {
    notificationStore.push('completed', 'A', 'Session completed', 's1')
    notificationStore.push('permission', 'B — Permission', 'bash: ls', 's2')
    notificationStore.push('completed', 'A', 'Session completed (run #2)', 's1')

    const removed = notificationStore.dedupeBySession()
    const list = notificationStore.getSnapshot().notifications

    expect(removed).toBe(1)
    expect(list.map(n => n.sessionId)).toEqual(['s1', 's2'])
    expect(list[0].type).toBe('completed')
    expect(list[0].body).toBe('Session completed (run #2)')
    expect(storedCount()).toBe(2)
  })

  it('merges across notification types within the same session', () => {
    notificationStore.push('permission', 'A — Permission', 'bash: ls', 's1')
    notificationStore.push('completed', 'A', 'Session completed', 's1')

    expect(notificationStore.dedupeBySession()).toBe(1)
    const list = notificationStore.getSnapshot().notifications
    expect(list).toHaveLength(1)
    expect(list[0].type).toBe('completed')
  })

  it('keeps entries with empty sessionId untouched', () => {
    notificationStore.push('error', 'Permission reply failed', 'msg1', '')
    notificationStore.push('error', 'Question reply failed', 'msg2', '')

    expect(notificationStore.dedupeBySession()).toBe(0)
    expect(notificationStore.getSnapshot().notifications).toHaveLength(2)
  })

  it('returns 0 and skips persist/notify when nothing to dedupe', () => {
    notificationStore.push('completed', 'A', 'Session completed', 's1')
    notificationStore.push('completed', 'B', 'Session completed', 's2')

    const subscriber = vi.fn()
    const unsubscribe = notificationStore.subscribe(subscriber)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    expect(notificationStore.dedupeBySession()).toBe(0)
    expect(subscriber).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(storedCount()).toBe(2)

    unsubscribe()
    setItemSpy.mockRestore()
  })

  it('returns 0 on empty history', () => {
    expect(notificationStore.dedupeBySession()).toBe(0)
    expect(notificationStore.getSnapshot().notifications).toHaveLength(0)
    expect(storedCount()).toBe(0)
  })
})
