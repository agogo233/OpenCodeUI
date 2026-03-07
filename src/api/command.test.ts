import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getCommands } from './command'

const getMock = vi.fn()

vi.mock('./http', () => ({
  get: (...args: unknown[]) => getMock(...args),
  post: vi.fn(),
}))

vi.mock('../store/serverStore', () => ({
  serverStore: {
    getActiveServerId: () => 'test-server',
  },
}))

describe('getCommands', () => {
  beforeEach(() => {
    getMock.mockReset()
  })

  it('marks frontend and api commands with stable sources', async () => {
    getMock.mockResolvedValue([{ name: 'review', description: 'Run project review' }])

    const commands = await getCommands('/workspace/project')

    expect(commands).toEqual([
      { name: 'review', description: 'Run project review', source: 'api' },
      { name: 'new', description: 'Create a new chat session', source: 'frontend' },
      { name: 'compact', description: 'Compact session by summarizing conversation history', source: 'frontend' },
    ])
  })

  it('keeps API commands as api commands even if names overlap frontend commands', async () => {
    getMock.mockResolvedValue([{ name: 'compact', description: 'Native compact command' }])

    const commands = await getCommands('/workspace/project-overlap')

    expect(commands).toEqual([
      { name: 'compact', description: 'Native compact command', source: 'api' },
      { name: 'new', description: 'Create a new chat session', source: 'frontend' },
    ])
  })
})
