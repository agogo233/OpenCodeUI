// ============================================
// PTY API - 终端管理
// ============================================

import { getSDKClient, unwrap } from './sdk'
import { getApiBaseUrl, buildQueryString } from './http'
import { formatPathForApi } from '../utils/directoryUtils'
import { serverStore } from '../store/serverStore'
import { logger } from '../utils/logger'
import type { Pty, PtyCreateParams, PtyUpdateParams } from '../types/api/pty'

/** connect-token 接口要求的固定头，缺失会被后端拒绝 */
export const PTY_CONNECT_TOKEN_HEADER = 'x-opencode-ticket'
export const PTY_CONNECT_TOKEN_HEADER_VALUE = '1'

/** 换票请求超时：避免网络黑洞时把整个建连流程卡死（浏览器侧不会进 onclose，也就不会重连） */
const PTY_CONNECT_TICKET_TIMEOUT_MS = 5000

interface PtyConnectTokenResponse {
  ticket?: string
  expires_in?: number
}

type LegacyPty = Pty & { running?: boolean; status?: Pty['status'] }
export interface ShellInfo {
  path: string
  name: string
  acceptable: boolean
}

interface PtyConnectUrlOptions {
  /**
   * false = 不在 URL 里放认证（Tauri bridge 通过 header 传）
   * true  = 在 URL 里放认证（浏览器原生 WebSocket 无法设 header）
   */
  includeAuthInUrl?: boolean
  cursor?: number
  /**
   * 后端签发的一次性连接凭证。带上后 URL 里不再放任何账号密码，
   * 这是浏览器原生 WebSocket 唯一可用的认证方式
   */
  ticket?: string
}

function normalizePty(pty: LegacyPty): Pty {
  if (pty.status) return pty as Pty
  return {
    ...pty,
    status: pty.running ? 'running' : 'exited',
  } as Pty
}

/**
 * 获取所有 PTY 会话列表
 */
export async function listPtySessions(directory?: string, serverId?: string): Promise<Pty[]> {
  const sdk = getSDKClient(serverId)
  return unwrap(await sdk.pty.list({ directory: formatPathForApi(directory, serverId) })).map(pty =>
    normalizePty(pty as LegacyPty),
  )
}

/**
 * 获取当前机器可用 shell 列表，用于 opencode config.shell 的候选项。
 */
export async function listAvailableShells(directory?: string, serverId?: string): Promise<ShellInfo[]> {
  const sdk = getSDKClient(serverId)
  return unwrap(await sdk.pty.shells({ directory: formatPathForApi(directory, serverId) }))
}

/**
 * 创建新的 PTY 会话
 */
export async function createPtySession(params: PtyCreateParams, directory?: string, serverId?: string): Promise<Pty> {
  const sdk = getSDKClient(serverId)
  return normalizePty(unwrap(await sdk.pty.create({ directory: formatPathForApi(directory, serverId), ...params })) as LegacyPty)
}

/**
 * 获取单个 PTY 会话信息
 */
export async function getPtySession(ptyId: string, directory?: string, serverId?: string): Promise<Pty> {
  const sdk = getSDKClient(serverId)
  return normalizePty(unwrap(await sdk.pty.get({ ptyID: ptyId, directory: formatPathForApi(directory, serverId) })) as LegacyPty)
}

/**
 * 更新 PTY 会话
 */
export async function updatePtySession(
  ptyId: string,
  params: PtyUpdateParams,
  directory?: string,
  serverId?: string,
): Promise<Pty> {
  const sdk = getSDKClient(serverId)
  return normalizePty(
    unwrap(await sdk.pty.update({ ptyID: ptyId, directory: formatPathForApi(directory, serverId), ...params })) as LegacyPty,
  )
}

/**
 * 删除 PTY 会话
 */
export async function removePtySession(ptyId: string, directory?: string, serverId?: string): Promise<boolean> {
  const sdk = getSDKClient(serverId)
  unwrap(await sdk.pty.remove({ ptyID: ptyId, directory: formatPathForApi(directory, serverId) }))
  return true
}

function toWebSocketBase(httpBase: string): string {
  return /^https:\/\//i.test(httpBase) ? httpBase.replace(/^https:/i, 'wss:') : httpBase.replace(/^http:/i, 'ws:')
}

function isCrossOriginBase(httpBase: string): boolean {
  try {
    return new URL(httpBase, location.origin).origin !== location.origin
  } catch {
    return true
  }
}

/**
 * 脱敏 URL 中的凭证参数，避免日志里落明文
 */
export function maskUrlSecrets(url: string): string {
  try {
    const parsed = new URL(url, location.origin)
    for (const name of ['auth_token', 'ticket']) {
      if (parsed.searchParams.has(name)) parsed.searchParams.set(name, '<redacted>')
    }
    return parsed.toString()
  } catch {
    return url
  }
}

/**
 * 申请 PTY WebSocket 一次性连接凭证（ticket）
 *
 * 浏览器原生 WebSocket 不支持自定义 header，把账号密码塞进 URL 又会直接被拒绝，
 * 所以先走一次普通 HTTP 请求换 ticket（该请求能正常带认证头），
 * 再用 ticket 作为查询参数打开 WebSocket。
 *
 * 返回 undefined 表示拿不到 ticket（旧版后端没有这个接口等），
 * 调用方应回退到旧的 URL 认证方式
 */
export async function getPtyConnectTicket(
  ptyId: string,
  directory?: string,
  serverId?: string,
): Promise<string | undefined> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PTY_CONNECT_TICKET_TIMEOUT_MS)
  try {
    const sdk = getSDKClient(serverId)
    const token = unwrap<PtyConnectTokenResponse>(
      await sdk.pty.connectToken(
        { ptyID: ptyId, directory: formatPathForApi(directory, serverId) },
        {
          headers: { [PTY_CONNECT_TOKEN_HEADER]: PTY_CONNECT_TOKEN_HEADER_VALUE },
          signal: controller.signal,
        },
      ),
    )
    return typeof token?.ticket === 'string' && token.ticket ? token.ticket : undefined
  } catch (error) {
    logger.log('[Pty] Failed to acquire connect ticket, falling back to legacy URL auth:', error)
    return undefined
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * 获取 PTY 连接 WebSocket URL
 *
 * 认证优先级：
 * - ticket query parameter（首选，URL 里不含任何账号密码）
 * - auth_token query parameter（跨域兜底，与官方 opencode app 一致）
 * - Tauri bridge：也走这里，但传 includeAuthInUrl=false，认证改由 Rust 侧 HTTP header 携带
 */
export function getPtyConnectUrl(
  ptyId: string,
  directory?: string,
  options?: PtyConnectUrlOptions,
  serverId?: string,
): string {
  const httpBase = getApiBaseUrl(serverId)
  const wsBase = toWebSocketBase(httpBase)
  const includeAuthInUrl = options?.includeAuthInUrl ?? true
  const cursor =
    typeof options?.cursor === 'number' && Number.isSafeInteger(options.cursor) && options.cursor >= 0
      ? options.cursor
      : undefined
  const ticket = typeof options?.ticket === 'string' && options.ticket.trim() ? options.ticket.trim() : undefined

  const auth = serverId ? serverStore.getServerAuth(serverId) : serverStore.getActiveAuth()
  const formatted = formatPathForApi(directory, serverId)

  const queryParams: Record<string, string | number | undefined> = { directory: formatted, cursor, ticket }

  // Tauri bridge 通过 header 传认证；有 ticket 时 ticket 本身即完成认证，
  // 两者都不需要在 URL 里放账号密码。
  // 浏览器原生 WebSocket 无法设置 header，跨域时只能用 auth_token 兜底
  // （URL 里带 userinfo 会被浏览器直接拒绝，已不再使用）
  if (includeAuthInUrl && !ticket && auth?.password && isCrossOriginBase(httpBase)) {
    queryParams.auth_token = btoa(`${auth.username}:${auth.password}`)
  }

  return `${wsBase}/pty/${ptyId}/connect${buildQueryString(queryParams)}`
}
