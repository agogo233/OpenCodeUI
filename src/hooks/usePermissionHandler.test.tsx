import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePermissionHandler } from './usePermissionHandler'

const {
  replyPermissionMock,
  getPendingPermissionsMock,
  replyQuestionMock,
  rejectQuestionMock,
  getPendingQuestionsMock,
  activeSessionStoreMock,
  notificationStoreMock,
} = vi.hoisted(() => ({
  replyPermissionMock: vi.fn(() => Promise.resolve(true)),
  getPendingPermissionsMock: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(() => Promise.resolve([])),
  replyQuestionMock: vi.fn((..._args: unknown[]) => Promise.resolve(true)),
  rejectQuestionMock: vi.fn((..._args: unknown[]) => Promise.resolve(true)),
  getPendingQuestionsMock: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(() => Promise.resolve([])),
  activeSessionStoreMock: {
    resolvePendingRequest: vi.fn(),
    getPendingRequest: vi.fn<(requestId: string) => { sessionId: string; directory?: string } | undefined>(),
    getSessionMeta: vi.fn<(sessionId: string) => { title?: string; directory?: string } | undefined>(),
  },
  notificationStoreMock: {
    push: vi.fn(),
  },
}))

vi.mock('../api', () => ({
  replyPermission: replyPermissionMock,
  replyQuestion: replyQuestionMock,
  rejectQuestion: rejectQuestionMock,
  getPendingPermissions: getPendingPermissionsMock,
  getPendingQuestions: getPendingQuestionsMock,
}))

vi.mock('../store', () => ({
  activeSessionStore: activeSessionStoreMock,
  notificationStore: notificationStoreMock,
}))

vi.mock('../utils', () => ({
  permissionErrorHandler: vi.fn(),
}))

const questionRequest = (id: string, sessionId: string) => ({
  id,
  sessionID: sessionId,
  questions: [
    {
      question: 'Pick one',
      header: 'Pick one',
      options: [{ label: 'A', description: 'Answer A' }],
    },
  ],
})

describe('usePermissionHandler', () => {
  beforeEach(() => {
    replyPermissionMock.mockReset()
    replyPermissionMock.mockResolvedValue(true)
    getPendingPermissionsMock.mockReset()
    getPendingPermissionsMock.mockResolvedValue([])
    replyQuestionMock.mockReset()
    replyQuestionMock.mockResolvedValue(true)
    rejectQuestionMock.mockReset()
    rejectQuestionMock.mockResolvedValue(true)
    getPendingQuestionsMock.mockReset()
    getPendingQuestionsMock.mockResolvedValue([])
    activeSessionStoreMock.resolvePendingRequest.mockClear()
    activeSessionStoreMock.getPendingRequest.mockReset()
    activeSessionStoreMock.getPendingRequest.mockReturnValue(undefined)
    activeSessionStoreMock.getSessionMeta.mockReset()
    activeSessionStoreMock.getSessionMeta.mockReturnValue(undefined)
    notificationStoreMock.push.mockClear()
  })

  it('clears pending permission locally after a successful reply', async () => {
    const { result } = renderHook(() => usePermissionHandler('local'))

    act(() => {
      result.current.setPendingPermissionRequests([
        {
          id: 'perm-1',
          sessionID: 'session-1',
          permission: 'bash',
          patterns: ['npm test'],
          metadata: {},
          always: [],
        },
      ])
    })

    let success = false
    await act(async () => {
      success = await result.current.handlePermissionReply('perm-1', 'once', '/workspace', 'session-1')
    })

    expect(success).toBe(true)
    expect(replyPermissionMock).toHaveBeenCalledWith('perm-1', 'once', undefined, '/workspace', 'session-1', 'local')
    expect(result.current.pendingPermissionRequests).toEqual([])
    expect(activeSessionStoreMock.resolvePendingRequest).toHaveBeenCalledWith('perm-1')
  })

  it('clears stale permission when reply fails but server no longer lists it as pending', async () => {
    replyPermissionMock.mockRejectedValue(new Error('permission already handled'))
    getPendingPermissionsMock.mockResolvedValue([])
    const { result } = renderHook(() => usePermissionHandler('local'))

    act(() => {
      result.current.setPendingPermissionRequests([
        {
          id: 'perm-stale',
          sessionID: 'session-1',
          permission: 'bash',
          patterns: ['npm test'],
          metadata: {},
          always: [],
        },
      ])
    })

    let success = false
    await act(async () => {
      success = await result.current.handlePermissionReply('perm-stale', 'once', '/workspace', 'session-1')
    })

    expect(success).toBe(true)
    expect(getPendingPermissionsMock).toHaveBeenCalledWith('session-1', '/workspace', 'local')
    expect(result.current.pendingPermissionRequests).toEqual([])
    expect(activeSessionStoreMock.resolvePendingRequest).toHaveBeenCalledWith('perm-stale')
  })

  // 核心契约：请求必须打到「当前」绑定的服务器。
  // pane 首次渲染时活动服务器可能是 local，之后切到别的服务器（多服务器 / WSL sidecar 就绪后切回），
  // 一旦回调把 serverId 冻在旧值上，回复就会发到旧服务器：旧服务器报错、真实服务器仍 pending、
  // 弹窗消失后又冒出来，对话永远不前进。
  it('routes replies to the server the pane is bound to now, not the one captured at mount', async () => {
    const { result, rerender } = renderHook(({ serverId }) => usePermissionHandler(serverId), {
      initialProps: { serverId: 'local' },
    })

    rerender({ serverId: 'wsl:Ubuntu' })

    await act(async () => {
      await result.current.handleQuestionReply('question-1', [['A']], '/home/u/project')
      await result.current.handleQuestionReject('question-2', '/home/u/project')
    })

    expect(replyQuestionMock).toHaveBeenCalledWith('question-1', [['A']], '/home/u/project', 'wsl:Ubuntu')
    expect(rejectQuestionMock).toHaveBeenCalledWith('question-2', '/home/u/project', 'wsl:Ubuntu')
  })

  it('keeps pending question when reply fails and the server still lists it as pending', async () => {
    replyQuestionMock.mockRejectedValue(new Error('boom'))
    getPendingQuestionsMock.mockResolvedValue([questionRequest('question-1', 'local::session-1')])
    activeSessionStoreMock.getPendingRequest.mockReturnValue({ sessionId: 'local::session-1', directory: '/workspace' })
    const { result } = renderHook(() => usePermissionHandler('local'))

    act(() => {
      result.current.setPendingQuestionRequests([questionRequest('question-1', 'local::session-1')])
    })

    let success = false
    await act(async () => {
      success = await result.current.handleQuestionReply('question-1', [['A']], '/workspace')
    })

    expect(success).toBe(false)
    expect(getPendingQuestionsMock).toHaveBeenCalledWith('local::session-1', '/workspace', 'local')
    // 本地 pending 保留：对话框保持打开，用户可重试
    expect(result.current.pendingQuestionRequests).toHaveLength(1)
    expect(activeSessionStoreMock.resolvePendingRequest).not.toHaveBeenCalledWith('question-1')
    expect(notificationStoreMock.push).toHaveBeenCalledWith(
      'error',
      'Question reply failed',
      'The reply did not reach the server. Please retry.',
      'local::session-1',
      '/workspace',
    )
  })

  it('clears stale question when reply fails but server no longer lists it as pending', async () => {
    replyQuestionMock.mockRejectedValue(new Error('boom'))
    getPendingQuestionsMock.mockResolvedValue([])
    const { result } = renderHook(() => usePermissionHandler('local'))

    act(() => {
      result.current.setPendingQuestionRequests([questionRequest('question-stale', 'local::session-1')])
    })

    let success = false
    await act(async () => {
      success = await result.current.handleQuestionReply('question-stale', [['A']], '/workspace', 'local::session-1')
    })

    expect(success).toBe(true)
    expect(result.current.pendingQuestionRequests).toEqual([])
    expect(activeSessionStoreMock.resolvePendingRequest).toHaveBeenCalledWith('question-stale')
    expect(notificationStoreMock.push).not.toHaveBeenCalled()
  })

  // 关键回归：入参 directory 可能已因切目录指向错误实例，补偿查询必须用
  // store 登记的请求归属（ask 事件时的目录），否则会在错误实例上查不到、
  // 误判「服务端已解」而静默清除，活跃列表随后又从真实实例拉回残留。
  it('uses the store-recorded directory for the compensation lookup when the caller passes a stale directory', async () => {
    replyQuestionMock.mockRejectedValue(new Error('boom'))
    getPendingQuestionsMock.mockImplementation((_sessionId: unknown, directory: unknown) => {
      if (directory === '/correct') {
        return Promise.resolve([questionRequest('question-1', 'local::session-1')])
      }
      return Promise.resolve([])
    })
    activeSessionStoreMock.getPendingRequest.mockReturnValue({ sessionId: 'local::session-1', directory: '/correct' })
    const { result } = renderHook(() => usePermissionHandler('local'))

    let success = false
    await act(async () => {
      success = await result.current.handleQuestionReply('question-1', [['A']], '/stale')
    })

    expect(activeSessionStoreMock.getPendingRequest).toHaveBeenCalledWith('question-1')
    expect(getPendingQuestionsMock).toHaveBeenCalledWith('local::session-1', '/correct', 'local')
    // reply 本体也按登记目录路由：重试直接命中真实实例
    expect(replyQuestionMock).toHaveBeenCalledWith('question-1', [['A']], '/correct', 'local')
    // 服务端（正确实例上）仍在等待 → 保留 pending，不误清
    expect(success).toBe(false)
    expect(result.current.pendingQuestionRequests).toEqual([])
    expect(activeSessionStoreMock.resolvePendingRequest).not.toHaveBeenCalledWith('question-1')
  })

  it('keeps pending question when reject fails and the server still lists it as pending', async () => {
    rejectQuestionMock.mockRejectedValue(new Error('boom'))
    getPendingQuestionsMock.mockResolvedValue([questionRequest('question-1', 'local::session-1')])
    activeSessionStoreMock.getPendingRequest.mockReturnValue({ sessionId: 'local::session-1', directory: '/workspace' })
    const { result } = renderHook(() => usePermissionHandler('local'))

    act(() => {
      result.current.setPendingQuestionRequests([questionRequest('question-1', 'local::session-1')])
    })

    let success = false
    await act(async () => {
      success = await result.current.handleQuestionReject('question-1', '/workspace', 'local::session-1')
    })

    expect(success).toBe(false)
    expect(rejectQuestionMock).toHaveBeenCalledWith('question-1', '/workspace', 'local')
    // 本地 pending 保留：对话框保持打开，用户可重试
    expect(result.current.pendingQuestionRequests).toHaveLength(1)
    expect(activeSessionStoreMock.resolvePendingRequest).not.toHaveBeenCalledWith('question-1')
    expect(notificationStoreMock.push).toHaveBeenCalledWith(
      'error',
      'Question dismiss failed',
      'The request was not dismissed on the server. Please retry.',
      'local::session-1',
      '/workspace',
    )
  })

  it('keeps pending permission when reply fails and the server still lists it as pending', async () => {
    replyPermissionMock.mockRejectedValue(new Error('boom'))
    getPendingPermissionsMock.mockResolvedValue([
      { id: 'perm-1', sessionID: 'session-1', permission: 'bash', patterns: ['npm test'], metadata: {}, always: [] },
    ])
    activeSessionStoreMock.getPendingRequest.mockReturnValue({ sessionId: 'local::session-1', directory: '/workspace' })
    const { result } = renderHook(() => usePermissionHandler('local'))

    act(() => {
      result.current.setPendingPermissionRequests([
        {
          id: 'perm-1',
          sessionID: 'session-1',
          permission: 'bash',
          patterns: ['npm test'],
          metadata: {},
          always: [],
        },
      ])
    })

    let success = false
    await act(async () => {
      success = await result.current.handlePermissionReply('perm-1', 'once', '/workspace', 'session-1')
    })

    expect(success).toBe(false)
    expect(result.current.pendingPermissionRequests).toHaveLength(1)
    expect(activeSessionStoreMock.resolvePendingRequest).not.toHaveBeenCalledWith('perm-1')
    expect(notificationStoreMock.push).toHaveBeenCalledWith(
      'error',
      'Permission reply failed',
      'The reply did not reach the server. Please retry.',
      'local::session-1',
      '/workspace',
    )
  })

  it('keeps pending question when the compensation lookup itself fails', async () => {
    replyQuestionMock.mockRejectedValue(new Error('boom'))
    getPendingQuestionsMock.mockRejectedValue(new Error('network down'))
    const { result } = renderHook(() => usePermissionHandler('local'))

    act(() => {
      result.current.setPendingQuestionRequests([questionRequest('question-1', 'local::session-1')])
    })

    let success = false
    await act(async () => {
      success = await result.current.handleQuestionReply('question-1', [['A']], '/workspace', 'local::session-1')
    })

    // 查不到服务端状态时保守处理：保留 pending、明确报错
    expect(success).toBe(false)
    expect(result.current.pendingQuestionRequests).toHaveLength(1)
    expect(activeSessionStoreMock.resolvePendingRequest).not.toHaveBeenCalledWith('question-1')
    expect(notificationStoreMock.push).toHaveBeenCalled()
  })
})
