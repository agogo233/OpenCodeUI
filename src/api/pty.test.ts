import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSDKClientMock, getServerBaseUrlMock, getActiveBaseUrlMock, getServerAuthMock, getActiveAuthMock } =
  vi.hoisted(() => ({
    getSDKClientMock: vi.fn<() => unknown>(),
    getServerBaseUrlMock: vi.fn<() => string>(() => 'http://127.0.0.1:4096'),
    getActiveBaseUrlMock: vi.fn<() => string>(() => 'http://127.0.0.1:4096'),
    getServerAuthMock: vi.fn<() => { username: string; password: string } | null>(() => null),
    getActiveAuthMock: vi.fn<() => { username: string; password: string } | null>(() => null),
  }))

vi.mock('./sdk', () => ({
  getSDKClient: getSDKClientMock,
  unwrap: (result: { data?: unknown; error?: unknown }) => {
    if (result.error != null) {
      throw result.error instanceof Error ? result.error : new Error(String(result.error))
    }
    return result.data
  },
}))

vi.mock('../store/serverStore', () => ({
  serverStore: {
    getServerBaseUrl: getServerBaseUrlMock,
    getActiveBaseUrl: getActiveBaseUrlMock,
    getServerAuth: getServerAuthMock,
    getActiveAuth: getActiveAuthMock,
  },
  makeBasicAuthHeader: vi.fn(() => 'Basic token'),
}))

vi.mock('../utils/directoryUtils', () => ({
  formatPathForApi: (dir?: string) => dir,
}))

vi.mock('../utils/logger', () => ({
  logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const AUTH = { username: 'opencode', password: 's3cret' } as const
const AUTH_TOKEN = btoa('opencode:s3cret')
const REMOTE_BASE = 'http://10.0.0.5:4096'

describe('getPtyConnectUrl', () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    getServerBaseUrlMock.mockReturnValue('http://127.0.0.1:4096')
    getActiveBaseUrlMock.mockReturnValue('http://127.0.0.1:4096')
    getServerAuthMock.mockReturnValue(null)
    getActiveAuthMock.mockReturnValue(null)
  })

  it('puts the ticket in the URL and keeps credentials out even when a password is set', async () => {
    const { getPtyConnectUrl } = await import('./pty')
    getServerBaseUrlMock.mockReturnValue('http://127.0.0.1:4096')
    getServerAuthMock.mockReturnValue(AUTH)

    const url = getPtyConnectUrl('pty_1', '/tmp/project', { cursor: 5, ticket: 'tk-abc' }, 'srv-1')

    expect(url).toBe('ws://127.0.0.1:4096/pty/pty_1/connect?directory=%2Ftmp%2Fproject&cursor=5&ticket=tk-abc')
    expect(url).not.toContain('auth_token')
    expect(url).not.toContain('@')
  })

  it('never adds auth_token for a cross-origin base when a ticket was obtained', async () => {
    const { getPtyConnectUrl } = await import('./pty')
    getActiveBaseUrlMock.mockReturnValue(REMOTE_BASE)
    getActiveAuthMock.mockReturnValue(AUTH)

    const url = getPtyConnectUrl('pty_1', '/tmp/project', { cursor: 0, ticket: 'tk-abc' })

    expect(url).toBe('ws://10.0.0.5:4096/pty/pty_1/connect?directory=%2Ftmp%2Fproject&cursor=0&ticket=tk-abc')
    expect(url).not.toContain('auth_token')
  })

  it('keeps the ticket on the Tauri path where credentials travel via headers', async () => {
    const { getPtyConnectUrl } = await import('./pty')
    getServerBaseUrlMock.mockReturnValue(REMOTE_BASE)
    getServerAuthMock.mockReturnValue(AUTH)

    const url = getPtyConnectUrl(
      'pty_1',
      '/tmp/project',
      { includeAuthInUrl: false, cursor: 0, ticket: 'tk-abc' },
      'srv-1',
    )

    expect(url).toBe('ws://10.0.0.5:4096/pty/pty_1/connect?directory=%2Ftmp%2Fproject&cursor=0&ticket=tk-abc')
  })

  it('falls back to auth_token only when there is no ticket and the base URL is cross-origin', async () => {
    const { getPtyConnectUrl } = await import('./pty')
    getActiveBaseUrlMock.mockReturnValue(REMOTE_BASE)
    getActiveAuthMock.mockReturnValue(AUTH)

    const url = getPtyConnectUrl('pty_1', '/tmp/project', { cursor: 0 })

    expect(url).toBe(
      `ws://10.0.0.5:4096/pty/pty_1/connect?directory=%2Ftmp%2Fproject&cursor=0&auth_token=${encodeURIComponent(AUTH_TOKEN)}`,
    )
  })

  it('omits auth_token for a relative base URL (same-origin proxy deployment)', async () => {
    const { getPtyConnectUrl } = await import('./pty')
    getActiveBaseUrlMock.mockReturnValue('/api')
    getActiveAuthMock.mockReturnValue(AUTH)

    const url = getPtyConnectUrl('pty_1', '/tmp/project', { cursor: 0 })

    expect(url).toBe('/api/pty/pty_1/connect?directory=%2Ftmp%2Fproject&cursor=0')
  })

  it('omits auth_token for an absolute base URL on the current origin', async () => {
    const { getPtyConnectUrl } = await import('./pty')
    getActiveBaseUrlMock.mockReturnValue(location.origin)
    getActiveAuthMock.mockReturnValue(AUTH)

    const url = getPtyConnectUrl('pty_1', '/tmp/project', { cursor: 0 })

    expect(url).toBe(`${location.origin.replace(/^http/, 'ws')}/pty/pty_1/connect?directory=%2Ftmp%2Fproject&cursor=0`)
  })

  it('never adds auth_token when no password is configured', async () => {
    const { getPtyConnectUrl } = await import('./pty')
    getActiveBaseUrlMock.mockReturnValue(REMOTE_BASE)

    const url = getPtyConnectUrl('pty_1', '/tmp/project', { cursor: 0 })

    expect(url).toBe('ws://10.0.0.5:4096/pty/pty_1/connect?directory=%2Ftmp%2Fproject&cursor=0')
  })

  it('ignores blank tickets and keeps cursor out of the query when invalid', async () => {
    const { getPtyConnectUrl } = await import('./pty')
    getServerBaseUrlMock.mockReturnValue('https://opencode.example.com')

    const url = getPtyConnectUrl('pty_1', '/tmp/project', { cursor: -1, ticket: '   ' }, 'srv-1')

    expect(url).toBe('wss://opencode.example.com/pty/pty_1/connect?directory=%2Ftmp%2Fproject')
  })

  it('does not include credentials when the Tauri bridge authenticates via headers', async () => {
    const { getPtyConnectUrl } = await import('./pty')
    getServerBaseUrlMock.mockReturnValue(REMOTE_BASE)
    getServerAuthMock.mockReturnValue(AUTH)

    const url = getPtyConnectUrl('pty_1', '/tmp/project', { includeAuthInUrl: false, cursor: 0 }, 'srv-1')

    expect(url).toBe('ws://10.0.0.5:4096/pty/pty_1/connect?directory=%2Ftmp%2Fproject&cursor=0')
  })
})

describe('getPtyConnectTicket', () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    getServerBaseUrlMock.mockReturnValue('http://127.0.0.1:4096')
    getServerAuthMock.mockReturnValue(null)
  })

  it('requests a token with the required header and returns it', async () => {
    const { getPtyConnectTicket, PTY_CONNECT_TOKEN_HEADER } = await import('./pty')
    const connectToken = vi.fn(() => Promise.resolve({ data: { ticket: 'tk-1', expires_in: 60 }, error: undefined }))
    getSDKClientMock.mockReturnValue({ pty: { connectToken } })

    await expect(getPtyConnectTicket('pty_1', '/tmp/project', 'srv-1')).resolves.toBe('tk-1')
    expect(connectToken).toHaveBeenCalledWith(
      { ptyID: 'pty_1', directory: '/tmp/project' },
      { headers: { [PTY_CONNECT_TOKEN_HEADER]: '1' }, signal: expect.any(AbortSignal) },
    )
  })

  it('returns undefined when the backend rejects the request', async () => {
    const { getPtyConnectTicket } = await import('./pty')
    getSDKClientMock.mockReturnValue({
      pty: { connectToken: vi.fn(() => Promise.resolve({ error: new Error('404') })) },
    })

    await expect(getPtyConnectTicket('pty_1')).resolves.toBeUndefined()
  })

  it('returns undefined when the ticket field is missing', async () => {
    const { getPtyConnectTicket } = await import('./pty')
    getSDKClientMock.mockReturnValue({
      pty: { connectToken: vi.fn(() => Promise.resolve({ data: {}, error: undefined })) },
    })

    await expect(getPtyConnectTicket('pty_1')).resolves.toBeUndefined()
  })
})

describe('maskUrlSecrets', () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
  })

  it('redacts auth_token and ticket but keeps the rest of the URL', async () => {
    const { maskUrlSecrets } = await import('./pty')

    const masked = maskUrlSecrets(
      'ws://10.0.0.5:4096/pty/pty_1/connect?directory=%2Ftmp&cursor=5&auth_token=abc%3D&ticket=tk-1',
    )

    expect(masked).toBe(
      'ws://10.0.0.5:4096/pty/pty_1/connect?directory=%2Ftmp&cursor=5&auth_token=%3Credacted%3E&ticket=%3Credacted%3E',
    )
  })

  it('redacts secrets on a relative proxy URL as well', async () => {
    const { maskUrlSecrets } = await import('./pty')

    const masked = maskUrlSecrets('/api/pty/pty_1/connect?directory=%2Ftmp&ticket=tk-1')

    expect(masked).toContain('/api/pty/pty_1/connect?directory=%2Ftmp&ticket=%3Credacted%3E')
    expect(masked).not.toContain('tk-1')
  })

  it('returns the URL untouched when it contains no secrets', async () => {
    const { maskUrlSecrets } = await import('./pty')

    expect(maskUrlSecrets('ws://127.0.0.1:4096/pty/pty_1/connect?directory=%2Ftmp')).toBe(
      'ws://127.0.0.1:4096/pty/pty_1/connect?directory=%2Ftmp',
    )
  })
})
