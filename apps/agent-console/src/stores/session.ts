// ACP session manager.
//
// OpenCode owns durable sessions and history. This store only keeps the
// conversations that are open in the current page, with one ACP connection
// per Runtime Project and one independent projection per ACP session.
import { defineStore } from 'pinia';
import { computed, reactive, ref, shallowRef, watch } from 'vue';
import type {
  AuthMethod,
  InitializeResponse,
  SessionNotification,
} from '@agentclientprotocol/sdk';
import { deleteRuntimeSession, getAppVersion } from '../lib/runtime-api';
import {
  type RuntimeProject,
  type PermissionRequest,
  type SavedSession,
} from '../lib/types';
import { createAcpClient, type AcpClientBridge } from '../lib/acp-bridge';
import {
  applyProjectionUpdate,
  restoreProjection,
  snapshotProjection,
  type SessionProjection,
} from '../lib/session-projection';
import { useRuntimeStore } from './runtime';

const PROTOCOL_VERSION = 1;

type RuntimeConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export type OpenConversationStatus =
  | 'running'
  | 'needs_attention'
  | 'connecting'
  | 'reconnecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export interface OpenConversationSummary {
  key: string;
  runtimeId: string;
  sessionId: string;
  title: string;
  lastUpdated: number;
  status: OpenConversationStatus;
  statusLabel: string;
  isActive: boolean;
}

interface RuntimeConnectionState {
  status: RuntimeConnectionStatus;
  error: string | null;
  supportsSessionList: boolean;
  supportsLoadSession: boolean;
  activePromptKey: string | null;
  isRefreshingSessions: boolean;
  sessionListError: string | null;
  listGeneration: number;
}

interface ConversationState extends SessionProjection {
  key: string;
  isLoading: boolean;
  isHydrating: boolean;
  hydrated: boolean;
  error: string | null;
  openedAt: number;
}

interface RuntimeConnection {
  client: AcpClientBridge | null;
  connectPromise: Promise<AcpClientBridge> | null;
  discoveryPromise: Promise<void> | null;
  pendingLoads: Map<string, Promise<string>>;
  stopPermissionWatch: (() => void) | null;
  authMethods: AuthMethod[];
  pendingSessionCreations: number;
  pendingUpdates: Map<string, SessionNotification[]>;
}

interface AuthPrompt {
  id: string;
  runtimeId: string;
  methods: AuthMethod[];
  resolve: (methodId: string | null) => void;
}

const appVersion = getAppVersion();

function keyOf(runtimeId: string, sessionId: string): string {
  return `${runtimeId}:${sessionId}`;
}

function monotonicNow(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function isAuthRequired(cause: unknown): boolean {
  if (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    cause.code === -32000
  ) {
    return true;
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  return (
    message.toLowerCase().includes('authentication required') ||
    message.includes('-32000')
  );
}

export const useSessionStore = defineStore('session', () => {
  const savedSessions = ref<SavedSession[]>([]);
  const conversations = reactive(new Map<string, ConversationState>());
  const runtimeStates = reactive(new Map<string, RuntimeConnectionState>());
  const activeConversationKey = ref<string | null>(null);
  const pendingPermissions = reactive(new Map<string, PermissionRequest>());
  const authPrompts = shallowRef<AuthPrompt[]>([]);
  const maintenanceRuntimes = new Set<string>();

  // ACP clients, promises, timers and unwatch functions must not be wrapped
  // in Vue proxies.
  const runtimes = new Map<string, RuntimeConnection>();
  let openedSequence = 0;

  function getRuntimeState(runtimeId: string): RuntimeConnectionState {
    let state = runtimeStates.get(runtimeId);
    if (!state) {
      state = {
        status: 'disconnected',
        error: null,
        supportsSessionList: false,
        supportsLoadSession: false,
        activePromptKey: null,
        isRefreshingSessions: false,
        sessionListError: null,
        listGeneration: 0,
      };
      runtimeStates.set(runtimeId, state);
      // Return the Map's reactive proxy, not the raw object that was just
      // inserted. Async mutations on the raw object would otherwise update
      // data without notifying Vue.
      return runtimeStates.get(runtimeId) as RuntimeConnectionState;
    }
    return state;
  }

  function getRuntime(runtimeId: string): RuntimeConnection {
    let runtime = runtimes.get(runtimeId);
    if (!runtime) {
      runtime = {
        client: null,
        connectPromise: null,
        discoveryPromise: null,
        pendingLoads: new Map(),
        stopPermissionWatch: null,
        authMethods: [],
        pendingSessionCreations: 0,
        pendingUpdates: new Map(),
      };
      runtimes.set(runtimeId, runtime);
    }
    return runtime;
  }

  const activeConversation = computed(() => {
    const key = activeConversationKey.value;
    return key ? conversations.get(key) ?? null : null;
  });

  const activeRuntimeState = computed(() => {
    const conversation = activeConversation.value;
    return conversation
      ? getRuntimeState(conversation.session.runtimeId)
      : null;
  });

  const currentSession = computed(
    () => activeConversation.value?.session ?? null,
  );
  const messageList = computed(
    () => activeConversation.value?.messages ?? [],
  );
  const hasActiveSession = computed(() => activeConversation.value !== null);
  const isConnected = computed(() => {
    const conversation = activeConversation.value;
    const runtimeState = activeRuntimeState.value;
    return (
      conversation !== null &&
      conversation.hydrated &&
      runtimeState?.status === 'connected'
    );
  });
  const isLoading = computed(() => {
    const conversation = activeConversation.value;
    return Boolean(conversation?.isLoading || conversation?.isHydrating);
  });
  const isPrompting = computed(
    () => activeConversation.value?.isLoading ?? false,
  );
  const isConnecting = computed(
    () => activeRuntimeState.value?.status === 'connecting',
  );
  const isReconnecting = computed(() => {
    const conversation = activeConversation.value;
    return Boolean(
      conversation?.isHydrating ||
      activeRuntimeState.value?.status === 'reconnecting',
    );
  });
  const error = computed(
    () =>
      activeConversation.value?.error ??
      activeRuntimeState.value?.error ??
      null,
  );
  const resumableSessions = computed(() =>
    savedSessions.value.filter((session) => session.supportsLoadSession === true),
  );
  const isCurrentRuntimeBusyElsewhere = computed(() => {
    const conversation = activeConversation.value;
    const owner = activeRuntimeState.value?.activePromptKey;
    return Boolean(conversation && owner && owner !== conversation.key);
  });

  function getPendingPermissionEntry():
    | { runtimeId: string; request: PermissionRequest }
    | null {
    const conversation = activeConversation.value;
    if (conversation) {
      const request = pendingPermissions.get(conversation.session.runtimeId);
      if (request?.sessionId === conversation.session.sessionId) {
        return {
          runtimeId: conversation.session.runtimeId,
          request,
        };
      }
    }

    for (const [runtimeId, request] of pendingPermissions) {
      return { runtimeId, request };
    }
    return null;
  }

  const pendingPermission = computed(
    () => getPendingPermissionEntry()?.request ?? null,
  );
  const pendingPermissionRuntimeId = computed(
    () => getPendingPermissionEntry()?.runtimeId ?? '',
  );
  const pendingPermissionSessionTitle = computed(() => {
    const entry = getPendingPermissionEntry();
    if (!entry) return '';
    return (
      conversations.get(keyOf(entry.runtimeId, entry.request.sessionId))
        ?.session.title ?? entry.request.sessionId
    );
  });
  const pendingAuthMethods = computed(
    () => authPrompts.value[0]?.methods ?? [],
  );
  const pendingAuthRuntimeId = computed(
    () => authPrompts.value[0]?.runtimeId ?? '',
  );

  function conversationStatus(
    conversation: ConversationState,
  ): Pick<OpenConversationSummary, 'status' | 'statusLabel'> {
    const permission = pendingPermissions.get(conversation.session.runtimeId);
    if (permission?.sessionId === conversation.session.sessionId) {
      return { status: 'needs_attention', statusLabel: 'Needs attention' };
    }
    if (conversation.isLoading) {
      return { status: 'running', statusLabel: 'Running' };
    }
    if (conversation.isHydrating) {
      return { status: 'connecting', statusLabel: 'Loading' };
    }

    const runtimeState = getRuntimeState(conversation.session.runtimeId);
    if (runtimeState.status === 'connecting') {
      return { status: 'connecting', statusLabel: 'Connecting' };
    }
    if (runtimeState.status === 'reconnecting') {
      return { status: 'reconnecting', statusLabel: 'Reconnecting' };
    }
    if (conversation.error || runtimeState.status === 'error') {
      return { status: 'error', statusLabel: 'Error' };
    }
    if (runtimeState.status === 'connected' && conversation.hydrated) {
      return { status: 'connected', statusLabel: 'Connected' };
    }
    return { status: 'disconnected', statusLabel: 'Disconnected' };
  }

  const openConversations = computed<OpenConversationSummary[]>(() =>
    Array.from(conversations.values())
      .sort((left, right) => right.openedAt - left.openedAt)
      .map((conversation) => ({
        key: conversation.key,
        runtimeId: conversation.session.runtimeId,
        sessionId: conversation.session.sessionId,
        title: conversation.session.title,
        lastUpdated: conversation.session.lastUpdated,
        ...conversationStatus(conversation),
        isActive: conversation.key === activeConversationKey.value,
      })),
  );

  function initializeClient(
    client: AcpClientBridge,
  ): Promise<InitializeResponse> {
    return client.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        fs: {
          readTextFile: false,
          writeTextFile: false,
        },
      },
      clientInfo: {
        name: 'ontology-agent-console',
        title: 'Ontology Agent Console',
        version: appVersion,
      },
    });
  }

  function createConversation(session: SavedSession): ConversationState {
    const key = keyOf(session.runtimeId, session.sessionId);
    const existing = conversations.get(key);
    if (existing) {
      existing.session = session;
      return existing;
    }

    const conversation: ConversationState = {
      key,
      session,
      messages: [],
      isLoading: false,
      isHydrating: false,
      hydrated: false,
      replayingHistory: false,
      replayLastUpdateAt: 0,
      error: null,
      openedAt: ++openedSequence,
    };
    conversations.set(key, conversation);
    return conversations.get(key) as ConversationState;
  }

  function saveSession(session: SavedSession): void {
    const normalized: SavedSession = {
      ...session,
      id: keyOf(session.runtimeId, session.sessionId),
    };
    const conversation = conversations.get(normalized.id);
    if (conversation) {
      conversation.session = normalized;
    }
    savedSessions.value = [
      normalized,
      ...savedSessions.value.filter(
        (saved) =>
          saved.runtimeId !== normalized.runtimeId ||
          saved.sessionId !== normalized.sessionId,
      ),
    ];
  }

  function replaceSessionsForRuntime(
    runtimeId: string,
    listedSessions: SavedSession[],
  ): void {
    const sessions = listedSessions
      .map((listed) => {
        const key = keyOf(runtimeId, listed.sessionId);
        const open = conversations.get(key);
        if (!open) return { ...listed, id: key };
        open.session.title = listed.title;
        open.session.lastUpdated = listed.lastUpdated;
        open.session.supportsLoadSession = listed.supportsLoadSession;
        return open.session;
      });
    savedSessions.value = [
      ...savedSessions.value.filter(
        (session) => session.runtimeId !== runtimeId,
      ),
      ...sessions,
    ];
  }

  function applySessionUpdate(
    runtimeId: string,
    conversation: ConversationState,
    notification: SessionNotification,
  ): void {
    if (!applyProjectionUpdate(conversation, notification)) return;
    const saved = savedSessions.value.find(
      (session) =>
        session.runtimeId === runtimeId &&
        session.sessionId === notification.sessionId,
    );
    if (saved && saved !== conversation.session) {
      saved.title = conversation.session.title;
      saved.lastUpdated = conversation.session.lastUpdated;
    }
  }

  function handleSessionUpdate(
    runtimeId: string,
    notification: SessionNotification,
  ): void {
    const conversation = conversations.get(
      keyOf(runtimeId, notification.sessionId),
    );
    if (conversation) {
      applySessionUpdate(runtimeId, conversation, notification);
      return;
    }

    // session/new may emit initial updates before its response reveals the
    // new sessionId. Buffer only while a creation request is active.
    const runtime = getRuntime(runtimeId);
    if (runtime.pendingSessionCreations > 0) {
      const queued = runtime.pendingUpdates.get(notification.sessionId) ?? [];
      if (queued.length < 100) queued.push(notification);
      runtime.pendingUpdates.set(notification.sessionId, queued);
    }
  }

  function drainPendingUpdates(
    runtimeId: string,
    conversation: ConversationState,
  ): void {
    const runtime = getRuntime(runtimeId);
    const queued = runtime.pendingUpdates.get(conversation.session.sessionId);
    runtime.pendingUpdates.delete(conversation.session.sessionId);
    if (!queued) return;
    for (const notification of queued) {
      applySessionUpdate(runtimeId, conversation, notification);
    }
  }

  function handleUnexpectedClose(
    runtimeId: string,
    client: AcpClientBridge,
    reason?: string,
  ): void {
    const runtime = getRuntime(runtimeId);
    if (runtime.client !== client) return;

    runtime.stopPermissionWatch?.();
    runtime.stopPermissionWatch = null;
    runtime.client = null;
    pendingPermissions.delete(runtimeId);

    const state = getRuntimeState(runtimeId);
    const expectedMaintenance = maintenanceRuntimes.has(runtimeId);
    state.status = expectedMaintenance ? 'disconnected' : 'error';
    state.error = expectedMaintenance
      ? null
      : `Connection lost: ${reason ?? 'transport closed'}`;
    state.activePromptKey = null;
    state.supportsSessionList = false;

    for (const conversation of conversations.values()) {
      if (conversation.session.runtimeId !== runtimeId) continue;
      conversation.hydrated = false;
      conversation.isLoading = false;
      conversation.isHydrating = false;
      conversation.replayingHistory = false;
    }
  }

  function bindClient(
    runtimeId: string,
    client: AcpClientBridge,
  ): void {
    const runtime = getRuntime(runtimeId);
    client.onSessionUpdate = (notification) => {
      handleSessionUpdate(runtimeId, notification);
    };
    client.onTransportClose = (reason) => {
      handleUnexpectedClose(runtimeId, client, reason);
    };
    runtime.stopPermissionWatch?.();
    runtime.stopPermissionWatch = watch(
      () => client.pendingPermissionRequest.value,
      (request) => {
        if (runtime.client !== client) return;
        if (request) {
          pendingPermissions.set(runtimeId, request);
        } else {
          pendingPermissions.delete(runtimeId);
        }
      },
      { immediate: true },
    );
  }

  function unbindClient(
    runtimeId: string,
    client: AcpClientBridge,
  ): void {
    const runtime = getRuntime(runtimeId);
    if (runtime.client !== client) return;
    runtime.stopPermissionWatch?.();
    runtime.stopPermissionWatch = null;
    pendingPermissions.delete(runtimeId);
    client.onSessionUpdate = null;
    client.onTransportClose = null;
  }

  async function connectRuntimeTransport(
    runtimeId: string,
    project: RuntimeProject,
  ): Promise<AcpClientBridge> {
    return createAcpClient({ runtimeId, project });
  }

  async function ensureRuntimeClient(
    runtimeId: string,
    options: { reconnecting?: boolean; skipDiscovery?: boolean } = {},
  ): Promise<AcpClientBridge> {
    const state = getRuntimeState(runtimeId);
    const runtime = getRuntime(runtimeId);
    if (maintenanceRuntimes.has(runtimeId)) {
      throw new Error(
        'This Runtime Project is undergoing maintenance. Try again in a moment.',
      );
    }
    if (!options.skipDiscovery && runtime.discoveryPromise) {
      await runtime.discoveryPromise;
      if (maintenanceRuntimes.has(runtimeId)) {
        throw new Error(
          'This Runtime Project is undergoing maintenance. Try again in a moment.',
        );
      }
    }
    if (runtime.client && state.status === 'connected') {
      return runtime.client;
    }
    if (runtime.connectPromise) return runtime.connectPromise;

    const runtimeStore = useRuntimeStore();
    const project = runtimeStore.getProject(runtimeId);
    if (!project) throw new Error(`Runtime Project '${runtimeId}' was not found`);
    if (!runtimeStore.canReadSessions(runtimeId)) {
      throw new Error(
        'This Runtime Project is not ready to open ACP sessions',
      );
    }

    state.status = options.reconnecting ? 'reconnecting' : 'connecting';
    state.error = null;

    const promise = (async (): Promise<AcpClientBridge> => {
      let client: AcpClientBridge | null = null;
      try {
        client = await connectRuntimeTransport(runtimeId, project);
        if (maintenanceRuntimes.has(runtimeId)) {
          await client.disconnect();
          client = null;
          throw new Error('Runtime Project entered maintenance while connecting');
        }

        runtime.client = client;
        bindClient(runtimeId, client);
        const response = await initializeClient(client);

        if (
          runtime.client !== client ||
          maintenanceRuntimes.has(runtimeId)
        ) {
          throw new Error('Connection closed while initializing');
        }

        runtime.authMethods = response.authMethods ?? [];
        state.supportsSessionList =
          response.agentCapabilities?.sessionCapabilities?.list != null;
        state.supportsLoadSession =
          response.agentCapabilities?.loadSession ?? false;
        state.status = 'connected';
        state.error = null;
        return client;
      } catch (cause) {
        if (client) {
          try {
            if (runtime.client === client) {
              unbindClient(runtimeId, client);
              runtime.client = null;
            }
            await client.disconnect();
          } catch (cleanupError) {
            console.warn(
              'disconnect during Runtime Project connection cleanup failed:',
              cleanupError,
            );
          }
        }

        state.status = maintenanceRuntimes.has(runtimeId)
          ? 'disconnected'
          : 'error';
        state.error = maintenanceRuntimes.has(runtimeId)
          ? null
          : cause instanceof Error
            ? cause.message
            : String(cause);
        throw cause;
      }
    })();

    runtime.connectPromise = promise;
    try {
      return await promise;
    } finally {
      if (runtime.connectPromise === promise) {
        runtime.connectPromise = null;
      }
    }
  }

  async function waitForReplayQuiescence(
    conversation: ConversationState,
  ): Promise<void> {
    const deadline = Date.now() + 250;
    while (Date.now() < deadline) {
      if (Date.now() - conversation.replayLastUpdateAt >= 50) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
  }

  function promptForAuthMethod(
    methods: AuthMethod[],
    runtimeId: string,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      authPrompts.value = [
        ...authPrompts.value,
        {
          id: crypto.randomUUID(),
          runtimeId,
          methods,
          resolve,
        },
      ];
    });
  }

  function settleAuthPrompt(methodId: string | null): void {
    const [prompt, ...remaining] = authPrompts.value;
    if (!prompt) return;
    authPrompts.value = remaining;
    prompt.resolve(methodId);
  }

  function selectAuthMethod(methodId: string): void {
    settleAuthPrompt(methodId);
  }

  function cancelAuthSelection(): void {
    settleAuthPrompt(null);
  }

  function cancelAuthForRuntime(runtimeId: string): void {
    const cancelled = authPrompts.value.filter(
      (prompt) => prompt.runtimeId === runtimeId,
    );
    if (cancelled.length === 0) return;
    authPrompts.value = authPrompts.value.filter(
      (prompt) => prompt.runtimeId !== runtimeId,
    );
    for (const prompt of cancelled) prompt.resolve(null);
  }

  async function withAuthentication<T>(
    runtimeId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (cause) {
      const runtime = getRuntime(runtimeId);
      if (!isAuthRequired(cause) || runtime.authMethods.length === 0) {
        throw cause;
      }

      const methodId = await promptForAuthMethod(
        runtime.authMethods,
        runtimeId,
      );
      if (!methodId) throw new Error('Authentication cancelled by user');
      const client = runtime.client;
      if (!client) {
        throw new Error('Runtime connection closed during authentication');
      }
      await client.authenticate({ methodId });
      return operation();
    }
  }

  function refreshSessions(runtimeId: string): Promise<void> {
    const runtime = getRuntime(runtimeId);
    if (runtime.discoveryPromise) return runtime.discoveryPromise;
    if (maintenanceRuntimes.has(runtimeId)) {
      return Promise.resolve();
    }

    const discovery = performSessionRefresh(runtimeId);
    runtime.discoveryPromise = discovery;
    void discovery.finally(() => {
      if (runtime.discoveryPromise === discovery) {
        runtime.discoveryPromise = null;
      }
    });
    return discovery;
  }

  async function performSessionRefresh(runtimeId: string): Promise<void> {
    const state = getRuntimeState(runtimeId);
    const generation = ++state.listGeneration;
    state.isRefreshingSessions = true;
    state.sessionListError = null;

    let client: AcpClientBridge | null = null;
    let ownsClient = false;
    try {
      const runtimeStore = useRuntimeStore();
      const project = runtimeStore.getProject(runtimeId);
      if (!project) {
        throw new Error(`Runtime Project '${runtimeId}' was not found`);
      }
      if (!runtimeStore.canReadSessions(runtimeId)) {
        replaceSessionsForRuntime(runtimeId, []);
        return;
      }

      const runtime = getRuntime(runtimeId);
      if (runtime.client || runtime.connectPromise) {
        client = await ensureRuntimeClient(runtimeId, {
          skipDiscovery: true,
        });
      } else {
        client = await connectRuntimeTransport(runtimeId, project);
        ownsClient = true;
      }

      const initResponse = ownsClient
        ? await initializeClient(client)
        : null;
      const supportsList = ownsClient
        ? initResponse?.agentCapabilities?.sessionCapabilities?.list != null
        : state.supportsSessionList;
      const supportsLoad = ownsClient
        ? initResponse?.agentCapabilities?.loadSession === true
        : state.supportsLoadSession;

      if (!supportsList || !supportsLoad) {
        if (generation === state.listGeneration) {
          replaceSessionsForRuntime(runtimeId, []);
          state.sessionListError =
            'This Runtime does not advertise ACP session/list and session/load.';
        }
        return;
      }

      const listed: SavedSession[] = [];
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < 100; page += 1) {
        const response = await client.unstable_listSessions({
          cwd: project.cwd,
          cursor,
        });
        for (const session of response.sessions) {
          if (session.cwd !== project.cwd) continue;
          const parsedUpdatedAt = session.updatedAt
            ? Date.parse(session.updatedAt)
            : Number.NaN;
          listed.push({
            id: keyOf(runtimeId, session.sessionId),
            runtimeId,
            sessionId: session.sessionId,
            title: session.title?.trim() || 'Untitled session',
            lastUpdated: Number.isFinite(parsedUpdatedAt)
              ? parsedUpdatedAt
              : 0,
            cwd: project.cwd,
            supportsLoadSession: true,
          });
        }

        const nextCursor = response.nextCursor ?? undefined;
        if (!nextCursor) break;
        if (seenCursors.has(nextCursor)) {
          throw new Error('Runtime returned a repeated session/list cursor');
        }
        seenCursors.add(nextCursor);
        cursor = nextCursor;
        if (page === 99) {
          throw new Error('Runtime session/list exceeded 100 pages');
        }
      }

      if (generation === state.listGeneration) {
        replaceSessionsForRuntime(runtimeId, listed);
      }
    } catch (cause) {
      if (generation === state.listGeneration) {
        state.sessionListError =
          cause instanceof Error ? cause.message : String(cause);
      }
    } finally {
      if (client && ownsClient) {
        await client.disconnect().catch(() => undefined);
      }
      if (generation === state.listGeneration) {
        state.isRefreshingSessions = false;
      }
    }
  }

  async function createSession(
    runtimeId: string,
    cwd: string,
    options: { activate?: boolean } = {},
  ): Promise<string> {
    if (maintenanceRuntimes.has(runtimeId)) {
      throw new Error(
        'This Runtime Project is undergoing maintenance. Try again in a moment.',
      );
    }
    const runtimeStore = useRuntimeStore();
    const project = runtimeStore.getProject(runtimeId);
    if (!project) throw new Error(`Runtime Project '${runtimeId}' was not found`);
    if (!runtimeStore.isRunnable(runtimeId)) {
      throw new Error(
        project.stale
          ? 'This Runtime Project is stale. Delete and recreate it before starting a new conversation.'
          : 'This Runtime Project is not ready for a new conversation.',
      );
    }
    if (cwd !== project.cwd) {
      throw new Error(
        'Session working directory does not match its Runtime Project',
      );
    }

    const state = getRuntimeState(runtimeId);
    const runtime = getRuntime(runtimeId);
    const client = await ensureRuntimeClient(runtimeId);
    runtime.pendingSessionCreations += 1;
    try {
      const response = await withAuthentication(runtimeId, () =>
        client.newSession({
          cwd,
          mcpServers: [],
        }),
      );
      const session: SavedSession = {
        id: keyOf(runtimeId, response.sessionId),
        runtimeId,
        sessionId: response.sessionId,
        title: `Session ${new Date().toLocaleString()}`,
        lastUpdated: Date.now(),
        cwd,
        supportsLoadSession: state.supportsLoadSession,
      };
      const conversation = createConversation(session);
      conversation.hydrated = true;
      conversation.error = null;
      drainPendingUpdates(runtimeId, conversation);
      saveSession(session);
      if (options.activate !== false) {
        activeConversationKey.value = conversation.key;
      }
      return conversation.key;
    } catch (cause) {
      state.error = cause instanceof Error ? cause.message : String(cause);
      const runtimeHasConversation = Array.from(conversations.values()).some(
        (conversation) => conversation.session.runtimeId === runtimeId,
      );
      if (
        !runtimeHasConversation &&
        runtime.pendingSessionCreations === 1 &&
        runtime.client === client
      ) {
        unbindClient(runtimeId, client);
        runtime.client = null;
        await client.disconnect().catch(() => undefined);
        state.status = 'error';
        state.supportsSessionList = false;
      }
      throw cause;
    } finally {
      runtime.pendingSessionCreations -= 1;
    }
  }

  async function performConversationLoad(
    savedSession: SavedSession,
    reconnecting = false,
  ): Promise<string> {
    if (maintenanceRuntimes.has(savedSession.runtimeId)) {
      throw new Error(
        'This Runtime Project is undergoing maintenance. Try again in a moment.',
      );
    }
    const key = keyOf(savedSession.runtimeId, savedSession.sessionId);
    let conversation = conversations.get(key);
    if (!conversation) {
      conversation = createConversation({
        ...savedSession,
        id: key,
      });
    }
    activeConversationKey.value = key;

    const state = getRuntimeState(savedSession.runtimeId);
    const runtime = getRuntime(savedSession.runtimeId);
    if (
      state.activePromptKey &&
      state.activePromptKey !== conversation.key
    ) {
      const message =
        'This Runtime Project is running another conversation. Wait for that turn to finish before loading this session.';
      conversation.error = message;
      throw new Error(message);
    }

    const runtimeStore = useRuntimeStore();
    const project = runtimeStore.getProject(savedSession.runtimeId);
    if (!project) {
      throw new Error(
        `Runtime Project '${savedSession.runtimeId}' was not found`,
      );
    }
    if (!runtimeStore.canReadSessions(savedSession.runtimeId)) {
      throw new Error('This Runtime Project cannot open existing conversations');
    }
    if (savedSession.cwd !== project.cwd) {
      throw new Error(
        'Session working directory does not match its Runtime Project',
      );
    }

    const previousProjection = snapshotProjection(conversation);
    conversation.error = null;
    conversation.isHydrating = true;
    let client: AcpClientBridge | null = null;
    try {
      const activeClient = await ensureRuntimeClient(savedSession.runtimeId, {
        reconnecting,
      });
      client = activeClient;
      if (!state.supportsLoadSession) {
        throw new Error('This Runtime does not advertise ACP session/load');
      }

      conversation.messages.splice(0);
      conversation.replayingHistory = true;
      conversation.replayLastUpdateAt = Date.now();

      await withAuthentication(savedSession.runtimeId, () =>
        activeClient.loadSession({
          sessionId: savedSession.sessionId,
          cwd: project.cwd,
          mcpServers: [],
        }),
      );
      await waitForReplayQuiescence(conversation);
      conversation.hydrated = true;
      conversation.error = null;
      state.status = 'connected';
      state.error = null;
      saveSession(conversation.session);
      return key;
    } catch (cause) {
      // A reconnect must not destroy the last useful in-page projection when
      // session/load fails halfway through. OpenCode remains authoritative,
      // but the retained snapshot lets the user read and retry.
      restoreProjection(conversation, previousProjection);
      conversation.hydrated = false;
      // An explicit disconnect replaces the runtime client before closing
      // the transport. Keep that user action from surfacing as a failed
      // history load; unexpected closes are reported at Runtime Project level.
      conversation.error =
        client && runtime.client !== client
          ? null
          : cause instanceof Error
            ? cause.message
            : String(cause);
      throw cause;
    } finally {
      conversation.replayingHistory = false;
      conversation.isHydrating = false;
      // Keep the connection alive; another Session on this Runtime may already
      // be using the same ACP connection.
      void runtime;
    }
  }

  function loadConversation(
    savedSession: SavedSession,
    reconnecting = false,
  ): Promise<string> {
    const key = keyOf(savedSession.runtimeId, savedSession.sessionId);
    const runtime = getRuntime(savedSession.runtimeId);
    const pending = runtime.pendingLoads.get(key);
    if (pending) {
      activeConversationKey.value = key;
      return pending;
    }

    const load = performConversationLoad(savedSession, reconnecting);
    runtime.pendingLoads.set(key, load);
    void load.finally(() => {
      if (runtime.pendingLoads.get(key) === load) {
        runtime.pendingLoads.delete(key);
      }
    }).catch(() => undefined);
    return load;
  }

  async function resumeSession(savedSession: SavedSession): Promise<string> {
    const key = keyOf(savedSession.runtimeId, savedSession.sessionId);
    const existing = conversations.get(key);
    const state = getRuntimeState(savedSession.runtimeId);
    const runtime = getRuntime(savedSession.runtimeId);
    if (
      existing?.hydrated &&
      runtime.client &&
      state.status === 'connected'
    ) {
      activeConversationKey.value = key;
      return key;
    }
    return loadConversation(savedSession);
  }

  function selectConversation(key: string): void {
    if (!conversations.has(key)) return;
    activeConversationKey.value = key;
  }

  async function sendPrompt(text: string): Promise<void> {
    const key = activeConversationKey.value;
    const conversation = key ? conversations.get(key) : null;
    if (!key || !conversation) throw new Error('No active session');

    const runtimeId = conversation.session.runtimeId;
    const state = getRuntimeState(runtimeId);
    const client = getRuntime(runtimeId).client;
    if (!client || state.status !== 'connected' || !conversation.hydrated) {
      throw new Error('The current conversation is not connected');
    }
    if (state.activePromptKey && state.activePromptKey !== key) {
      const message =
        'This Runtime Project is already running another conversation. Switch to it or wait for that turn to finish.';
      conversation.error = message;
      throw new Error(message);
    }
    if (conversation.isLoading) {
      throw new Error('This conversation is already running');
    }

    const turnStartedAt = Date.now();
    const turnStartedMonotonic = monotonicNow();
    const firstUserMessage = !conversation.messages.some(
      (message) => message.role === 'user',
    );
    conversation.messages.push({
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: turnStartedAt,
    });
    const turnMessageStartIndex = conversation.messages.length;
    if (firstUserMessage) {
      conversation.session.title =
        text.slice(0, 50) + (text.length > 50 ? '...' : '');
    }
    conversation.session.lastUpdated = Date.now();
    conversation.error = null;
    state.error = null;
    state.activePromptKey = key;
    conversation.isLoading = true;

    try {
      const promptResponse = await client.prompt({
        sessionId: conversation.session.sessionId,
        prompt: [{ type: 'text', text }],
      });
      const completedAt = Date.now();
      const durationMs = Math.max(
        0,
        Math.round(monotonicNow() - turnStartedMonotonic),
      );
      if (promptResponse.stopReason !== 'cancelled') {
        for (
          let index = conversation.messages.length - 1;
          index >= turnMessageStartIndex;
          index -= 1
        ) {
          const message = conversation.messages[index];
          if (message.role !== 'assistant') continue;
          message.completedAt = completedAt;
          message.durationMs = durationMs;
          message.finishReason = promptResponse.stopReason;
          break;
        }
      }
      conversation.session.lastUpdated = completedAt;
      saveSession(conversation.session);
    } catch (cause) {
      // disconnectRuntime() unbinds and clears the runtime client before
      // closing it. The rejected Prompt still reaches this catch, but an
      // intentional disconnect should not leave a red transport error.
      if (getRuntime(runtimeId).client === client) {
        conversation.error =
          cause instanceof Error ? cause.message : String(cause);
      }
      throw cause;
    } finally {
      conversation.isLoading = false;
      if (state.activePromptKey === key) {
        state.activePromptKey = null;
      }
    }
  }

  async function deleteConversation(
    runtimeId: string,
    sessionId: string,
  ): Promise<void> {
    const key = keyOf(runtimeId, sessionId);
    const permission = pendingPermissions.get(runtimeId);
    const runtime = getRuntime(runtimeId);
    const runtimeState = getRuntimeState(runtimeId);
    const runtimeConversationBusy = Array.from(conversations.values()).some(
      (candidate) =>
        candidate.session.runtimeId === runtimeId &&
        (candidate.isLoading || candidate.isHydrating),
    );
    if (
      maintenanceRuntimes.has(runtimeId) ||
      runtimeConversationBusy ||
      permission !== undefined ||
      runtimeState.activePromptKey !== null ||
      runtime.pendingSessionCreations > 0 ||
      runtime.pendingLoads.size > 0 ||
      runtime.connectPromise !== null ||
      runtime.discoveryPromise !== null ||
      runtimeState.isRefreshingSessions ||
      runtimeState.status === 'connecting' ||
      runtimeState.status === 'reconnecting'
    ) {
      throw new Error(
        'This Runtime Project is still running and cannot delete a conversation',
      );
    }

    const wasConnected =
      runtime.client !== null && runtimeState.status === 'connected';
    const activeBefore = activeConversationKey.value;
    maintenanceRuntimes.add(runtimeId);
    if (wasConnected) {
      // Make the server-initiated Runtime close expected from the browser's
      // perspective. The durable delete requires OpenCode's in-memory cache
      // to be gone before its CLI touches the isolated database.
      await disconnectRuntime(runtimeId);
    }

    let durableDeleted = false;
    try {
      await deleteRuntimeSession(runtimeId, sessionId);
      durableDeleted = true;
      // Invalidate only a session/list response that began before the durable
      // delete. A later authoritative list must be allowed to expose any
      // unexpected reappearance rather than being hidden by a tombstone.
      runtimeState.listGeneration += 1;
      runtimeState.isRefreshingSessions = false;
      savedSessions.value = savedSessions.value.filter(
        (saved) =>
          saved.runtimeId !== runtimeId || saved.sessionId !== sessionId,
      );
      conversations.delete(key);

      if (activeConversationKey.value === key) {
        const fallback = Array.from(conversations.values()).sort(
          (left, right) => right.openedAt - left.openedAt,
        )[0];
        activeConversationKey.value = fallback?.key ?? null;
      }
      if (pendingPermissions.get(runtimeId)?.sessionId === sessionId) {
        pendingPermissions.delete(runtimeId);
      }
    } finally {
      maintenanceRuntimes.delete(runtimeId);
      if (wasConnected) {
        const preferredKey = durableDeleted
          ? activeConversationKey.value
          : activeBefore;
        const reconnectConversation =
          (preferredKey
            ? conversations.get(preferredKey)
            : undefined)?.session.runtimeId === runtimeId
            ? conversations.get(preferredKey as string)
            : Array.from(conversations.values())
                .filter(
                  (candidate) =>
                    candidate.session.runtimeId === runtimeId &&
                    candidate.key !== (durableDeleted ? key : ''),
                )
                .sort(
                  (left, right) => right.openedAt - left.openedAt,
                )[0];
        if (reconnectConversation) {
          const visibleBeforeReconnect = activeConversationKey.value;
          try {
            await loadConversation(
              reconnectConversation.session,
              true,
            );
            if (
              visibleBeforeReconnect &&
              conversations.has(visibleBeforeReconnect)
            ) {
              activeConversationKey.value = visibleBeforeReconnect;
            }
          } catch (cause) {
            console.warn(
              'Runtime reconnect after Session maintenance failed:',
              cause,
            );
          }
        }
      }
    }
  }

  async function cancelOperation(): Promise<void> {
    const conversation = activeConversation.value;
    if (!conversation?.isLoading) return;
    const client = getRuntime(conversation.session.runtimeId).client;
    if (!client) return;
    await client.cancel({
      sessionId: conversation.session.sessionId,
    });
  }

  function resolvePermission(optionId: string): void {
    const entry = getPendingPermissionEntry();
    if (!entry) return;
    getRuntime(entry.runtimeId).client?.resolvePermission(optionId);
  }

  function cancelPermission(): void {
    const entry = getPendingPermissionEntry();
    if (!entry) return;
    getRuntime(entry.runtimeId).client?.cancelPermission();
  }

  async function disconnectRuntime(runtimeId: string): Promise<void> {
    const runtime = getRuntime(runtimeId);
    const state = getRuntimeState(runtimeId);
    cancelAuthForRuntime(runtimeId);

    const client = runtime.client;
    if (client) {
      unbindClient(runtimeId, client);
      runtime.client = null;
      await client.disconnect().catch((cause) => {
        console.error('Error disconnecting:', cause);
      });
    }
    state.status = 'disconnected';
    state.error = null;
    state.activePromptKey = null;
    state.supportsSessionList = false;
    pendingPermissions.delete(runtimeId);
    runtime.pendingUpdates.clear();

    for (const conversation of conversations.values()) {
      if (conversation.session.runtimeId !== runtimeId) continue;
      conversation.hydrated = false;
      conversation.isLoading = false;
      conversation.isHydrating = false;
      conversation.replayingHistory = false;
      conversation.error = null;
    }
  }

  async function removeRuntime(runtimeId: string): Promise<void> {
    await disconnectRuntime(runtimeId);
    savedSessions.value = savedSessions.value.filter(
      (session) => session.runtimeId !== runtimeId,
    );
    for (const [key, conversation] of conversations) {
      if (conversation.session.runtimeId === runtimeId) {
        conversations.delete(key);
      }
    }
    runtimeStates.delete(runtimeId);
    runtimes.delete(runtimeId);
    maintenanceRuntimes.delete(runtimeId);
    cancelAuthForRuntime(runtimeId);
    pendingPermissions.delete(runtimeId);
    if (
      activeConversationKey.value &&
      !conversations.has(activeConversationKey.value)
    ) {
      const fallback = Array.from(conversations.values()).sort(
        (left, right) => right.openedAt - left.openedAt,
      )[0];
      activeConversationKey.value = fallback?.key ?? null;
    }
  }

  function clearError(runtimeId?: string): void {
    if (runtimeId) {
      const state = getRuntimeState(runtimeId);
      state.error = null;
      state.sessionListError = null;
    }
    if (activeConversation.value) {
      activeConversation.value.error = null;
      getRuntimeState(activeConversation.value.session.runtimeId).error = null;
    }
  }

  async function tryReconnect(): Promise<boolean> {
    const conversation = activeConversation.value;
    if (!conversation || conversation.isHydrating || conversation.isLoading) {
      return false;
    }
    if (!conversation.session.supportsLoadSession) return false;
    if (
      conversation.hydrated &&
      getRuntimeState(conversation.session.runtimeId).status === 'connected'
    ) {
      return false;
    }

    try {
      await loadConversation(conversation.session, true);
    } catch (cause) {
      console.warn('Foreground reconnect failed:', cause);
    }
    return true;
  }

  function isRuntimeConnected(runtimeId: string): boolean {
    return getRuntimeState(runtimeId).status === 'connected';
  }

  function isRuntimeConnecting(runtimeId: string): boolean {
    const status = getRuntimeState(runtimeId).status;
    return status === 'connecting' || status === 'reconnecting';
  }

  function isRuntimeBusy(runtimeId: string): boolean {
    const state = getRuntimeState(runtimeId);
    // UI gating must depend on reactive mirrors. The runtime promise maps are
    // deliberately non-reactive and can otherwise leave buttons stale after
    // a Promise settles; mutation methods still enforce those exact gates.
    return (
      maintenanceRuntimes.has(runtimeId) ||
      state.status === 'connecting' ||
      state.status === 'reconnecting' ||
      state.isRefreshingSessions ||
      state.activePromptKey !== null ||
      pendingPermissions.has(runtimeId) ||
      Array.from(conversations.values()).some(
        (conversation) =>
          conversation.session.runtimeId === runtimeId &&
          (conversation.isLoading || conversation.isHydrating),
      )
    );
  }

  function isRefreshingRuntime(runtimeId: string): boolean {
    return getRuntimeState(runtimeId).isRefreshingSessions;
  }

  function runtimeErrorFor(runtimeId: string): string | null {
    const state = getRuntimeState(runtimeId);
    return state.error ?? state.sessionListError;
  }

  return {
    savedSessions,
    currentSession,
    isConnected,
    isLoading,
    isPrompting,
    isConnecting,
    isReconnecting,
    error,
    pendingPermission,
    pendingPermissionRuntimeId,
    pendingPermissionSessionTitle,
    pendingAuthMethods,
    pendingAuthRuntimeId,
    activeConversationKey,
    openConversations,
    isCurrentRuntimeBusyElsewhere,

    hasActiveSession,
    messageList,
    resumableSessions,

    refreshSessions,
    createSession,
    resumeSession,
    selectConversation,
    deleteConversation,
    sendPrompt,
    cancelOperation,
    resolvePermission,
    cancelPermission,
    selectAuthMethod,
    cancelAuthSelection,
    disconnectRuntime,
    removeRuntime,
    clearError,
    tryReconnect,
    isRuntimeConnected,
    isRuntimeConnecting,
    isRuntimeBusy,
    isRefreshingRuntime,
    runtimeErrorFor,
  };
});
