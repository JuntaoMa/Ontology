// ACP session manager.
//
// OpenCode owns durable sessions and history. This store only keeps the
// conversations that are open in the current page, with one ACP connection
// per Agent Profile and one independent projection per ACP session.
import { defineStore } from 'pinia';
import { computed, reactive, ref, shallowRef, watch } from 'vue';
import type {
  AuthMethod,
  InitializeResponse,
  SessionNotification,
} from '@agentclientprotocol/sdk';
import { deleteProfileSession, getAppVersion } from '../lib/bridge-api';
import {
  type AgentConfig,
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
import { useConfigStore } from './config';

const PROTOCOL_VERSION = 1;

type ProfileConnectionStatus =
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
  agentName: string;
  sessionId: string;
  title: string;
  lastUpdated: number;
  status: OpenConversationStatus;
  statusLabel: string;
  isActive: boolean;
}

interface ProfileState {
  status: ProfileConnectionStatus;
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

interface ProfileRuntime {
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
  agentName: string;
  methods: AuthMethod[];
  resolve: (methodId: string | null) => void;
}

const appVersion = getAppVersion();

function keyOf(agentName: string, sessionId: string): string {
  return `${agentName}:${sessionId}`;
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
  const profileStates = reactive(new Map<string, ProfileState>());
  const activeConversationKey = ref<string | null>(null);
  const pendingPermissions = reactive(new Map<string, PermissionRequest>());
  const authPrompts = shallowRef<AuthPrompt[]>([]);
  const maintenanceProfiles = new Set<string>();

  // ACP clients, promises, timers and unwatch functions must not be wrapped
  // in Vue proxies.
  const runtimes = new Map<string, ProfileRuntime>();
  let openedSequence = 0;

  function getProfileState(agentName: string): ProfileState {
    let state = profileStates.get(agentName);
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
      profileStates.set(agentName, state);
      // Return the Map's reactive proxy, not the raw object that was just
      // inserted. Async mutations on the raw object would otherwise update
      // data without notifying Vue.
      return profileStates.get(agentName) as ProfileState;
    }
    return state;
  }

  function getRuntime(agentName: string): ProfileRuntime {
    let runtime = runtimes.get(agentName);
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
      runtimes.set(agentName, runtime);
    }
    return runtime;
  }

  const activeConversation = computed(() => {
    const key = activeConversationKey.value;
    return key ? conversations.get(key) ?? null : null;
  });

  const activeProfileState = computed(() => {
    const conversation = activeConversation.value;
    return conversation
      ? getProfileState(conversation.session.agentName)
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
    const profile = activeProfileState.value;
    return (
      conversation !== null &&
      conversation.hydrated &&
      profile?.status === 'connected'
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
    () => activeProfileState.value?.status === 'connecting',
  );
  const isReconnecting = computed(() => {
    const conversation = activeConversation.value;
    return Boolean(
      conversation?.isHydrating ||
      activeProfileState.value?.status === 'reconnecting',
    );
  });
  const error = computed(
    () =>
      activeConversation.value?.error ??
      activeProfileState.value?.error ??
      null,
  );
  const resumableSessions = computed(() =>
    savedSessions.value.filter((session) => session.supportsLoadSession === true),
  );
  const isCurrentProfileBusyElsewhere = computed(() => {
    const conversation = activeConversation.value;
    const owner = activeProfileState.value?.activePromptKey;
    return Boolean(conversation && owner && owner !== conversation.key);
  });

  function getPendingPermissionEntry():
    | { agentName: string; request: PermissionRequest }
    | null {
    const conversation = activeConversation.value;
    if (conversation) {
      const request = pendingPermissions.get(conversation.session.agentName);
      if (request?.sessionId === conversation.session.sessionId) {
        return {
          agentName: conversation.session.agentName,
          request,
        };
      }
    }

    for (const [agentName, request] of pendingPermissions) {
      return { agentName, request };
    }
    return null;
  }

  const pendingPermission = computed(
    () => getPendingPermissionEntry()?.request ?? null,
  );
  const pendingPermissionAgentName = computed(
    () => getPendingPermissionEntry()?.agentName ?? '',
  );
  const pendingPermissionSessionTitle = computed(() => {
    const entry = getPendingPermissionEntry();
    if (!entry) return '';
    return (
      conversations.get(keyOf(entry.agentName, entry.request.sessionId))
        ?.session.title ?? entry.request.sessionId
    );
  });
  const pendingAuthMethods = computed(
    () => authPrompts.value[0]?.methods ?? [],
  );
  const pendingAuthAgentName = computed(
    () => authPrompts.value[0]?.agentName ?? '',
  );

  function conversationStatus(
    conversation: ConversationState,
  ): Pick<OpenConversationSummary, 'status' | 'statusLabel'> {
    const permission = pendingPermissions.get(conversation.session.agentName);
    if (permission?.sessionId === conversation.session.sessionId) {
      return { status: 'needs_attention', statusLabel: 'Needs attention' };
    }
    if (conversation.isLoading) {
      return { status: 'running', statusLabel: 'Running' };
    }
    if (conversation.isHydrating) {
      return { status: 'connecting', statusLabel: 'Loading' };
    }

    const profile = getProfileState(conversation.session.agentName);
    if (profile.status === 'connecting') {
      return { status: 'connecting', statusLabel: 'Connecting' };
    }
    if (profile.status === 'reconnecting') {
      return { status: 'reconnecting', statusLabel: 'Reconnecting' };
    }
    if (conversation.error || profile.status === 'error') {
      return { status: 'error', statusLabel: 'Error' };
    }
    if (profile.status === 'connected' && conversation.hydrated) {
      return { status: 'connected', statusLabel: 'Connected' };
    }
    return { status: 'disconnected', statusLabel: 'Disconnected' };
  }

  const openConversations = computed<OpenConversationSummary[]>(() =>
    Array.from(conversations.values())
      .sort((left, right) => right.openedAt - left.openedAt)
      .map((conversation) => ({
        key: conversation.key,
        agentName: conversation.session.agentName,
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
    const key = keyOf(session.agentName, session.sessionId);
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
      id: keyOf(session.agentName, session.sessionId),
    };
    const conversation = conversations.get(normalized.id);
    if (conversation) {
      conversation.session = normalized;
    }
    savedSessions.value = [
      normalized,
      ...savedSessions.value.filter(
        (saved) =>
          saved.agentName !== normalized.agentName ||
          saved.sessionId !== normalized.sessionId,
      ),
    ];
  }

  function replaceSessionsForAgent(
    agentName: string,
    listedSessions: SavedSession[],
  ): void {
    const sessions = listedSessions
      .map((listed) => {
        const key = keyOf(agentName, listed.sessionId);
        const open = conversations.get(key);
        if (!open) return { ...listed, id: key };
        open.session.title = listed.title;
        open.session.lastUpdated = listed.lastUpdated;
        open.session.supportsLoadSession = listed.supportsLoadSession;
        return open.session;
      });
    savedSessions.value = [
      ...savedSessions.value.filter(
        (session) => session.agentName !== agentName,
      ),
      ...sessions,
    ];
  }

  function applySessionUpdate(
    agentName: string,
    conversation: ConversationState,
    notification: SessionNotification,
  ): void {
    if (!applyProjectionUpdate(conversation, notification)) return;
    const saved = savedSessions.value.find(
      (session) =>
        session.agentName === agentName &&
        session.sessionId === notification.sessionId,
    );
    if (saved && saved !== conversation.session) {
      saved.title = conversation.session.title;
      saved.lastUpdated = conversation.session.lastUpdated;
    }
  }

  function handleSessionUpdate(
    agentName: string,
    notification: SessionNotification,
  ): void {
    const conversation = conversations.get(
      keyOf(agentName, notification.sessionId),
    );
    if (conversation) {
      applySessionUpdate(agentName, conversation, notification);
      return;
    }

    // session/new may emit initial updates before its response reveals the
    // new sessionId. Buffer only while a creation request is active.
    const runtime = getRuntime(agentName);
    if (runtime.pendingSessionCreations > 0) {
      const queued = runtime.pendingUpdates.get(notification.sessionId) ?? [];
      if (queued.length < 100) queued.push(notification);
      runtime.pendingUpdates.set(notification.sessionId, queued);
    }
  }

  function drainPendingUpdates(
    agentName: string,
    conversation: ConversationState,
  ): void {
    const runtime = getRuntime(agentName);
    const queued = runtime.pendingUpdates.get(conversation.session.sessionId);
    runtime.pendingUpdates.delete(conversation.session.sessionId);
    if (!queued) return;
    for (const notification of queued) {
      applySessionUpdate(agentName, conversation, notification);
    }
  }

  function handleUnexpectedClose(
    agentName: string,
    client: AcpClientBridge,
    reason?: string,
  ): void {
    const runtime = getRuntime(agentName);
    if (runtime.client !== client) return;

    runtime.stopPermissionWatch?.();
    runtime.stopPermissionWatch = null;
    runtime.client = null;
    pendingPermissions.delete(agentName);

    const state = getProfileState(agentName);
    const expectedMaintenance = maintenanceProfiles.has(agentName);
    state.status = expectedMaintenance ? 'disconnected' : 'error';
    state.error = expectedMaintenance
      ? null
      : `Connection lost: ${reason ?? 'transport closed'}`;
    state.activePromptKey = null;
    state.supportsSessionList = false;

    for (const conversation of conversations.values()) {
      if (conversation.session.agentName !== agentName) continue;
      conversation.hydrated = false;
      conversation.isLoading = false;
      conversation.isHydrating = false;
      conversation.replayingHistory = false;
    }
  }

  function bindClient(
    agentName: string,
    client: AcpClientBridge,
  ): void {
    const runtime = getRuntime(agentName);
    client.onSessionUpdate = (notification) => {
      handleSessionUpdate(agentName, notification);
    };
    client.onTransportClose = (reason) => {
      handleUnexpectedClose(agentName, client, reason);
    };
    runtime.stopPermissionWatch?.();
    runtime.stopPermissionWatch = watch(
      () => client.pendingPermissionRequest.value,
      (request) => {
        if (runtime.client !== client) return;
        if (request) {
          pendingPermissions.set(agentName, request);
        } else {
          pendingPermissions.delete(agentName);
        }
      },
      { immediate: true },
    );
  }

  function unbindClient(
    agentName: string,
    client: AcpClientBridge,
  ): void {
    const runtime = getRuntime(agentName);
    if (runtime.client !== client) return;
    runtime.stopPermissionWatch?.();
    runtime.stopPermissionWatch = null;
    pendingPermissions.delete(agentName);
    client.onSessionUpdate = null;
    client.onTransportClose = null;
  }

  async function connectProfileTransport(
    agentName: string,
    agentConfig: AgentConfig,
  ): Promise<AcpClientBridge> {
    return createAcpClient({ name: agentName, config: agentConfig });
  }

  async function ensureProfileClient(
    agentName: string,
    options: { reconnecting?: boolean; skipDiscovery?: boolean } = {},
  ): Promise<AcpClientBridge> {
    const state = getProfileState(agentName);
    const runtime = getRuntime(agentName);
    if (maintenanceProfiles.has(agentName)) {
      throw new Error(
        'This Profile is undergoing maintenance. Try again in a moment.',
      );
    }
    if (!options.skipDiscovery && runtime.discoveryPromise) {
      await runtime.discoveryPromise;
      if (maintenanceProfiles.has(agentName)) {
        throw new Error(
          'This Profile is undergoing maintenance. Try again in a moment.',
        );
      }
    }
    if (runtime.client && state.status === 'connected') {
      return runtime.client;
    }
    if (runtime.connectPromise) return runtime.connectPromise;

    const configStore = useConfigStore();
    const agentConfig = configStore.getAgent(agentName);
    if (!agentConfig) {
      throw new Error(`Agent '${agentName}' not found in catalog`);
    }
    if (agentConfig.status === 'unavailable') {
      throw new Error(
        'This Agent Profile is unavailable until its required environment is configured',
      );
    }
    if (!agentConfig.cwd) {
      throw new Error(`Agent '${agentName}' has no fixed working directory`);
    }
    if (!agentConfig.url) {
      throw new Error(`Agent '${agentName}' has no Bridge WebSocket URL`);
    }

    state.status = options.reconnecting ? 'reconnecting' : 'connecting';
    state.error = null;

    const promise = (async (): Promise<AcpClientBridge> => {
      let client: AcpClientBridge | null = null;
      try {
        client = await connectProfileTransport(agentName, agentConfig);
        if (maintenanceProfiles.has(agentName)) {
          await client.disconnect();
          client = null;
          throw new Error('Profile entered maintenance while connecting');
        }

        runtime.client = client;
        bindClient(agentName, client);
        const response = await initializeClient(client);

        if (
          runtime.client !== client ||
          maintenanceProfiles.has(agentName)
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
              unbindClient(agentName, client);
              runtime.client = null;
            }
            await client.disconnect();
          } catch (cleanupError) {
            console.warn(
              'disconnect during profile connection cleanup failed:',
              cleanupError,
            );
          }
        }

        state.status = maintenanceProfiles.has(agentName)
          ? 'disconnected'
          : 'error';
        state.error = maintenanceProfiles.has(agentName)
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
    agentName: string,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      authPrompts.value = [
        ...authPrompts.value,
        {
          id: crypto.randomUUID(),
          agentName,
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

  function cancelAuthForProfile(agentName: string): void {
    const cancelled = authPrompts.value.filter(
      (prompt) => prompt.agentName === agentName,
    );
    if (cancelled.length === 0) return;
    authPrompts.value = authPrompts.value.filter(
      (prompt) => prompt.agentName !== agentName,
    );
    for (const prompt of cancelled) prompt.resolve(null);
  }

  async function withAuthentication<T>(
    agentName: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (cause) {
      const runtime = getRuntime(agentName);
      if (!isAuthRequired(cause) || runtime.authMethods.length === 0) {
        throw cause;
      }

      const methodId = await promptForAuthMethod(
        runtime.authMethods,
        agentName,
      );
      if (!methodId) throw new Error('Authentication cancelled by user');
      const client = runtime.client;
      if (!client) throw new Error('Agent connection closed during authentication');
      await client.authenticate({ methodId });
      return operation();
    }
  }

  function refreshSessions(agentName: string): Promise<void> {
    const runtime = getRuntime(agentName);
    if (runtime.discoveryPromise) return runtime.discoveryPromise;
    if (maintenanceProfiles.has(agentName)) {
      return Promise.resolve();
    }

    const discovery = performSessionRefresh(agentName);
    runtime.discoveryPromise = discovery;
    void discovery.finally(() => {
      if (runtime.discoveryPromise === discovery) {
        runtime.discoveryPromise = null;
      }
    });
    return discovery;
  }

  async function performSessionRefresh(agentName: string): Promise<void> {
    const state = getProfileState(agentName);
    const generation = ++state.listGeneration;
    state.isRefreshingSessions = true;
    state.sessionListError = null;

    let client: AcpClientBridge | null = null;
    let ownsClient = false;
    try {
      const configStore = useConfigStore();
      const agentConfig = configStore.getAgent(agentName);
      if (!agentConfig) {
        throw new Error(`Agent '${agentName}' not found in catalog`);
      }
      if (agentConfig.status === 'unavailable') {
        throw new Error(
          'This Agent Profile is unavailable until its required environment is configured',
        );
      }
      if (!agentConfig.cwd) {
        throw new Error(`Agent '${agentName}' has no fixed working directory`);
      }

      const runtime = getRuntime(agentName);
      if (runtime.client || runtime.connectPromise) {
        client = await ensureProfileClient(agentName, {
          skipDiscovery: true,
        });
      } else {
        client = await connectProfileTransport(agentName, agentConfig);
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
          replaceSessionsForAgent(agentName, []);
          state.sessionListError =
            'This Agent does not advertise ACP session/list and session/load.';
        }
        return;
      }

      const listed: SavedSession[] = [];
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < 100; page += 1) {
        const response = await client.unstable_listSessions({
          cwd: agentConfig.cwd,
          cursor,
        });
        for (const session of response.sessions) {
          if (session.cwd !== agentConfig.cwd) continue;
          const parsedUpdatedAt = session.updatedAt
            ? Date.parse(session.updatedAt)
            : Number.NaN;
          listed.push({
            id: keyOf(agentName, session.sessionId),
            agentName,
            sessionId: session.sessionId,
            title: session.title?.trim() || 'Untitled session',
            lastUpdated: Number.isFinite(parsedUpdatedAt)
              ? parsedUpdatedAt
              : 0,
            cwd: agentConfig.cwd,
            supportsLoadSession: true,
          });
        }

        const nextCursor = response.nextCursor ?? undefined;
        if (!nextCursor) break;
        if (seenCursors.has(nextCursor)) {
          throw new Error('Agent returned a repeated session/list cursor');
        }
        seenCursors.add(nextCursor);
        cursor = nextCursor;
        if (page === 99) {
          throw new Error('Agent session/list exceeded 100 pages');
        }
      }

      if (generation === state.listGeneration) {
        replaceSessionsForAgent(agentName, listed);
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
    agentName: string,
    cwd: string,
    options: { activate?: boolean } = {},
  ): Promise<string> {
    if (maintenanceProfiles.has(agentName)) {
      throw new Error(
        'This Profile is undergoing maintenance. Try again in a moment.',
      );
    }
    const configStore = useConfigStore();
    const agentConfig = configStore.getAgent(agentName);
    if (!agentConfig) throw new Error(`Agent '${agentName}' not found in catalog`);
    if (!agentConfig.cwd || cwd !== agentConfig.cwd) {
      throw new Error(
        'Session working directory does not match its Agent Profile',
      );
    }

    const state = getProfileState(agentName);
    const runtime = getRuntime(agentName);
    const client = await ensureProfileClient(agentName);
    runtime.pendingSessionCreations += 1;
    try {
      const response = await withAuthentication(agentName, () =>
        client.newSession({
          cwd,
          mcpServers: [],
        }),
      );
      const session: SavedSession = {
        id: keyOf(agentName, response.sessionId),
        agentName,
        sessionId: response.sessionId,
        title: `Session ${new Date().toLocaleString()}`,
        lastUpdated: Date.now(),
        cwd,
        supportsLoadSession: state.supportsLoadSession,
      };
      const conversation = createConversation(session);
      conversation.hydrated = true;
      conversation.error = null;
      drainPendingUpdates(agentName, conversation);
      saveSession(session);
      if (options.activate !== false) {
        activeConversationKey.value = conversation.key;
      }
      return conversation.key;
    } catch (cause) {
      state.error = cause instanceof Error ? cause.message : String(cause);
      const profileHasConversation = Array.from(conversations.values()).some(
        (conversation) => conversation.session.agentName === agentName,
      );
      if (
        !profileHasConversation &&
        runtime.pendingSessionCreations === 1 &&
        runtime.client === client
      ) {
        unbindClient(agentName, client);
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
    if (maintenanceProfiles.has(savedSession.agentName)) {
      throw new Error(
        'This Profile is undergoing maintenance. Try again in a moment.',
      );
    }
    const key = keyOf(savedSession.agentName, savedSession.sessionId);
    let conversation = conversations.get(key);
    if (!conversation) {
      conversation = createConversation({
        ...savedSession,
        id: key,
      });
    }
    activeConversationKey.value = key;

    const state = getProfileState(savedSession.agentName);
    const runtime = getRuntime(savedSession.agentName);
    if (
      state.activePromptKey &&
      state.activePromptKey !== conversation.key
    ) {
      const message =
        'This Profile is running another conversation. Wait for that turn to finish before loading this session.';
      conversation.error = message;
      throw new Error(message);
    }

    const configStore = useConfigStore();
    const agentConfig = configStore.getAgent(savedSession.agentName);
    if (!agentConfig) {
      throw new Error(
        `Agent '${savedSession.agentName}' not found in catalog`,
      );
    }
    if (!agentConfig.cwd || savedSession.cwd !== agentConfig.cwd) {
      throw new Error(
        'Session working directory does not match its Agent Profile',
      );
    }

    const previousProjection = snapshotProjection(conversation);
    conversation.error = null;
    conversation.isHydrating = true;
    let client: AcpClientBridge | null = null;
    try {
      const activeClient = await ensureProfileClient(savedSession.agentName, {
        reconnecting,
      });
      client = activeClient;
      if (!state.supportsLoadSession) {
        throw new Error('This Agent does not advertise ACP session/load');
      }

      conversation.messages.splice(0);
      conversation.replayingHistory = true;
      conversation.replayLastUpdateAt = Date.now();

      await withAuthentication(savedSession.agentName, () =>
        activeClient.loadSession({
          sessionId: savedSession.sessionId,
          cwd: agentConfig.cwd as string,
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
      // history load; unexpected closes are reported at Profile level.
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
      // Keep the runtime alive; another Session on this Profile may already
      // be using the same ACP connection.
      void runtime;
    }
  }

  function loadConversation(
    savedSession: SavedSession,
    reconnecting = false,
  ): Promise<string> {
    const key = keyOf(savedSession.agentName, savedSession.sessionId);
    const runtime = getRuntime(savedSession.agentName);
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
    const key = keyOf(savedSession.agentName, savedSession.sessionId);
    const existing = conversations.get(key);
    const state = getProfileState(savedSession.agentName);
    const runtime = getRuntime(savedSession.agentName);
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

    const agentName = conversation.session.agentName;
    const state = getProfileState(agentName);
    const client = getRuntime(agentName).client;
    if (!client || state.status !== 'connected' || !conversation.hydrated) {
      throw new Error('The current conversation is not connected');
    }
    if (state.activePromptKey && state.activePromptKey !== key) {
      const message =
        'This Profile is already running another conversation. Switch to it or wait for that turn to finish.';
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
      // disconnectProfile() unbinds and clears the runtime client before
      // closing it. The rejected Prompt still reaches this catch, but an
      // intentional disconnect should not leave a red transport error.
      if (getRuntime(agentName).client === client) {
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
    agentName: string,
    sessionId: string,
  ): Promise<void> {
    const key = keyOf(agentName, sessionId);
    const permission = pendingPermissions.get(agentName);
    const runtime = getRuntime(agentName);
    const profile = getProfileState(agentName);
    const profileConversationBusy = Array.from(conversations.values()).some(
      (candidate) =>
        candidate.session.agentName === agentName &&
        (candidate.isLoading || candidate.isHydrating),
    );
    if (
      maintenanceProfiles.has(agentName) ||
      profileConversationBusy ||
      permission !== undefined ||
      profile.activePromptKey !== null ||
      runtime.pendingSessionCreations > 0 ||
      runtime.pendingLoads.size > 0 ||
      runtime.connectPromise !== null ||
      runtime.discoveryPromise !== null ||
      profile.isRefreshingSessions ||
      profile.status === 'connecting' ||
      profile.status === 'reconnecting'
    ) {
      throw new Error(
        'This Profile is still running and cannot delete a conversation',
      );
    }

    const wasConnected =
      runtime.client !== null && profile.status === 'connected';
    const activeBefore = activeConversationKey.value;
    maintenanceProfiles.add(agentName);
    if (wasConnected) {
      // Make the server-initiated Profile close expected from the browser's
      // perspective. The durable delete requires OpenCode's in-memory cache
      // to be gone before its CLI touches the isolated database.
      await disconnectProfile(agentName);
    }

    let durableDeleted = false;
    try {
      await deleteProfileSession(agentName, sessionId);
      durableDeleted = true;
      // Invalidate only a session/list response that began before the durable
      // delete. A later authoritative list must be allowed to expose any
      // unexpected reappearance rather than being hidden by a tombstone.
      profile.listGeneration += 1;
      profile.isRefreshingSessions = false;
      savedSessions.value = savedSessions.value.filter(
        (saved) =>
          saved.agentName !== agentName || saved.sessionId !== sessionId,
      );
      conversations.delete(key);

      if (activeConversationKey.value === key) {
        const fallback = Array.from(conversations.values()).sort(
          (left, right) => right.openedAt - left.openedAt,
        )[0];
        activeConversationKey.value = fallback?.key ?? null;
      }
      if (pendingPermissions.get(agentName)?.sessionId === sessionId) {
        pendingPermissions.delete(agentName);
      }
    } finally {
      maintenanceProfiles.delete(agentName);
      if (wasConnected) {
        const preferredKey = durableDeleted
          ? activeConversationKey.value
          : activeBefore;
        const reconnectConversation =
          (preferredKey
            ? conversations.get(preferredKey)
            : undefined)?.session.agentName === agentName
            ? conversations.get(preferredKey as string)
            : Array.from(conversations.values())
                .filter(
                  (candidate) =>
                    candidate.session.agentName === agentName &&
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
              'Profile reconnect after Session maintenance failed:',
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
    const client = getRuntime(conversation.session.agentName).client;
    if (!client) return;
    await client.cancel({
      sessionId: conversation.session.sessionId,
    });
  }

  function resolvePermission(optionId: string): void {
    const entry = getPendingPermissionEntry();
    if (!entry) return;
    getRuntime(entry.agentName).client?.resolvePermission(optionId);
  }

  function cancelPermission(): void {
    const entry = getPendingPermissionEntry();
    if (!entry) return;
    getRuntime(entry.agentName).client?.cancelPermission();
  }

  async function disconnectProfile(agentName: string): Promise<void> {
    const runtime = getRuntime(agentName);
    const state = getProfileState(agentName);
    cancelAuthForProfile(agentName);

    const client = runtime.client;
    if (client) {
      unbindClient(agentName, client);
      runtime.client = null;
      await client.disconnect().catch((cause) => {
        console.error('Error disconnecting:', cause);
      });
    }
    state.status = 'disconnected';
    state.error = null;
    state.activePromptKey = null;
    state.supportsSessionList = false;
    pendingPermissions.delete(agentName);
    runtime.pendingUpdates.clear();

    for (const conversation of conversations.values()) {
      if (conversation.session.agentName !== agentName) continue;
      conversation.hydrated = false;
      conversation.isLoading = false;
      conversation.isHydrating = false;
      conversation.replayingHistory = false;
      conversation.error = null;
    }
  }

  function clearError(agentName?: string): void {
    if (agentName) {
      const state = getProfileState(agentName);
      state.error = null;
      state.sessionListError = null;
    }
    if (activeConversation.value) {
      activeConversation.value.error = null;
      getProfileState(activeConversation.value.session.agentName).error = null;
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
      getProfileState(conversation.session.agentName).status === 'connected'
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

  function isProfileConnected(agentName: string): boolean {
    return getProfileState(agentName).status === 'connected';
  }

  function isProfileConnecting(agentName: string): boolean {
    const status = getProfileState(agentName).status;
    return status === 'connecting' || status === 'reconnecting';
  }

  function isProfileBusy(agentName: string): boolean {
    const state = getProfileState(agentName);
    // UI gating must depend on reactive mirrors. The runtime promise maps are
    // deliberately non-reactive and can otherwise leave buttons stale after
    // a Promise settles; mutation methods still enforce those exact gates.
    return (
      maintenanceProfiles.has(agentName) ||
      state.status === 'connecting' ||
      state.status === 'reconnecting' ||
      state.isRefreshingSessions ||
      state.activePromptKey !== null ||
      pendingPermissions.has(agentName) ||
      Array.from(conversations.values()).some(
        (conversation) =>
          conversation.session.agentName === agentName &&
          (conversation.isLoading || conversation.isHydrating),
      )
    );
  }

  function isRefreshingAgent(agentName: string): boolean {
    return getProfileState(agentName).isRefreshingSessions;
  }

  function profileErrorFor(agentName: string): string | null {
    const state = getProfileState(agentName);
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
    pendingPermissionAgentName,
    pendingPermissionSessionTitle,
    pendingAuthMethods,
    pendingAuthAgentName,
    activeConversationKey,
    openConversations,
    isCurrentProfileBusyElsewhere,

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
    disconnectProfile,
    clearError,
    tryReconnect,
    isProfileConnected,
    isProfileConnecting,
    isProfileBusy,
    isRefreshingAgent,
    profileErrorFor,
  };
});
