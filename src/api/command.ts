// ============================================
// Command API - 命令列表和执行
// ============================================

import { get, post } from './http'
import { formatPathForApi } from '../utils/directoryUtils'

export interface Command {
  name: string
  description?: string
  keybind?: string
}

// Builtin commands handled by dedicated endpoints, not returned by GET /command.
// Mirrors the official web app's hardcoded command registrations.
// See: sst/opencode packages/app/src/pages/session.tsx — "session.compact"
const BUILTIN_COMMANDS: Command[] = [
  { name: 'compact', description: 'Compact session by summarizing conversation history' },
]

export async function getCommands(directory?: string): Promise<Command[]> {
  let apiCommands: Command[] = []
  try {
    apiCommands = await get<Command[]>('/command', { directory: formatPathForApi(directory) })
  } catch {
    // Backend unreachable — builtins still available
  }
  const apiNames = new Set(apiCommands.map(c => c.name))
  return [...apiCommands, ...BUILTIN_COMMANDS.filter(c => !apiNames.has(c.name))]
}

export async function executeCommand(
  sessionId: string,
  command: string,
  args: string = '',
  directory?: string
): Promise<unknown> {
  return post(
    `/session/${sessionId}/command`,
    { directory: formatPathForApi(directory) },
    { command, arguments: args }
  )
}
