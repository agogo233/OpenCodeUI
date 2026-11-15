import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeCommand, getCommands } from './command'

const listMock = vi.fn()
const sessionCommandMock = vi.fn()

vi.mock('./sdk', () => ({
  getSDKClient: () => ({
    command: {
      list: (...args: unknown[]) => listMock(...args),
    },
    session: {
      command: (...args: unknown[]) => sessionCommandMock(...args),
    },
  }),
  unwrap: (result: { data?: unknown }) => result.data,
}))

vi.mock('../store/serverStore', () => ({
  serverStore: {
    getActiveServerId: () => 'test-server',
  },
}))

describe('executeCommand', () => {
  beforeEach(() => {
    sessionCommandMock.mockReset()
  })

  it('forwards agent to the session command request when provided', async () => {
    sessionCommandMock.mockResolvedValue({ data: { ok: true } })

    await executeCommand('session-1', 'review', 'src/App.tsx', '/workspace/demo', 'srv-1', 'prov-1/model-1', 'plan')

    expect(sessionCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: 'session-1',
        command: 'review',
        arguments: 'src/App.tsx',
        model: 'prov-1/model-1',
        agent: 'plan',
      }),
    )
  })

  it('omits agent field when not provided', async () => {
    sessionCommandMock.mockResolvedValue({ data: { ok: true } })

    await executeCommand('session-1', 'review', 'src/App.tsx', '/workspace/demo', 'srv-1')

    const params = sessionCommandMock.mock.calls[0][0] as Record<string, unknown>
    expect(params.command).toBe('review')
    expect('agent' in params).toBe(false)
    expect('model' in params).toBe(false)
  })
})

describe('getCommands', () => {
  beforeEach(() => {
    listMock.mockReset()
  })

  it('marks frontend and api commands with stable sources', async () => {
    listMock.mockResolvedValue({ data: [{ name: 'review', description: 'Run project review' }] })

    const commands = await getCommands('/workspace/project')

    expect(commands).toEqual([
      { name: 'review', description: 'Run project review', source: 'api' },
      { name: 'new', description: 'Create a new chat session', source: 'frontend' },
      { name: 'compact', description: 'Compact session by summarizing conversation history', source: 'frontend' },
    ])
  })

  it('keeps API commands as api commands even if names overlap frontend commands', async () => {
    listMock.mockResolvedValue({ data: [{ name: 'compact', description: 'Native compact command' }] })

    const commands = await getCommands('/workspace/project-overlap')

    expect(commands).toEqual([
      { name: 'compact', description: 'Native compact command', source: 'api' },
      { name: 'new', description: 'Create a new chat session', source: 'frontend' },
    ])
  })
})
