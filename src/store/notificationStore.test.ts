import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isSettleableEntry, isSessionTitlePlaceholder, notificationStore } from './notificationStore'

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

describe('notificationStore.clearByTypes', () => {
  beforeEach(() => {
    localStorage.clear()
    notificationStore.clearAll()
    // 单例 toast 跨 describe 残留，需一并清除保证隔离
    notificationStore.dismissAllToasts()
  })

  it('removes only completed and permission entries, keeps question and error', () => {
    notificationStore.push('completed', 'A', 'Session completed', 's1')
    notificationStore.push('permission', 'B — Permission', 'bash: ls', 's2')
    notificationStore.push('question', 'C — Question', 'waiting', 's3')
    notificationStore.push('error', 'Session error', 'boom', 's4')

    const removed = notificationStore.clearByTypes(['completed', 'permission'])
    const list = notificationStore.getSnapshot().notifications

    expect(removed).toBe(2)
    expect(list.map(n => n.type)).toEqual(['error', 'question'])
    expect(storedCount()).toBe(2)
  })

  it('also dismisses active toasts of the cleared types', () => {
    notificationStore.push('completed', 'A', 'Session completed', 's1')
    notificationStore.push('question', 'B — Question', 'waiting', 's2')

    notificationStore.clearByTypes(['completed'])

    const toasts = notificationStore.getSnapshot().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].notification.type).toBe('question')
  })

  it('returns 0 and skips persist/notify when nothing matches', () => {
    notificationStore.push('question', 'A — Question', 'waiting', 's1')

    const subscriber = vi.fn()
    const unsubscribe = notificationStore.subscribe(subscriber)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    expect(notificationStore.clearByTypes(['completed', 'permission'])).toBe(0)
    expect(subscriber).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(storedCount()).toBe(1)

    unsubscribe()
    setItemSpy.mockRestore()
  })

  it('persists removal to localStorage', () => {
    notificationStore.push('completed', 'A', 'Session completed', 's1')
    notificationStore.push('completed', 'B', 'Session completed', 's2')

    expect(notificationStore.clearByTypes(['completed'])).toBe(2)
    expect(storedCount()).toBe(0)
  })
})

const RAW_ID = 'sess_abcdef12'
const SCOPED_ID = `local::${RAW_ID}`
const PLACEHOLDER = 'New session - 2026-11-25T02:09:10.229Z'

describe('isSessionTitlePlaceholder', () => {
  it('detects empty, undefined and backend default titles', () => {
    expect(isSessionTitlePlaceholder()).toBe(true)
    expect(isSessionTitlePlaceholder('')).toBe(true)
    expect(isSessionTitlePlaceholder(PLACEHOLDER)).toBe(true)
    expect(isSessionTitlePlaceholder('Fix login bug')).toBe(false)
  })
})

describe('isSettleableEntry', () => {
  it('detects raw id truncation placeholders with type suffixes', () => {
    const rawId8 = RAW_ID.slice(0, 8)
    expect(isSettleableEntry({ id: '1', type: 'completed', title: rawId8, body: '', sessionId: SCOPED_ID, timestamp: 0, read: false })).toBe(true)
    expect(isSettleableEntry({ id: '2', type: 'permission', title: `${rawId8} — Permission`, body: '', sessionId: SCOPED_ID, timestamp: 0, read: false })).toBe(true)
    expect(isSettleableEntry({ id: '3', type: 'question', title: `${rawId8} — Question`, body: '', sessionId: SCOPED_ID, timestamp: 0, read: false })).toBe(true)
    expect(isSettleableEntry({ id: '4', type: 'completed', title: 'Fix login bug', body: '', sessionId: SCOPED_ID, timestamp: 0, read: false })).toBe(false)
  })

  it('ignores error entries with message titles or empty session id', () => {
    expect(isSettleableEntry({ id: '5', type: 'error', title: 'Permission reply failed', body: '', sessionId: '', timestamp: 0, read: false })).toBe(false)
    expect(isSettleableEntry({ id: '6', type: 'error', title: 'Reply failed', body: '', sessionId: SCOPED_ID, timestamp: 0, read: false })).toBe(false)
  })
})

describe('notificationStore.settleSessionTitles', () => {
  beforeEach(() => {
    localStorage.clear()
    notificationStore.clearAll()
  })

  it('settles placeholder titles of a session to the real title', () => {
    notificationStore.push('completed', RAW_ID.slice(0, 8), 'Session completed', SCOPED_ID)
    notificationStore.push('permission', `${RAW_ID.slice(0, 8)} — Permission`, 'bash: ls', SCOPED_ID)

    notificationStore.settleSessionTitles(SCOPED_ID, 'Fix login bug')

    const list = notificationStore.getSnapshot().notifications
    // push 头插：后 push 的 permission 在前
    expect(list.map(n => n.title)).toEqual(['Fix login bug — Permission', 'Fix login bug'])
  })

  it('settles the backend default "New session" title', () => {
    notificationStore.push('completed', PLACEHOLDER, 'Session completed', SCOPED_ID)

    notificationStore.settleSessionTitles(SCOPED_ID, 'Fix login bug')

    expect(notificationStore.getSnapshot().notifications[0].title).toBe('Fix login bug')
  })

  it('never overwrites already-settled real titles', () => {
    notificationStore.push('completed', 'Old settled title', 'Session completed', SCOPED_ID)

    notificationStore.settleSessionTitles(SCOPED_ID, 'Fix login bug')

    expect(notificationStore.getSnapshot().notifications[0].title).toBe('Old settled title')
  })

  it('rejects placeholder session titles', () => {
    notificationStore.push('completed', RAW_ID.slice(0, 8), 'Session completed', SCOPED_ID)

    notificationStore.settleSessionTitles(SCOPED_ID, PLACEHOLDER)

    expect(notificationStore.getSnapshot().notifications[0].title).toBe(RAW_ID.slice(0, 8))
  })

  it('leaves entries of other sessions untouched', () => {
    notificationStore.push('completed', RAW_ID.slice(0, 8), 'Session completed', 'remote::sess_abcdef12')

    notificationStore.settleSessionTitles(SCOPED_ID, 'Fix login bug')

    expect(notificationStore.getSnapshot().notifications[0].title).toBe(RAW_ID.slice(0, 8))
  })

  it('skips persist/notify when nothing to settle', () => {
    notificationStore.push('completed', 'Old settled title', 'Session completed', SCOPED_ID)

    const subscriber = vi.fn()
    const unsubscribe = notificationStore.subscribe(subscriber)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    notificationStore.settleSessionTitles(SCOPED_ID, 'Fix login bug')

    expect(subscriber).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()

    unsubscribe()
    setItemSpy.mockRestore()
  })

  it('is idempotent after settling', () => {
    notificationStore.push('completed', RAW_ID.slice(0, 8), 'Session completed', SCOPED_ID)

    notificationStore.settleSessionTitles(SCOPED_ID, 'Fix login bug')

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    notificationStore.settleSessionTitles(SCOPED_ID, 'Fix login bug')
    expect(setItemSpy).not.toHaveBeenCalled()
    setItemSpy.mockRestore()
  })
})
