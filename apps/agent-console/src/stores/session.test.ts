import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick, ref, watch } from 'vue';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import type { AcpClientBridge } from '../lib/acp-bridge';
import type { PermissionRequest } from '../lib/types';

const bridgeMocks = vi.hoisted(() => ({
  createAcpClient: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  deleteProfileSession: vi.fn(async () => undefined),
  getProfiles: vi.fn(async () => ({ agents: {} })),
}));

vi.mock('../lib/acp-bridge', () => ({
  createAcpClient: bridgeMocks.createAcpClient,
}));

vi.mock('../lib/bridge-api', () => ({
  getAppVersion: vi.fn(() => 'test'),
  getProfiles: apiMocks.getProfiles,
  deleteProfileSession: apiMocks.deleteProfileSession,
}));

import { useConfigStore } from './config';
import { useSessionStore } from './session';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (cause: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

interface FakeClient {
  pendingPermissionRequest: ReturnType<typeof ref<PermissionRequest | null>>;
  onSessionUpdate: ((notification: SessionNotification) => void) | null;
  onTransportClose: ((reason?: string) => void) | null;
  initialize: ReturnType<typeof vi.fn>;
  newSession: ReturnType<typeof vi.fn>;
  loadSession: ReturnType<typeof vi.fn>;
  unstable_listSessions: ReturnType<typeof vi.fn>;
  prompt: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  authenticate: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  resolvePermission: ReturnType<typeof vi.fn>;
  cancelPermission: ReturnType<typeof vi.fn>;
}

function createFakeClient(sessionIds: string[]): {
  client: FakeClient;
  prompts: Map<string, Deferred<unknown>>;
} {
  const ids = [...sessionIds];
  const prompts = new Map<string, Deferred<unknown>>();
  const client: FakeClient = {
    pendingPermissionRequest: ref<PermissionRequest | null>(null),
    onSessionUpdate: null,
    onTransportClose: null,
    initialize: vi.fn(async () => ({
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: { list: {} },
      },
      authMethods: [],
    })),
    newSession: vi.fn(async () => ({ sessionId: ids.shift() })),
    loadSession: vi.fn(async () => ({})),
    unstable_listSessions: vi.fn(async () => ({
      sessions: [],
      nextCursor: null,
    })),
    prompt: vi.fn(({ sessionId }: { sessionId: string }) => {
      const pending = deferred<unknown>();
      prompts.set(sessionId, pending);
      return pending.promise;
    }),
    cancel: vi.fn(async () => undefined),
    authenticate: vi.fn(async () => ({})),
    disconnect: vi.fn(async () => undefined),
    resolvePermission: vi.fn(),
    cancelPermission: vi.fn(),
  };
  return { client, prompts };
}

function emitText(
  client: FakeClient,
  sessionId: string,
  text: string,
): void {
  client.onSessionUpdate?.({
    sessionId,
    update: {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text },
    },
  });
}

describe('multi-Profile ACP session store', () => {
  const clients = new Map<string, FakeClient>();
  const promptMaps = new Map<string, Map<string, Deferred<unknown>>>();

  beforeEach(() => {
    setActivePinia(createPinia());
    clients.clear();
    promptMaps.clear();
    bridgeMocks.createAcpClient.mockReset();
    apiMocks.deleteProfileSession.mockReset();
    apiMocks.deleteProfileSession.mockResolvedValue(undefined);
    bridgeMocks.createAcpClient.mockImplementation(
      async (arg: unknown): Promise<AcpClientBridge> => {
        const name =
          typeof arg === 'object' &&
          arg !== null &&
          'name' in arg &&
          typeof arg.name === 'string'
            ? arg.name
            : '';
        const client = clients.get(name);
        if (!client) throw new Error(`missing fake client: ${name}`);
        return client as unknown as AcpClientBridge;
      },
    );

    useConfigStore().updateFromEvent({
      agents: {
        direct: {
          url: 'ws://127.0.0.1/direct',
          cwd: '/demo',
        },
        oag: {
          url: 'ws://127.0.0.1/oag',
          cwd: '/demo',
        },
      },
    });
  });

  function register(name: string, sessionIds: string[]): FakeClient {
    const { client, prompts } = createFakeClient(sessionIds);
    clients.set(name, client);
    promptMaps.set(name, prompts);
    return client;
  }

  it('keeps a hidden Profile running and routes interleaved updates by sessionId', async () => {
    const direct = register('direct', ['direct-1']);
    const oag = register('oag', ['oag-1']);
    const store = useSessionStore();

    const directKey = await store.createSession('direct', '/demo');
    const directRun = store.sendPrompt('direct question');

    const oagKey = await store.createSession('oag', '/demo');
    const oagRun = store.sendPrompt('oag question');

    emitText(direct, 'direct-1', 'direct answer');
    emitText(oag, 'oag-1', 'oag answer');

    store.selectConversation(directKey);
    expect(store.messageList[store.messageList.length - 1]?.content).toBe(
      'direct answer',
    );
    expect(store.isLoading).toBe(true);

    store.selectConversation(oagKey);
    expect(store.messageList[store.messageList.length - 1]?.content).toBe(
      'oag answer',
    );
    expect(store.isLoading).toBe(true);

    promptMaps.get('direct')?.get('direct-1')?.resolve({});
    promptMaps.get('oag')?.get('oag-1')?.resolve({});
    await Promise.all([directRun, oagRun]);

    expect(bridgeMocks.createAcpClient).toHaveBeenCalledTimes(2);
    expect(store.openConversations).toHaveLength(2);
    store.selectConversation(directKey);
    const completed = store.messageList.find(
      (message) => message.role === 'assistant',
    );
    expect(completed?.completedAt).toEqual(expect.any(Number));
    expect(completed?.durationMs).toEqual(expect.any(Number));
  });

  it('does not mark an assistant response complete until the prompt resolves', async () => {
    const direct = register('direct', ['direct-1']);
    const store = useSessionStore();

    await store.createSession('direct', '/demo');
    const run = store.sendPrompt('question');
    emitText(direct, 'direct-1', 'answer');
    const assistant = store.messageList.find(
      (message) => message.role === 'assistant',
    );
    expect(assistant?.completedAt).toBeUndefined();
    expect(assistant?.durationMs).toBeUndefined();

    promptMaps.get('direct')?.get('direct-1')?.resolve({});
    await run;
    expect(assistant?.completedAt).toEqual(expect.any(Number));
    expect(assistant?.durationMs).toEqual(expect.any(Number));
  });

  it('replays events emitted before session/new reveals the Session id', async () => {
    const direct = register('direct', []);
    const created = deferred<{ sessionId: string }>();
    direct.newSession.mockImplementationOnce(() => {
      emitText(direct, 'direct-buffered', 'early answer');
      return created.promise;
    });
    const store = useSessionStore();

    const creation = store.createSession('direct', '/demo');
    await vi.waitFor(() => {
      expect(direct.newSession).toHaveBeenCalledTimes(1);
    });
    created.resolve({ sessionId: 'direct-buffered' });

    await expect(creation).resolves.toBe('direct:direct-buffered');
    expect(store.messageList).toMatchObject([
      { role: 'assistant', content: 'early answer' },
    ]);
  });

  it('uses the ACP authentication error code even with a custom message', async () => {
    const direct = register('direct', ['direct-1']);
    direct.initialize.mockResolvedValueOnce({
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: { list: {} },
      },
      authMethods: [{ id: 'login', name: 'Sign in' }],
    });
    direct.newSession.mockRejectedValueOnce(
      Object.assign(new Error('Please sign in to continue'), {
        code: -32000,
      }),
    );
    const store = useSessionStore();

    const creation = store.createSession('direct', '/demo');
    await vi.waitFor(() => {
      expect(store.pendingAuthMethods).toEqual([
        { id: 'login', name: 'Sign in' },
      ]);
    });
    store.selectAuthMethod('login');

    await expect(creation).resolves.toBe('direct:direct-1');
    expect(direct.authenticate).toHaveBeenCalledWith({ methodId: 'login' });
    expect(direct.newSession).toHaveBeenCalledTimes(2);
  });

  it('does not label a cancelled Prompt as completed', async () => {
    const direct = register('direct', ['direct-1']);
    const store = useSessionStore();

    await store.createSession('direct', '/demo');
    const run = store.sendPrompt('question');
    emitText(direct, 'direct-1', 'partial answer');
    promptMaps.get('direct')?.get('direct-1')?.resolve({
      stopReason: 'cancelled',
    });
    await run;

    const assistant = store.messageList.find(
      (message) => message.role === 'assistant',
    );
    expect(assistant?.completedAt).toBeUndefined();
    expect(assistant?.durationMs).toBeUndefined();
  });

  it('permanently deletes an idle Session and selects a fallback conversation', async () => {
    register('direct', ['direct-1', 'direct-2']);
    const store = useSessionStore();

    const firstKey = await store.createSession('direct', '/demo');
    const secondKey = await store.createSession('direct', '/demo');
    expect(store.activeConversationKey).toBe(secondKey);

    await store.deleteConversation('direct', 'direct-2');

    expect(apiMocks.deleteProfileSession).toHaveBeenCalledWith(
      'direct',
      'direct-2',
    );
    expect(store.openConversations.map((item) => item.key)).toEqual([
      firstKey,
    ]);
    expect(store.activeConversationKey).toBe(firstKey);
  });

  it('reconnects the visible conversation after deleting another Session in its Profile', async () => {
    const direct = register('direct', ['direct-1', 'direct-2']);
    const store = useSessionStore();

    const firstKey = await store.createSession('direct', '/demo');
    await store.createSession('direct', '/demo');
    store.selectConversation(firstKey);

    await store.deleteConversation('direct', 'direct-2');

    expect(store.activeConversationKey).toBe(firstKey);
    expect(store.isConnected).toBe(true);
    expect(direct.disconnect).toHaveBeenCalled();
    expect(direct.loadSession).toHaveBeenCalledWith({
      sessionId: 'direct-1',
      cwd: '/demo',
      mcpServers: [],
    });
  });

  it('does not hide a deleted Session if a later authoritative list reports it again', async () => {
    const direct = register('direct', ['direct-1']);
    const store = useSessionStore();
    await store.createSession('direct', '/demo');
    await store.deleteConversation('direct', 'direct-1');

    direct.unstable_listSessions.mockResolvedValueOnce({
      sessions: [
        {
          sessionId: 'direct-1',
          cwd: '/demo',
          title: 'Authoritatively returned',
          updatedAt: new Date().toISOString(),
        },
      ],
      nextCursor: null,
    });
    await store.refreshSessions('direct');

    expect(
      store.resumableSessions.map((session) => session.sessionId),
    ).toContain('direct-1');
  });

  it('preserves the last Session catalog when discovery fails transiently', async () => {
    const direct = register('direct', []);
    direct.unstable_listSessions
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 'direct-existing',
            cwd: '/demo',
            title: 'Existing session',
            updatedAt: new Date().toISOString(),
          },
        ],
        nextCursor: null,
      })
      .mockRejectedValueOnce(new Error('temporary network failure'));
    const store = useSessionStore();

    await store.refreshSessions('direct');
    await store.refreshSessions('direct');

    expect(
      store.resumableSessions.map((session) => session.sessionId),
    ).toContain('direct-existing');
    expect(store.profileErrorFor('direct')).toBe(
      'temporary network failure',
    );
  });

  it('keeps local state when permanent Session deletion fails', async () => {
    register('direct', ['direct-1']);
    const store = useSessionStore();
    const key = await store.createSession('direct', '/demo');
    apiMocks.deleteProfileSession.mockRejectedValueOnce(
      new Error('delete failed'),
    );

    await expect(
      store.deleteConversation('direct', 'direct-1'),
    ).rejects.toThrow('delete failed');
    expect(store.openConversations.map((item) => item.key)).toContain(key);
    expect(store.activeConversationKey).toBe(key);
  });

  it('refuses deletion anywhere in a Profile while that Profile is running', async () => {
    register('direct', ['direct-1', 'direct-2']);
    const store = useSessionStore();
    await store.createSession('direct', '/demo');
    const running = store.sendPrompt('question');
    await store.createSession('direct', '/demo');

    await expect(
      store.deleteConversation('direct', 'direct-2'),
    ).rejects.toThrow('still running');
    expect(apiMocks.deleteProfileSession).not.toHaveBeenCalled();

    promptMaps.get('direct')?.get('direct-1')?.resolve({});
    await running;
  });

  it('reuses one ACP client for multiple Sessions and serializes prompts within a Profile', async () => {
    const direct = register('direct', ['direct-1', 'direct-2']);
    const store = useSessionStore();

    const firstKey = await store.createSession('direct', '/demo');
    const firstRun = store.sendPrompt('first');
    const secondKey = await store.createSession('direct', '/demo');

    expect(secondKey).not.toBe(firstKey);
    expect(bridgeMocks.createAcpClient).toHaveBeenCalledTimes(1);
    expect(direct.initialize).toHaveBeenCalledTimes(1);
    await expect(store.sendPrompt('second')).rejects.toThrow(
      'already running another conversation',
    );

    emitText(direct, 'direct-1', 'still routed');
    store.selectConversation(firstKey);
    expect(store.messageList[store.messageList.length - 1]?.content).toBe(
      'still routed',
    );

    promptMaps.get('direct')?.get('direct-1')?.resolve({});
    await firstRun;
  });

  it('routes a background permission response to its owning Profile', async () => {
    const direct = register('direct', ['direct-1']);
    register('oag', ['oag-1']);
    const store = useSessionStore();

    await store.createSession('direct', '/demo');
    await store.createSession('oag', '/demo');
    direct.pendingPermissionRequest.value = {
      sessionId: 'direct-1',
      toolCall: {
        toolCallId: 'tool-1',
        title: 'Run Bash',
        kind: 'execute',
        status: 'pending',
      },
      options: [
        {
          kind: 'allow_once',
          name: 'Allow once',
          optionId: 'allow',
        },
      ],
    };
    await nextTick();

    expect(store.pendingPermissionAgentName).toBe('direct');
    expect(store.pendingPermissionSessionTitle).toContain('Session');
    store.resolvePermission('allow');
    expect(direct.resolvePermission).toHaveBeenCalledWith('allow');
  });

  it('disconnects only the selected Profile and preserves other conversations', async () => {
    register('direct', ['direct-1']);
    register('oag', ['oag-1']);
    const store = useSessionStore();

    const directKey = await store.createSession('direct', '/demo');
    const oagKey = await store.createSession('oag', '/demo');
    await store.disconnectProfile('direct');

    store.selectConversation(oagKey);
    expect(store.isConnected).toBe(true);
    store.selectConversation(directKey);
    expect(store.isConnected).toBe(false);
    expect(store.openConversations).toHaveLength(2);
  });

  it('reactively clears the first session-list loading state', async () => {
    const direct = register('direct', []);
    const listResult = deferred<{
      sessions: [];
      nextCursor: null;
    }>();
    direct.unstable_listSessions.mockImplementation(
      () => listResult.promise,
    );
    const store = useSessionStore();

    const refresh = store.refreshSessions('direct');
    await vi.waitFor(() => {
      expect(direct.unstable_listSessions).toHaveBeenCalledTimes(1);
    });

    const observed: boolean[] = [];
    const stop = watch(
      () => store.isRefreshingAgent('direct'),
      (value) => observed.push(value),
      { immediate: true, flush: 'sync' },
    );
    listResult.resolve({ sessions: [], nextCursor: null });
    await refresh;
    stop();

    expect(observed).toEqual([true, false]);
  });

  it('finishes discovery before opening the persistent Profile connection', async () => {
    const direct = register('direct', ['direct-1']);
    const listResult = deferred<{
      sessions: [];
      nextCursor: null;
    }>();
    direct.unstable_listSessions.mockImplementationOnce(
      () => listResult.promise,
    );
    const store = useSessionStore();

    const refresh = store.refreshSessions('direct');
    await vi.waitFor(() => {
      expect(direct.unstable_listSessions).toHaveBeenCalledTimes(1);
    });

    const creation = store.createSession('direct', '/demo');
    await Promise.resolve();
    expect(bridgeMocks.createAcpClient).toHaveBeenCalledTimes(1);
    expect(direct.newSession).not.toHaveBeenCalled();

    listResult.resolve({ sessions: [], nextCursor: null });
    await refresh;
    await expect(creation).resolves.toBe('direct:direct-1');

    expect(bridgeMocks.createAcpClient).toHaveBeenCalledTimes(2);
    expect(direct.disconnect).toHaveBeenCalledTimes(1);
    expect(direct.newSession).toHaveBeenCalledTimes(1);
  });

  it('rejects deletion while Session discovery is in flight', async () => {
    const direct = register('direct', []);
    const listResult = deferred<{
      sessions: [];
      nextCursor: null;
    }>();
    direct.unstable_listSessions.mockImplementationOnce(
      () => listResult.promise,
    );
    const store = useSessionStore();

    const refresh = store.refreshSessions('direct');
    await vi.waitFor(() => {
      expect(store.isProfileBusy('direct')).toBe(true);
    });

    await expect(
      store.deleteConversation('direct', 'session-1'),
    ).rejects.toThrow('still running');
    expect(apiMocks.deleteProfileSession).not.toHaveBeenCalled();

    listResult.resolve({ sessions: [], nextCursor: null });
    await refresh;
    expect(store.isProfileBusy('direct')).toBe(false);
  });

  it('rejects deletion while a Profile connection is opening', async () => {
    const direct = register('direct', ['direct-1']);
    const connection = deferred<AcpClientBridge>();
    bridgeMocks.createAcpClient.mockImplementationOnce(
      () => connection.promise,
    );
    const store = useSessionStore();

    const creation = store.createSession('direct', '/demo');
    await vi.waitFor(() => {
      expect(store.isProfileConnecting('direct')).toBe(true);
      expect(store.isProfileBusy('direct')).toBe(true);
    });

    await expect(
      store.deleteConversation('direct', 'session-1'),
    ).rejects.toThrow('still running');
    expect(apiMocks.deleteProfileSession).not.toHaveBeenCalled();

    connection.resolve(direct as unknown as AcpClientBridge);
    await expect(creation).resolves.toBe('direct:direct-1');
  });

  it('blocks new discovery and connections during durable deletion', async () => {
    register('direct', ['direct-1', 'direct-2']);
    const deletion = deferred<undefined>();
    apiMocks.deleteProfileSession.mockImplementationOnce(
      () => deletion.promise,
    );
    const store = useSessionStore();
    await store.createSession('direct', '/demo');

    const remove = store.deleteConversation('direct', 'direct-1');
    await vi.waitFor(() => {
      expect(apiMocks.deleteProfileSession).toHaveBeenCalledTimes(1);
    });
    const bridgeCallsBeforeMaintenanceChecks =
      bridgeMocks.createAcpClient.mock.calls.length;

    await expect(store.refreshSessions('direct')).resolves.toBeUndefined();
    await expect(
      store.createSession('direct', '/demo'),
    ).rejects.toThrow('undergoing maintenance');
    expect(bridgeMocks.createAcpClient).toHaveBeenCalledTimes(
      bridgeCallsBeforeMaintenanceChecks,
    );

    deletion.resolve(undefined);
    await remove;
  });

  it('can finish a background Session creation without stealing the visible conversation', async () => {
    register('direct', ['direct-1']);
    register('oag', ['oag-1']);
    const store = useSessionStore();

    const directKey = await store.createSession('direct', '/demo');
    const oagKey = await store.createSession('oag', '/demo', {
      activate: false,
    });

    expect(store.activeConversationKey).toBe(directKey);
    expect(store.openConversations.some((item) => item.key === oagKey)).toBe(
      true,
    );
  });

  it('retains the last projection when reconnecting session/load fails', async () => {
    const direct = register('direct', ['direct-1']);
    const store = useSessionStore();

    await store.createSession('direct', '/demo');
    const run = store.sendPrompt('question');
    emitText(direct, 'direct-1', 'answer to keep');
    promptMaps.get('direct')?.get('direct-1')?.resolve({});
    await run;
    const saved = store.currentSession;
    expect(saved).not.toBeNull();

    await store.disconnectProfile('direct');
    direct.loadSession.mockRejectedValueOnce(new Error('load failed'));
    await expect(store.resumeSession(saved!)).rejects.toThrow('load failed');

    expect(store.messageList.some((message) => message.content === 'answer to keep')).toBe(
      true,
    );
    expect(store.isConnected).toBe(false);
  });

  it('deduplicates repeated loads of the same Session', async () => {
    const direct = register('direct', ['direct-1']);
    const store = useSessionStore();

    await store.createSession('direct', '/demo');
    const saved = { ...store.currentSession! };
    await store.disconnectProfile('direct');

    const loadResult = deferred<Record<string, never>>();
    direct.loadSession.mockImplementation(() => loadResult.promise);

    const firstLoad = store.resumeSession(saved);
    const secondLoad = store.resumeSession(saved);
    await vi.waitFor(() => {
      expect(direct.loadSession).toHaveBeenCalledTimes(1);
    });
    expect(store.isLoading).toBe(true);

    loadResult.resolve({});
    await Promise.all([firstLoad, secondLoad]);

    expect(direct.loadSession).toHaveBeenCalledTimes(1);
    expect(store.isConnected).toBe(true);
    expect(store.isLoading).toBe(false);

    await store.disconnectProfile('direct');
    await store.resumeSession(saved);
    expect(direct.loadSession).toHaveBeenCalledTimes(2);
    expect(store.isConnected).toBe(true);
  });

  it('does not expose a transport error after an intentional disconnect', async () => {
    const direct = register('direct', ['direct-1']);
    const store = useSessionStore();

    await store.createSession('direct', '/demo');
    const promptResult = store.sendPrompt('question').then(
      () => null,
      (cause: unknown) => cause,
    );
    const pendingPrompt = promptMaps.get('direct')?.get('direct-1');
    expect(pendingPrompt).toBeDefined();
    direct.disconnect.mockImplementationOnce(async () => {
      pendingPrompt?.reject(new Error('transport closed: client disconnected'));
      await Promise.resolve();
    });

    await store.disconnectProfile('direct');
    expect(await promptResult).toBeInstanceOf(Error);
    expect(store.error).toBeNull();
    expect(store.isConnected).toBe(false);
  });
});
