import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InputBox } from './InputBox'
import type { Command } from '../../api/command'

let slashCommands: Command[] = []

vi.mock('../attachment', () => ({
  AttachmentPreview: () => null,
}))

vi.mock('../mention', () => ({
  MentionMenu: () => null,
  detectMentionTrigger: () => null,
  normalizePath: (value: string) => value,
  toFileUrl: (value: string) => value,
}))

vi.mock('../slash-command', () => ({
  SlashCommandMenu: ({ isOpen, onSelect }: { isOpen: boolean; onSelect: (command: Command) => void }) =>
    isOpen ? (
      <div>
        {slashCommands.map(command => (
          <button key={command.name} type="button" onClick={() => onSelect(command)}>
            {command.name}
          </button>
        ))}
      </div>
    ) : null,
}))

vi.mock('./input/InputToolbar', () => ({
  InputToolbar: () => null,
}))

vi.mock('./input/InputFooter', () => ({
  InputFooter: () => null,
}))

vi.mock('./input/UndoStatus', () => ({
  UndoStatus: () => null,
}))

vi.mock('../../hooks', () => ({
  useIsMobile: () => false,
}))

vi.mock('../../store/messageStore', () => ({
  useMessages: () => [],
}))

vi.mock('../../store/keybindingStore', () => ({
  keybindingStore: {
    getKey: () => null,
  },
  matchesKeybinding: () => false,
}))

describe('InputBox slash command selection', () => {
  beforeEach(() => {
    slashCommands = []
  })

  it('executes frontend commands immediately on selection', async () => {
    slashCommands = [{ name: 'compact', description: 'Compact session', source: 'frontend' }]
    const onCommand = vi.fn()

    render(<InputBox onSend={vi.fn()} onCommand={onCommand} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/', selectionStart: 1 } })
    fireEvent.click(screen.getByRole('button', { name: 'compact' }))

    await waitFor(() => {
      expect(onCommand).toHaveBeenCalledWith('/compact')
      expect(textarea.value).toBe('')
    })
  })

  it('keeps api commands on attachment insertion path', async () => {
    slashCommands = [{ name: 'review', description: 'Run review', source: 'api' }]
    const onCommand = vi.fn()

    render(<InputBox onSend={vi.fn()} onCommand={onCommand} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/', selectionStart: 1 } })
    fireEvent.click(screen.getByRole('button', { name: 'review' }))

    await waitFor(() => {
      expect(onCommand).not.toHaveBeenCalled()
      expect(textarea.value).toBe('/review ')
    })
  })
})
