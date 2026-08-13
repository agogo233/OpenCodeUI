import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatSession } from './useChatSession'

const {
  createSessionMock,
  summarizeSessionMock,
  executeCommandMock,
  getSelectableAgentsMock,
  registerSessionConsumerMock,
  updateConsumerSessionIdMock,
  sendNotificationMock,
  isSystemEnabledMock,
  errorHandlerMock,
  getPaneFullAutoModeMock,
  onFullAutoChangeMock,
  autoApproveSubscribeMock,
  shouldAutoApproveMock,
  claimAutoReplyMock,
  releaseAutoReplyMock,
  useSessionFamilyMock,
  pendingPermissionRequestsMock,
  handlePermissionReplyMock,
  refreshPendingRequestsMock,
  resetPendingRequestsMock,
  getPendingPermissionsMock,
  useDirectoryMock,
  useSessionStateMock,
  activeSessionStatusMap,
} = vi.hoisted(() => ({
  createSessionMock: vi.fn(),
  summarizeSessionMock: vi.fn(),
  executeCommandMock: vi.fn(),
  getSelectableAgentsMock: vi.fn(),
  registerSessionConsumerMock: vi.fn(),
  updateConsumerSessionIdMock: vi.fn(),
  sendNotificationMock: vi.fn(),
  isSystemEnabledMock: vi.fn((type: string) => type !== 'permission'),
  errorHandlerMock: vi.fn(),
  getPaneFullAutoModeMock: vi.fn((_paneId: string) => 'off'),
  onFullAutoChangeMock: vi.fn((_listener: unknown) => vi.fn()),
  autoApproveSubscribeMock: vi.fn((_listener: unknown) => vi.fn()),
  shouldAutoApproveMock: vi.fn((_sessionId: string, _permission: string, _patterns: string[]) => false),
  claimAutoReplyMock: vi.fn((_requestId: string) => true),
  releaseAutoReplyMock: vi.fn((_requestId: string) => undefined),
  useSessionFamilyMock: vi.fn((_sessionId: string | null) => [] as string[]),
  pendingPermissionRequestsMock: [] as Array<{ id: string; sessionID: string; permission: string; patterns?: string[] }>,
  handlePermissionReplyMock: vi.fn(
    (_requestId: string, _reply: string, _directory?: string, _sessionId?: string) => Promise.resolve(true),
  ),
  refreshPendingRequestsMock: vi.fn((_sessionIds?: string | string[], _directory?: string) => Promise.resolve()),
  resetPendingRequestsMock: vi.fn(),
  getPendingPermissionsMock: vi.fn((_sessionId?: string, _directory?: string, _serverId?: string) =>
    Promise.resolve([]),
  ),
  useDirectoryMock: vi.fn(() => ({ currentDirectory: '/workspace/demo' })),
  useSessionStateMock: vi.fn((_sessionId: string | null) => null as null | { isStreaming: boolean; messages: unknown[] }),
  activeSessionStatusMap: {} as Record<string, { type: string; attempt?: number; message?: string; next?: number }>,
}))

const autoApproveState = vi.hoisted(() => ({
  approvePendingOnFullAuto: false,
}))

vi.mock('../store', () => ({
  messageStore: {
    markAllSessionsStale: vi.fn(),
    getSessionState: vi.fn(() => ({ messages: [] })),
    setStreaming: vi.fn(),
    createSendRollbackSnapshot: vi.fn(),
    truncateAfterRevert: vi.fn(),
    restoreSendRollback: vi.fn(),
    handleMessageUpdated: vi.fn(),
    handlePartUpdated: vi.fn(),
  },
  useSessionFamily: (sessionId: string | null) => useSessionFamilyMock(sessionId),
  useSessionState: (sessionId: string | null) => useSessionStateMock(sessionId),
  autoApproveStore: {
    getPaneFullAutoMode: (paneId: string) => getPaneFullAutoModeMock(paneId),
    onFullAutoChange: (listener: unknown) => onFullAutoChangeMock(listener),
    subscribe: (listener: unknown) => autoApproveSubscribeMock(listener),
    get approvePendingOnFullAuto() {
      return autoApproveState.approvePendingOnFullAuto
    },
    enabled: false,
    shouldAutoApprove: (sessionId: string, permission: string, patterns: string[]) =>
      shouldAutoApproveMock(sessionId, permission, patterns),
    claimAutoReply: (requestId: string) => claimAutoReplyMock(requestId),
    releaseAutoReply: (requestId: string) => releaseAutoReplyMock(requestId),
  },
  childSessionStore: {
    getChildSessionIds: vi.fn(() => []),
    registerChildSession: vi.fn(),
    getSessionAndDescendants: vi.fn(() => []),
  },
  useActiveSessionStore: () => ({ statusMap: activeSessionStatusMap }),
}))

vi.mock('../hooks', () => ({
  useSessionManager: () => ({
    loadSession: vi.fn(),
    loadMoreHistory: vi.fn(),
    handleUndo: vi.fn(),
    handleRedo: vi.fn(),
    handleRedoAll: vi.fn(),
    clearRevert: vi.fn(),
  }),
  registerSessionConsumer: (...args: unknown[]) => registerSessionConsumerMock(...args),
  updateConsumerSessionId: (...args: unknown[]) => updateConsumerSessionIdMock(...args),
  hasOtherConsumerForSession: vi.fn(() => false),
  usePermissions: () => ({ resetPermissions: vi.fn() }),
  usePermissionHandler: () => ({
    pendingPermissionRequests: pendingPermissionRequestsMock,
    pendingQuestionRequests: [],
    setPendingPermissionRequests: vi.fn(),
    setPendingQuestionRequests: vi.fn(),
    handlePermissionReply: handlePermissionReplyMock,
    handleQuestionReply: vi.fn(),
    handleQuestionReject: vi.fn(),
    refreshPendingRequests: refreshPendingRequestsMock,
    resetPendingRequests: resetPendingRequestsMock,
    isReplying: false,
  }),
  useMessageAnimation: () => ({
    registerMessage: vi.fn(),
    registerInputBox: vi.fn(),
    animateUndo: vi.fn(),
    animateRedo: vi.fn(),
  }),
  useDirectory: () => useDirectoryMock(),
  useSessionContext: () => ({
    createSession: createSessionMock,
    sessions: [],
  }),
}))

vi.mock('./useNotification', () => ({
  useNotification: () => ({ sendNotification: sendNotificationMock }),
}))

vi.mock('../store/notificationEventSettingsStore', () => ({
  notificationEventSettingsStore: {
    isSystemEnabled: (type: string) => isSystemEnabledMock(type),
  },
}))

vi.mock('../api', () => ({
  sendMessageAsync: vi.fn(),
  getSessionMessages: vi.fn(),
  abortSession: vi.fn(),
  getSelectableAgents: (...args: unknown[]) => getSelectableAgentsMock(...args),
  getPendingPermissions: (...args: [string?, string?, string?]) => getPendingPermissionsMock(...args),
  getPendingQuestions: vi.fn(() => Promise.resolve([])),
  prefetchCommands: vi.fn(() => Promise.resolve()),
  prefetchRootDirectory: vi.fn(() => Promise.resolve()),
  getSessionChildren: vi.fn(() => Promise.resolve([])),
  executeCommand: (...args: unknown[]) => executeCommandMock(...args),
  summarizeSession: (...args: unknown[]) => summarizeSessionMock(...args),
  updateSession: vi.fn(),
  forkSession: vi.fn(),
  extractUserMessageContent: vi.fn(),
}))

vi.mock('../utils', () => ({
  clipboardErrorHandler: vi.fn(),
  copyTextToClipboard: vi.fn(),
  createErrorHandler: vi.fn(() => errorHandlerMock),
}))

vi.mock('../utils/perServerStorage', () => ({
  serverStorage: {
    get: vi.fn(() => 'build'),
    set: vi.fn(),
  },
}))

describe('useChatSession handleCommand', () => {
  beforeEach(() => {
    createSessionMock.mockReset()
    summarizeSessionMock.mockReset()
    executeCommandMock.mockReset()
    getSelectableAgentsMock.mockReset()
    registerSessionConsumerMock.mockReset()
    updateConsumerSessionIdMock.mockReset()
    sendNotificationMock.mockReset()
    isSystemEnabledMock.mockReset()
    errorHandlerMock.mockReset()
    getPaneFullAutoModeMock.mockReset()
    onFullAutoChangeMock.mockReset()
    autoApproveSubscribeMock.mockReset()
    shouldAutoApproveMock.mockReset()
    claimAutoReplyMock.mockReset()
    releaseAutoReplyMock.mockReset()
    useSessionFamilyMock.mockReset()
    handlePermissionReplyMock.mockReset()
    refreshPendingRequestsMock.mockReset()
    resetPendingRequestsMock.mockReset()
    getPendingPermissionsMock.mockReset()
    useDirectoryMock.mockReset()
    useSessionStateMock.mockReset()
    pendingPermissionRequestsMock.length = 0
    for (const key of Object.keys(activeSessionStatusMap)) {
      delete activeSessionStatusMap[key]
    }

    registerSessionConsumerMock.mockReturnValue(vi.fn())
    getPaneFullAutoModeMock.mockReturnValue('off')
    onFullAutoChangeMock.mockReturnValue(vi.fn())
    autoApproveSubscribeMock.mockReturnValue(vi.fn())
    shouldAutoApproveMock.mockReturnValue(false)
    claimAutoReplyMock.mockReturnValue(true)
    useSessionFamilyMock.mockReturnValue([])
    useSessionStateMock.mockReturnValue(null)
    useDirectoryMock.mockReturnValue({ currentDirectory: '/workspace/demo' })
    getPendingPermissionsMock.mockResolvedValue([])
    handlePermissionReplyMock.mockResolvedValue(true)
    refreshPendingRequestsMock.mockResolvedValue(undefined)
    autoApproveState.approvePendingOnFullAuto = false
    getSelectableAgentsMock.mockResolvedValue([{ name: 'build', mode: 'primary', hidden: false }])
    isSystemEnabledMock.mockImplementation((type: string) => type !== 'permission')

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => window.setTimeout(() => cb(0), 16))
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      clearTimeout(id)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('treats compact as sent before summarize finishes', async () => {
    summarizeSessionMock.mockReturnValue(new Promise<boolean>(() => {}))

    const { result } = renderHook(() =>
      useChatSession({
        paneId: 'pane-1',
        chatAreaRef: { current: null },
        currentModel: { id: 'model-1', providerId: 'provider-1', variants: [] } as never,
        refetchModels: vi.fn(async () => {}),
        sessionId: 'session-1',
        navigateToSession: vi.fn(),
        navigateHome: vi.fn(),
      }),
    )

    let settled = false
    let commandResult: boolean | undefined

    await act(async () => {
      const promise = result.current.handleCommand('/compact')
      promise.then(value => {
        settled = true
        commandResult = value
      })
      await Promise.resolve()
    })

    expect(summarizeSessionMock).toHaveBeenCalledWith(
      'session-1',
      { providerID: 'provider-1', modelID: 'model-1' },
      '/workspace/demo',
      'local',
    )
    expect(settled).toBe(true)
    expect(commandResult).toBe(true)
  })

  it('treats api commands as sent before execution finishes', async () => {
    executeCommandMock.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() =>
      useChatSession({
        paneId: 'pane-1',
        chatAreaRef: { current: null },
        currentModel: { id: 'model-1', providerId: 'provider-1', variants: [] } as never,
        refetchModels: vi.fn(async () => {}),
        sessionId: 'session-1',
        navigateToSession: vi.fn(),
        navigateHome: vi.fn(),
      }),
    )

    let settled = false
    let commandResult: boolean | undefined

    await act(async () => {
      const promise = result.current.handleCommand('/review src/App.tsx')
      promise.then(value => {
        settled = true
        commandResult = value
      })
      await Promise.resolve()
    })

    expect(executeCommandMock).toHaveBeenCalledWith('session-1', 'review', 'src/App.tsx', '/workspace/demo', 'local', 'provider-1/model-1')
    expect(settled).toBe(true)
    expect(commandResult).toBe(true)
  })

  it('refreshes pending permissions when session full auto pending sweep is enabled', async () => {
    getPaneFullAutoModeMock.mockReturnValue('session')
    autoApproveState.approvePendingOnFullAuto = true
    useSessionFamilyMock.mockReturnValue(['session-1', 'child-session'])

    renderHook(() =>
      useChatSession({
        paneId: 'pane-1',
        chatAreaRef: { current: null },
        currentModel: { id: 'model-1', providerId: 'provider-1', variants: [] } as never,
        refetchModels: vi.fn(async () => {}),
        sessionId: 'session-1',
        navigateToSession: vi.fn(),
        navigateHome: vi.fn(),
      }),
    )

    await waitFor(() => {
      expect(refreshPendingRequestsMock).toHaveBeenCalledWith(['session-1', 'child-session'], '/workspace/demo')
    })
  })

  it('approves already pending permissions when session full auto pending sweep is enabled', async () => {
    getPaneFullAutoModeMock.mockReturnValue('session')
    autoApproveState.approvePendingOnFullAuto = true
    pendingPermissionRequestsMock.push({
      id: 'perm-1',
      sessionID: 'session-1',
      permission: 'bash',
      patterns: ['npm test'],
    })

    renderHook(() =>
      useChatSession({
        paneId: 'pane-1',
        chatAreaRef: { current: null },
        currentModel: { id: 'model-1', providerId: 'provider-1', variants: [] } as never,
        refetchModels: vi.fn(async () => {}),
        sessionId: 'session-1',
        navigateToSession: vi.fn(),
        navigateHome: vi.fn(),
      }),
    )

    await waitFor(() => {
      expect(claimAutoReplyMock).toHaveBeenCalledWith('perm-1')
      expect(handlePermissionReplyMock).toHaveBeenCalledWith('perm-1', 'once', '/workspace/demo', 'session-1')
    })
  })

  it.each([
    {
      disabledType: 'permission',
      trigger: 'onPermissionAsked',
      payload: { id: 'perm-1', sessionID: 'session-1', permission: 'bash', patterns: [] },
    },
    {
      disabledType: 'question',
      trigger: 'onQuestionAsked',
      payload: {
        id: 'question-1',
        sessionID: 'session-1',
        questions: [{ header: 'Need input' }],
      },
    },
    {
      disabledType: 'completed',
      trigger: 'onSessionIdle',
      payload: 'session-1',
    },
    {
      disabledType: 'error',
      trigger: 'onSessionError',
      payload: 'session-1',
    },
  ])(
    'does not send browser notification when the $disabledType event is disabled',
    async ({ disabledType, trigger, payload }) => {
      let callbacks: Record<string, ((payload: unknown) => void) | undefined> | undefined
      registerSessionConsumerMock.mockImplementation((_paneId, _sessionId, consumerCallbacks) => {
        callbacks = consumerCallbacks as typeof callbacks
        return vi.fn()
      })
      isSystemEnabledMock.mockImplementation((type: string) => type !== disabledType)

      renderHook(() =>
        useChatSession({
          paneId: 'pane-1',
          chatAreaRef: { current: null },
          currentModel: { id: 'model-1', providerId: 'provider-1', variants: [] } as never,
          refetchModels: vi.fn(async () => {}),
          sessionId: 'session-1',
          navigateToSession: vi.fn(),
          navigateHome: vi.fn(),
        }),
      )

      act(() => {
        callbacks?.[trigger]?.(payload)
      })

      expect(sendNotificationMock).not.toHaveBeenCalled()
    },
  )
})

describe('useChatSession busy UI signal', () => {
  beforeEach(() => {
    createSessionMock.mockReset()
    summarizeSessionMock.mockReset()
    executeCommandMock.mockReset()
    getSelectableAgentsMock.mockReset()
    registerSessionConsumerMock.mockReset()
    updateConsumerSessionIdMock.mockReset()
    sendNotificationMock.mockReset()
    isSystemEnabledMock.mockReset()
    errorHandlerMock.mockReset()
    getPaneFullAutoModeMock.mockReset()
    onFullAutoChangeMock.mockReset()
    autoApproveSubscribeMock.mockReset()
    shouldAutoApproveMock.mockReset()
    claimAutoReplyMock.mockReset()
    releaseAutoReplyMock.mockReset()
    useSessionFamilyMock.mockReset()
    handlePermissionReplyMock.mockReset()
    refreshPendingRequestsMock.mockReset()
    resetPendingRequestsMock.mockReset()
    getPendingPermissionsMock.mockReset()
    useDirectoryMock.mockReset()
    useSessionStateMock.mockReset()
    pendingPermissionRequestsMock.length = 0
    for (const key of Object.keys(activeSessionStatusMap)) {
      delete activeSessionStatusMap[key]
    }

    registerSessionConsumerMock.mockReturnValue(vi.fn())
    getPaneFullAutoModeMock.mockReturnValue('off')
    onFullAutoChangeMock.mockReturnValue(vi.fn())
    autoApproveSubscribeMock.mockReturnValue(vi.fn())
    shouldAutoApproveMock.mockReturnValue(false)
    claimAutoReplyMock.mockReturnValue(true)
    useSessionFamilyMock.mockReturnValue([])
    useSessionStateMock.mockReturnValue(null)
    useDirectoryMock.mockReturnValue({ currentDirectory: '/workspace/demo' })
    getPendingPermissionsMock.mockResolvedValue([])
    handlePermissionReplyMock.mockResolvedValue(true)
    refreshPendingRequestsMock.mockResolvedValue(undefined)
    autoApproveState.approvePendingOnFullAuto = false
    getSelectableAgentsMock.mockResolvedValue([{ name: 'build', mode: 'primary', hidden: false }])
    isSystemEnabledMock.mockImplementation((type: string) => type !== 'permission')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps UI isStreaming true from session.status when message streaming is false', () => {
    useSessionStateMock.mockReturnValue({ isStreaming: false, messages: [] })
    activeSessionStatusMap['session-1'] = { type: 'busy' }

    const { result } = renderHook(() =>
      useChatSession({
        paneId: 'pane-1',
        chatAreaRef: { current: null },
        currentModel: { id: 'model-1', providerId: 'provider-1', variants: [] } as never,
        refetchModels: vi.fn(async () => {}),
        sessionId: 'session-1',
        navigateToSession: vi.fn(),
        navigateHome: vi.fn(),
      }),
    )

    expect(result.current.isStreaming).toBe(true)
    expect(result.current.messageIsStreaming).toBe(false)
  })

  it('keeps UI isStreaming true while session is in retry between agent steps', () => {
    useSessionStateMock.mockReturnValue({ isStreaming: false, messages: [] })
    activeSessionStatusMap['session-1'] = {
      type: 'retry',
      attempt: 1,
      message: 'retrying',
      next: Date.now() + 1000,
    }

    const { result } = renderHook(() =>
      useChatSession({
        paneId: 'pane-1',
        chatAreaRef: { current: null },
        currentModel: { id: 'model-1', providerId: 'provider-1', variants: [] } as never,
        refetchModels: vi.fn(async () => {}),
        sessionId: 'session-1',
        navigateToSession: vi.fn(),
        navigateHome: vi.fn(),
      }),
    )

    expect(result.current.isStreaming).toBe(true)
    expect(result.current.messageIsStreaming).toBe(false)
    expect(result.current.retryStatus?.attempt).toBe(1)
  })

  it('falls back to message streaming when session status is idle', () => {
    useSessionStateMock.mockReturnValue({ isStreaming: true, messages: [] })

    const { result } = renderHook(() =>
      useChatSession({
        paneId: 'pane-1',
        chatAreaRef: { current: null },
        currentModel: { id: 'model-1', providerId: 'provider-1', variants: [] } as never,
        refetchModels: vi.fn(async () => {}),
        sessionId: 'session-1',
        navigateToSession: vi.fn(),
        navigateHome: vi.fn(),
      }),
    )

    expect(result.current.isStreaming).toBe(true)
    expect(result.current.messageIsStreaming).toBe(true)
  })
})

describe('useChatSession pending request reset on session/directory change', () => {
  beforeEach(() => {
    createSessionMock.mockReset()
    summarizeSessionMock.mockReset()
    executeCommandMock.mockReset()
    getSelectableAgentsMock.mockReset()
    registerSessionConsumerMock.mockReset()
    updateConsumerSessionIdMock.mockReset()
    sendNotificationMock.mockReset()
    isSystemEnabledMock.mockReset()
    errorHandlerMock.mockReset()
    getPaneFullAutoModeMock.mockReset()
    onFullAutoChangeMock.mockReset()
    autoApproveSubscribeMock.mockReset()
    shouldAutoApproveMock.mockReset()
    claimAutoReplyMock.mockReset()
    releaseAutoReplyMock.mockReset()
    useSessionFamilyMock.mockReset()
    handlePermissionReplyMock.mockReset()
    refreshPendingRequestsMock.mockReset()
    resetPendingRequestsMock.mockReset()
    getPendingPermissionsMock.mockReset()
    useDirectoryMock.mockReset()
    useSessionStateMock.mockReset()
    pendingPermissionRequestsMock.length = 0
    for (const key of Object.keys(activeSessionStatusMap)) {
      delete activeSessionStatusMap[key]
    }

    registerSessionConsumerMock.mockReturnValue(vi.fn())
    getPaneFullAutoModeMock.mockReturnValue('off')
    onFullAutoChangeMock.mockReturnValue(vi.fn())
    autoApproveSubscribeMock.mockReturnValue(vi.fn())
    shouldAutoApproveMock.mockReturnValue(false)
    claimAutoReplyMock.mockReturnValue(true)
    useSessionFamilyMock.mockReturnValue([])
    useSessionStateMock.mockReturnValue(null)
    useDirectoryMock.mockReturnValue({ currentDirectory: '/workspace/demo' })
    getPendingPermissionsMock.mockResolvedValue([])
    handlePermissionReplyMock.mockResolvedValue(true)
    refreshPendingRequestsMock.mockResolvedValue(undefined)
    autoApproveState.approvePendingOnFullAuto = false
    getSelectableAgentsMock.mockResolvedValue([{ name: 'build', mode: 'primary', hidden: false }])
    isSystemEnabledMock.mockImplementation((type: string) => type !== 'permission')

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => window.setTimeout(() => cb(0), 16))
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      clearTimeout(id)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const render = () =>
    renderHook(
      ({ sessionId }: { sessionId: string | null }) =>
        useChatSession({
          paneId: 'pane-1',
          chatAreaRef: { current: null },
          currentModel: { id: 'model-1', providerId: 'provider-1', variants: [] } as never,
          refetchModels: vi.fn(async () => {}),
          sessionId,
          navigateToSession: vi.fn(),
          navigateHome: vi.fn(),
        }),
      { initialProps: { sessionId: 'session-1' } as { sessionId: string | null } },
    )

  it('keeps pending requests when effectiveDirectory changes but session stays the same', async () => {
    const { rerender } = render()
    await waitFor(() => {
      expect(getPendingPermissionsMock).toHaveBeenCalled()
    })
    expect(resetPendingRequestsMock).not.toHaveBeenCalled()

    const baselineCalls = getPendingPermissionsMock.mock.calls.length

    // effectiveDirectory 变化（如 session 元数据加载完成后 directory 就位）会触发 effect 重跑并重新加载
    useDirectoryMock.mockReturnValue({ currentDirectory: '/workspace/other' })
    rerender({ sessionId: 'session-1' })

    await waitFor(() => {
      expect(getPendingPermissionsMock.mock.calls.length).toBeGreaterThan(baselineCalls)
    })
    // 但 reset 被 gate 拦截，SSE 刚推送的 pending 请求得以保留
    expect(resetPendingRequestsMock).not.toHaveBeenCalled()
  })

  it('resets pending requests when switching to a different session', async () => {
    const { rerender } = render()

    rerender({ sessionId: 'session-2' })

    expect(resetPendingRequestsMock).toHaveBeenCalledTimes(1)
  })

  it('resets pending requests when moving from null to a session', async () => {
    const { rerender } = render()

    rerender({ sessionId: null })

    expect(resetPendingRequestsMock).toHaveBeenCalledTimes(1)

    rerender({ sessionId: 'session-1' })

    expect(resetPendingRequestsMock).toHaveBeenCalledTimes(2)
  })

  it('resets pending requests when switching back to a previously visited session', async () => {
    const { rerender } = render()

    rerender({ sessionId: 'session-2' })
    rerender({ sessionId: 'session-1' })

    expect(resetPendingRequestsMock).toHaveBeenCalledTimes(2)
  })
})
