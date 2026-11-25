import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiSession } from '../../../api'
import type { NotificationEntry } from '../../../store/notificationStore'
import { NotificationItem } from './NotificationItem'

const { markReadMock, dismissMock } = vi.hoisted(() => ({
  markReadMock: vi.fn(),
  dismissMock: vi.fn(),
}))

vi.mock('../../../store/notificationStore', () => ({
  notificationStore: {
    markRead: markReadMock,
    dismiss: dismissMock,
  },
  // 与 store 内逻辑一致的占位判定：空 / "New session" 初始标题 / 原始 ID 截断（含类型后缀）
  isSettleableEntry: (entry: NotificationEntry) => {
    if (!entry.title || /^New session - \d{4}-\d{2}-\d{2}T/.test(entry.title)) return true
    const rawId8 = (entry.sessionId.includes('::') ? entry.sessionId.slice(entry.sessionId.indexOf('::') + 2) : entry.sessionId).slice(0, 8)
    if (!rawId8) return false
    const suffix = entry.type === 'permission' ? ' — Permission' : entry.type === 'question' ? ' — Question' : ''
    return entry.title === rawId8 + suffix
  },
}))

vi.mock('../../../hooks/useInputCapabilities', () => ({
  useInputCapabilities: () => ({ preferTouchUi: false }),
}))

describe('NotificationItem', () => {
  const entry: NotificationEntry = {
    id: 'notif-1',
    type: 'completed',
    title: 'Build finished',
    body: 'All tests passed',
    sessionId: 'session-1',
    timestamp: Date.now(),
    read: false,
  }
  const resolvedSession: ApiSession = {
    id: 'session-1',
    title: 'Build finished',
    directory: '/workspace',
  } as ApiSession

  beforeEach(() => {
    markReadMock.mockReset()
    dismissMock.mockReset()
  })

  it('renders a selectable row button and a separate dismiss action', () => {
    const onSelect = vi.fn()
    render(<NotificationItem entry={entry} resolvedSession={resolvedSession} onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('button', { name: /Build finished/i }))

    expect(markReadMock).toHaveBeenCalledWith('notif-1')
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'session-1' }))

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(dismissMock).toHaveBeenCalledWith('notif-1')
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('keeps the full notification row clickable outside the inner button', () => {
    const onSelect = vi.fn()
    render(<NotificationItem entry={entry} resolvedSession={resolvedSession} onSelect={onSelect} />)

    const rowButton = screen.getByRole('button', { name: /Build finished/i })
    const row = rowButton.parentElement

    expect(row).not.toBeNull()

    fireEvent.click(row!)

    expect(markReadMock).toHaveBeenCalledWith('notif-1')
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'session-1' }))
  })

  it('shows the resolved session title while the entry title is still a placeholder', () => {
    const onSelect = vi.fn()
    const placeholderEntry = { ...entry, title: 'New session - 2026-11-25T02:09:10.229Z' }
    render(
      <NotificationItem
        entry={placeholderEntry}
        resolvedSession={{ ...resolvedSession, title: 'Fix login bug' }}
        onSelect={onSelect}
      />,
    )

    expect(screen.getByText('Fix login bug')).toBeInTheDocument()
    expect(screen.queryByText('New session - 2026-11-25T02:09:10.229Z')).not.toBeInTheDocument()
  })
})
