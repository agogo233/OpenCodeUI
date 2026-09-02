import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolPartView } from './ToolPartView'
import type { ToolPart } from '../../../types/message'
import { findPermissionRequestForTool } from '../../chat/InlineToolRequestContext'
import { DefaultRenderer, extractToolData } from '../tools'
import { useTheme } from '../../../hooks/useTheme'

const { getActiveCalibratedNowMock } = vi.hoisted(() => ({
  getActiveCalibratedNowMock: vi.fn<() => number | undefined>(() => undefined),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'toolPart.running') return 'Running'
      if (key === 'toolPart.failed') return 'Failed'
      return key
    },
  }),
}))

vi.mock('../../../hooks', () => ({
  useDelayedRender: (show: boolean) => show,
  useDisclosureScrollLock: () => ({
    rootRef: () => undefined,
    headerRef: () => undefined,
    withScrollLock: (action: () => void) => action(),
  }),
  useCompositorExpand: (open: boolean) => ({
    contentRef: { current: null },
    layoutOpen: open,
    keepMounted: open,
    panelClassName: 'transition-[grid-template-rows] duration-300 ease-in-out',
  }),
}))

vi.mock('../../../hooks/useTheme', () => ({
  useTheme: vi.fn(() => ({
    inlineToolRequests: false,
    immersiveMode: false,
    compactInlinePermission: false,
  })),
}))

vi.mock('../../../store/serverStore', () => ({
  serverStore: {
    getActiveCalibratedNow: getActiveCalibratedNowMock,
  },
}))

vi.mock('../../chat/InlineToolRequestContext', () => ({
  useInlineToolRequests: () => ({
    pendingPermissions: [],
    pendingQuestions: [],
    onPermissionReply: vi.fn(),
    onQuestionReply: vi.fn(),
    onQuestionReject: vi.fn(),
    isReplying: false,
  }),
  findPermissionRequestForTool: vi.fn(() => undefined),
  findQuestionRequestForTool: vi.fn(() => undefined),
}))

vi.mock('../../chat/InlinePermission', () => ({
  InlinePermission: () => null,
}))

vi.mock('../../chat/InlineQuestion', () => ({
  InlineQuestion: () => null,
}))

vi.mock('../tools', () => ({
  getToolIcon: () => <span data-testid="tool-icon">icon</span>,
  extractToolData: vi.fn(() => ({})),
  getToolConfig: vi.fn(() => undefined),
  DefaultRenderer: vi.fn(() => null),
  TodoRenderer: vi.fn(() => null),
  TaskRenderer: vi.fn(() => null),
  hasTodos: vi.fn(() => false),
}))

function createRunningToolPart(): ToolPart {
  return {
    id: 'tool-1',
    sessionID: 'session-1',
    messageID: 'message-1',
    type: 'tool',
    callID: 'call-1',
    tool: 'bash',
    state: {
      status: 'running',
      title: 'npm run build',
      time: { start: 7_500 },
    },
  }
}

describe('ToolPartView running duration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    getActiveCalibratedNowMock.mockReset()
    getActiveCalibratedNowMock.mockReturnValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('falls back to local wall clock when calibration is unavailable', () => {
    render(<ToolPartView part={createRunningToolPart()} />)

    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('2.5s')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(screen.getByText('3.0s')).toBeInTheDocument()
  })

  it('uses calibrated server time for running tools when available', () => {
    getActiveCalibratedNowMock.mockReturnValue(11_000)

    render(<ToolPartView part={createRunningToolPart()} />)

    expect(screen.getByText('3.5s')).toBeInTheDocument()
  })

  it('clamps running duration to zero when calibrated time is earlier than start', () => {
    getActiveCalibratedNowMock.mockReturnValue(7_000)

    render(<ToolPartView part={createRunningToolPart()} />)

    expect(screen.getByText('0ms')).toBeInTheDocument()
  })

  it('rounds calibrated sub-second durations before rendering', () => {
    getActiveCalibratedNowMock.mockReturnValue(7_623.456)

    render(<ToolPartView part={createRunningToolPart()} />)

    expect(screen.getByText('123ms')).toBeInTheDocument()
  })

  it('uses shared item spacing on compact and descriptive roots', () => {
    const part = createRunningToolPart()
    const { container, rerender } = render(<ToolPartView part={part} compact />)
    expect(container.firstElementChild?.className).toContain('pt-1')

    rerender(<ToolPartView part={part} descriptive />)
    expect(container.firstElementChild?.className).toContain('pt-1')
  })
})

function createEditToolPart(input: Record<string, unknown> = { filePath: 'f.ts' }): ToolPart {
  return {
    id: 'tool-1',
    sessionID: 'session-1',
    messageID: 'message-1',
    type: 'tool',
    callID: 'call-1',
    tool: 'edit',
    state: {
      status: 'running',
      input,
      time: { start: 7_500 },
    },
  }
}

describe('ToolPartView pending edit/write permission content', () => {
  const editReq = { id: 'p1', sessionID: 'session-1', permission: 'edit', tool: { callID: 'call-1' } }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    getActiveCalibratedNowMock.mockReturnValue(undefined)
    vi.mocked(useTheme).mockReturnValue({
      inlineToolRequests: true,
      immersiveMode: false,
      compactInlinePermission: false,
    } as never)
    vi.mocked(findPermissionRequestForTool).mockReset()
    vi.mocked(extractToolData).mockReset()
    vi.mocked(DefaultRenderer).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders tool content before approval when edit diff is available', () => {
    vi.mocked(findPermissionRequestForTool).mockReturnValue(editReq as never)
    vi.mocked(extractToolData).mockReturnValue({ diff: { before: 'const a = 1', after: 'const a = 2' } })
    vi.mocked(DefaultRenderer).mockReturnValue(<div data-testid="tool-body" />)

    const part = createEditToolPart({ filePath: 'f.ts', oldString: 'const a = 1', newString: 'const a = 2' })
    render(<ToolPartView part={part} />)

    expect(DefaultRenderer).toHaveBeenCalled()
    expect(screen.getByTestId('tool-body')).toBeInTheDocument()
  })

  it('keeps tool content hidden before approval when there is no content to show', () => {
    vi.mocked(findPermissionRequestForTool).mockReturnValue(editReq as never)
    vi.mocked(extractToolData).mockReturnValue({})

    const part = createEditToolPart({ filePath: 'f.ts' })
    render(<ToolPartView part={part} />)

    expect(DefaultRenderer).not.toHaveBeenCalled()
  })
})

function createReadToolPart(title?: string): ToolPart {
  return {
    id: 'tool-1',
    sessionID: 'session-1',
    messageID: 'message-1',
    type: 'tool',
    callID: 'call-1',
    tool: 'read',
    state: {
      status: 'running',
      title,
      input: { filePath: 'src/foo.ts' },
      time: { start: 7_500 },
    },
  }
}

describe('ToolPartView title fallback to file path', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    getActiveCalibratedNowMock.mockReturnValue(undefined)
    vi.mocked(extractToolData).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows file path in header when tool has no title or description', () => {
    vi.mocked(extractToolData).mockReturnValue({ filePath: 'src/foo.ts' })

    render(<ToolPartView part={createReadToolPart()} />)

    expect(screen.getByText('src/foo.ts')).toBeInTheDocument()
  })

  it('prefers state.title over file path', () => {
    vi.mocked(extractToolData).mockReturnValue({ filePath: 'src/foo.ts' })

    render(<ToolPartView part={createReadToolPart('custom title')} />)

    expect(screen.getByText('custom title')).toBeInTheDocument()
    expect(screen.queryByText('src/foo.ts')).not.toBeInTheDocument()
  })
})
