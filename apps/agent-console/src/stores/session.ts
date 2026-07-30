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
import { deleteProfileSession, getAppVersion } from '../lib/host';
import {
  getTransportKind,
  type AgentConfig,
  type ChatMessage,
  type ModelInfo,
  type PermissionRequest,
  type SavedSession,
  type SessionMode,
  type SlashCommand,
  type ToolCallInfo,
} from '../lib/types';
import { applyToolCallUpdate, createToolCallInfo } from '../lib/tool-call';
import { createAcpClient, type AcpClientBridge } from '../lib/acp-bridge';
import { killAgent, onAgentStderr, spawnAgent } from '../lib/host';
import { isDesktop } from '../lib/platform';
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
  profileId: string;
  status: ProfileConnectionStatus;
  error: string | null;
  supportsSessionList: boolean;
  supportsLoadSession: boolean;
  activePromptKey: string | null;
  startupPhase: string;
  startupLogs: string[];
  startupElapsed: number;
  isRefreshingSessions: boolean;
  sessionListError: string | null;
  listGeneration: number;
}

interface ConversationState {
  key: string;
  session: SavedSession;
  messages: ChatMessage[];
  toolCalls: Map<string, ToolCallInfo>;
  isLoading: boolean;
  isHydrating: boolean;
  hydrated: boolean;
  replayingHistory: boolean;
  replayLastUpdateAt: number;
  error: string | null;
  availableModes: SessionMode[];
  currentModeId: string;
  availableCommands: SlashCommand[];
  availableModels: ModelInfo[];
  currentModelId: string;
  openedAt: number;
}

interface ConnectionAttempt {
  cancelled: boolean;
  client: AcpClientBridge | null;
  spawnedAgentId?: string;
}

interface ProfileRuntime {
  client: AcpClientBridge | null;
  connectPromise: Promise<AcpClientBridge> | null;
  pendingLoads: Map<string, Promise<string>>;
  connectionAttempt: ConnectionAttempt | null;
  stopPermissionWatch: (() => void) | null;
  startupTimer: ReturnType<typeof setInterval> | null;
  stderrUnlisten: (() => void) | null;
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

interface SessionSetupMetadata {
  modes?: {
    availableModes?: Array<{
      id: string;
      name: string;
      description?: string | null;
    }>;
    currentModeId?: string;
  } | null;
  models?: {
    availableModels?: Array<{
      modelId: string;
      name: string;
      description?: string | null;
    }>;
    currentModelId?: string;
  } | null;
}

let appVersion = '0.1.0';

function keyOf(agentName: string, sessionId: string): string {
  return `${agentName}:${sessionId}`;
}

function monotonicNow(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function detectPhase(line: string): string | null {
  const lower = line.toLowerCase();
  if (lower.includes('download') || lower.includes('fetch') || lower.includes('get ')) {
    return 'downloading';
  }
  if (lower.includes('install') || lower.includes('added') || lower.includes('packages')) {
    return 'installing';
  }
  if (lower.includes('build') || lower.includes('compil')) {
    return 'building';
  }
  if (lower.includes('start') || lower.includes('spawn')) {
    return 'starting';
  }
  return null;
}

function isAuthRequired(cause: unknown): boolean {
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
  const globalError = ref<string | null>(null);
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
        profileId: agentName,
        status: 'disconnected',
        error: null,
        supportsSessionList: false,
        supportsLoadSession: false,
        activePromptKey: null,
        startupPhase: 'starting',
        startupLogs: [],
        startupElapsed: 0,
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
        pendingLoads: new Map(),
        connectionAttempt: null,
        stopPermissionWatch: null,
        startupTimer: null,
        stderrUnlisten: null,
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
  const messages = computed(
    () => activeConversation.value?.messages ?? [],
  );
  const messageList = computed(() => messages.value);
  const toolCallList = computed(() =>
    activeConversation.value
      ? Array.from(activeConversation.value.toolCalls.values())
      : [],
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
      globalError.value,
  );
  const availableModes = computed(
    () => activeConversation.value?.availableModes ?? [],
  );
  const currentModeId = computed(
    () => activeConversation.value?.currentModeId ?? '',
  );
  const availableCommands = computed(
    () => activeConversation.value?.availableCommands ?? [],
  );
  const availableModels = computed(
    () => activeConversation.value?.availableModels ?? [],
  );
  const currentModelId = computed(
    () => activeConversation.value?.currentModelId ?? '',
  );
  const startupPhase = computed(
    () => activeProfileState.value?.startupPhase ?? 'starting',
  );
  const startupLogs = computed(
    () => activeProfileState.value?.startupLogs ?? [],
  );
  const startupElapsed = computed(
    () => activeProfileState.value?.startupElapsed ?? 0,
  );
  const resumableSessions = computed(() =>
    savedSessions.value.filter((session) => session.supportsLoadSession === true),
  );
  const isRefreshingSessions = computed(() =>
    Array.from(profileStates.values()).some(
      (state) => state.isRefreshingSessions,
    ),
  );
  const sessionListError = computed(() => {
    for (const state of profileStates.values()) {
      if (state.sessionListError) return state.sessionListError;
    }
    return null;
  });
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

  async function initStore(): Promise<void> {
    try {
      appVersion = await getAppVersion();
    } catch (cause) {
      console.warn('Failed to get app version:', cause);
    }
  }

  function initializeClient(
    client: AcpClientBridge,
  ): Promise<InitializeResponse> {
    const canAccessFs = isDesktop();
    return client.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        fs: {
          readTextFile: canAccessFs,
          writeTextFile: canAccessFs,
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
      toolCalls: new Map(),
      isLoading: false,
      isHydrating: false,
      hydrated: false,
      replayingHistory: false,
      replayLastUpdateAt: 0,
      error: null,
      availableModes: [],
      currentModeId: '',
      availableCommands: [],
      availableModels: [],
      currentModelId: '',
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

  function applySetupMetadata(
    conversation: ConversationState,
    response: unknown,
  ): void {
    const metadata = response as SessionSetupMetadata;
    if (metadata.modes) {
      conversation.availableModes = (
        metadata.modes.availableModes ?? []
      ).map((mode) => ({
        id: mode.id,
        name: mode.name,
        description: mode.description ?? undefined,
      }));
      conversation.currentModeId = metadata.modes.currentModeId ?? '';
    }
    if (metadata.models) {
      conversation.availableModels = (
        metadata.models.availableModels ?? []
      ).map((model) => ({
        modelId: model.modelId,
        name: model.name,
        description: model.description ?? undefined,
      }));
      conversation.currentModelId = metadata.models.currentModelId ?? '';
    }
  }

  function ensureAssistantMessageForToolCall(
    conversation: ConversationState,
  ): ChatMessage {
    const lastMessage =
      conversation.messages[conversation.messages.length - 1];
    if (lastMessage?.role === 'assistant') {
      lastMessage.toolCalls ??= [];
      return lastMessage;
    }

    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: conversation.replayingHistory ? undefined : Date.now(),
      toolCalls: [],
    };
    conversation.messages.push(assistantMessage);
    return assistantMessage;
  }

  function attachToolCall(
    conversation: ConversationState,
    toolCall: ToolCallInfo,
  ): void {
    const assistantMessage = ensureAssistantMessageForToolCall(conversation);
    assistantMessage.toolCalls ??= [];
    if (
      !assistantMessage.toolCalls.some(
        (item) => item.toolCallId === toolCall.toolCallId,
      )
    ) {
      assistantMessage.toolCalls.push(toolCall);
    }
  }

  function applySessionUpdate(
    agentName: string,
    conversation: ConversationState,
    notification: SessionNotification,
  ): void {
    if (conversation.replayingHistory) {
      conversation.replayLastUpdateAt = Date.now();
    }
    const update = notification.update;

    switch (update.sessionUpdate) {
      case 'user_message_chunk': {
        const lastMessage =
          conversation.messages[conversation.messages.length - 1];
        if (lastMessage?.role === 'user') {
          if (update.content.type === 'text') {
            lastMessage.content += update.content.text;
          }
        } else {
          conversation.messages.push({
            id: crypto.randomUUID(),
            role: 'user',
            content:
              update.content.type === 'text' ? update.content.text : '',
            timestamp: conversation.replayingHistory
              ? undefined
              : Date.now(),
          });
        }
        break;
      }

      case 'agent_message_chunk': {
        const lastMessage =
          conversation.messages[conversation.messages.length - 1];
        if (lastMessage?.role === 'assistant') {
          if (update.content.type === 'text') {
            lastMessage.content += update.content.text;
          }
        } else {
          conversation.messages.push({
            id: crypto.randomUUID(),
            role: 'assistant',
            content:
              update.content.type === 'text' ? update.content.text : '',
            timestamp: conversation.replayingHistory
              ? undefined
              : Date.now(),
            toolCalls: [],
          });
        }
        break;
      }

      case 'agent_thought_chunk': {
        const lastMessage =
          conversation.messages[conversation.messages.length - 1];
        if (lastMessage?.role === 'assistant') {
          if (update.content.type === 'text') {
            lastMessage.thought =
              (lastMessage.thought ?? '') + update.content.text;
          }
        } else {
          conversation.messages.push({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: '',
            thought:
              update.content.type === 'text' ? update.content.text : '',
            timestamp: conversation.replayingHistory
              ? undefined
              : Date.now(),
            toolCalls: [],
          });
        }
        break;
      }

      case 'plan': {
        const assistantMessage =
          ensureAssistantMessageForToolCall(conversation);
        assistantMessage.plan = update.entries.map((entry) => ({ ...entry }));
        break;
      }

      case 'tool_call': {
        const observedAt = conversation.replayingHistory ? null : Date.now();
        const existing = conversation.toolCalls.get(update.toolCallId);
        const toolCall = existing
          ? applyToolCallUpdate(existing, update, observedAt)
          : createToolCallInfo(update, observedAt);
        conversation.toolCalls.set(update.toolCallId, toolCall);
        attachToolCall(conversation, toolCall);
        break;
      }

      case 'tool_call_update': {
        const observedAt = conversation.replayingHistory ? null : Date.now();
        const existing = conversation.toolCalls.get(update.toolCallId);
        const toolCall = existing
          ? applyToolCallUpdate(existing, update, observedAt)
          : createToolCallInfo(update, observedAt);
        conversation.toolCalls.set(update.toolCallId, toolCall);
        attachToolCall(conversation, toolCall);

        for (const message of conversation.messages) {
          const attached = message.toolCalls?.find(
            (item) => item.toolCallId === update.toolCallId,
          );
          if (attached && attached !== toolCall) {
            applyToolCallUpdate(attached, update, observedAt);
          }
        }
        break;
      }

      case 'current_mode_update':
        if ('modeId' in update && update.modeId) {
          conversation.currentModeId = update.modeId as string;
        }
        break;

      case 'available_commands_update':
        if (
          'availableCommands' in update &&
          Array.isArray(update.availableCommands)
        ) {
          conversation.availableCommands = update.availableCommands.map(
            (command) => ({
              name: command.name,
              description: command.description,
              hint: command.input?.hint ?? undefined,
            }),
          );
        }
        break;

      case 'session_info_update': {
        if ('title' in update && update.title !== undefined) {
          conversation.session.title =
            update.title?.trim() || 'Untitled session';
        }
        if ('updatedAt' in update && update.updatedAt) {
          const parsed = Date.parse(update.updatedAt);
          if (Number.isFinite(parsed)) {
            conversation.session.lastUpdated = parsed;
          }
        }
        const saved = savedSessions.value.find(
          (session) =>
            session.agentName === agentName &&
            session.sessionId === notification.sessionId,
        );
        if (saved && saved !== conversation.session) {
          saved.title = conversation.session.title;
          saved.lastUpdated = conversation.session.lastUpdated;
        }
        break;
      }

      default:
        // Unknown events remain visible in ACP Traffic.
        break;
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
    shouldStop: () => boolean,
  ): Promise<AcpClientBridge> {
    const delays =
      getTransportKind(agentConfig) === 'websocket'
        ? [0, 100, 200, 400, 800]
        : [0];
    let lastError: unknown;
    for (const delayMs of delays) {
      if (shouldStop()) throw new Error('Connection cancelled');
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
      if (shouldStop()) throw new Error('Connection cancelled');
      try {
        return await createAcpClient(
          { name: agentName, config: agentConfig },
          { profileId: agentName },
        );
      } catch (cause) {
        lastError = cause;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Unable to connect to the Agent');
  }

  function startStartupProgress(
    state: ProfileState,
    runtime: ProfileRuntime,
  ): void {
    state.startupPhase = 'starting';
    state.startupLogs = [];
    state.startupElapsed = 0;
    if (runtime.startupTimer) clearInterval(runtime.startupTimer);
    runtime.startupTimer = setInterval(() => {
      state.startupElapsed += 1;
    }, 1000);
  }

  function stopStartupProgress(runtime: ProfileRuntime): void {
    if (runtime.startupTimer) {
      clearInterval(runtime.startupTimer);
      runtime.startupTimer = null;
    }
    runtime.stderrUnlisten?.();
    runtime.stderrUnlisten = null;
  }

  async function ensureProfileClient(
    agentName: string,
    options: { reconnecting?: boolean } = {},
  ): Promise<AcpClientBridge> {
    const state = getProfileState(agentName);
    const runtime = getRuntime(agentName);
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

    const attempt: ConnectionAttempt = { cancelled: false, client: null };
    runtime.connectionAttempt = attempt;
    state.status = options.reconnecting ? 'reconnecting' : 'connecting';
    state.error = null;
    startStartupProgress(state, runtime);

    const promise = (async (): Promise<AcpClientBridge> => {
      let spawnedInstance: { id: string } | null = null;
      try {
        const transportKind = getTransportKind(agentConfig);
        let client: AcpClientBridge;

        if (transportKind === 'stdio') {
          state.startupPhase = 'starting';
          const agentInstance = await spawnAgent(agentName);
          spawnedInstance = agentInstance;
          attempt.spawnedAgentId = agentInstance.id;

          runtime.stderrUnlisten = (await onAgentStderr((stderr) => {
            if (stderr.agent_id !== agentInstance.id) return;
            state.startupLogs.push(stderr.line);
            const phase = detectPhase(stderr.line);
            if (phase) state.startupPhase = phase;
          })) as unknown as () => void;

          if (attempt.cancelled || runtime.connectionAttempt !== attempt) {
            await killAgent(agentInstance.id).catch(() => undefined);
            spawnedInstance = null;
            attempt.spawnedAgentId = undefined;
            throw new Error('Connection cancelled');
          }

          state.startupPhase = 'initializing';
          client = await createAcpClient(agentInstance, {
            profileId: agentName,
          });
          spawnedInstance = null;
          attempt.spawnedAgentId = undefined;
        } else {
          state.startupPhase = 'connecting';
          client = await connectProfileTransport(
            agentName,
            agentConfig,
            () =>
              attempt.cancelled ||
              runtime.connectionAttempt !== attempt,
          );
        }

        attempt.client = client;
        if (attempt.cancelled || runtime.connectionAttempt !== attempt) {
          await client.disconnect();
          throw new Error('Connection cancelled');
        }

        runtime.client = client;
        bindClient(agentName, client);
        state.startupPhase = 'initializing';
        const response = await initializeClient(client);

        if (
          attempt.cancelled ||
          runtime.connectionAttempt !== attempt ||
          runtime.client !== client
        ) {
          throw new Error('Connection cancelled');
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
        if (attempt.client) {
          try {
            if (runtime.client === attempt.client) {
              unbindClient(agentName, attempt.client);
              runtime.client = null;
            }
            await attempt.client.disconnect();
          } catch (cleanupError) {
            console.warn(
              'disconnect during profile connection cleanup failed:',
              cleanupError,
            );
          }
        } else if (spawnedInstance) {
          await killAgent(spawnedInstance.id).catch(() => undefined);
        }

        state.status = attempt.cancelled ? 'disconnected' : 'error';
        state.error = attempt.cancelled
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
      if (runtime.connectionAttempt === attempt) {
        runtime.connectionAttempt = null;
      }
      stopStartupProgress(runtime);
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

  async function refreshSessions(agentName: string): Promise<void> {
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
        client = await ensureProfileClient(agentName);
      } else {
        client = await connectProfileTransport(
          agentName,
          agentConfig,
          () => generation !== state.listGeneration,
        );
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
        replaceSessionsForAgent(agentName, []);
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
    globalError.value = null;
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
      applySetupMetadata(conversation, response);
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

    const previousProjection = {
      messages: [...conversation.messages],
      toolCalls: new Map(conversation.toolCalls),
      availableModes: [...conversation.availableModes],
      currentModeId: conversation.currentModeId,
      availableCommands: [...conversation.availableCommands],
      availableModels: [...conversation.availableModels],
      currentModelId: conversation.currentModelId,
      title: conversation.session.title,
      lastUpdated: conversation.session.lastUpdated,
    };
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
      conversation.toolCalls.clear();
      conversation.availableCommands = [];
      conversation.replayingHistory = true;
      conversation.replayLastUpdateAt = Date.now();

      const response = await withAuthentication(savedSession.agentName, () =>
        activeClient.loadSession({
          sessionId: savedSession.sessionId,
          cwd: agentConfig.cwd as string,
          mcpServers: [],
        }),
      );
      await waitForReplayQuiescence(conversation);
      applySetupMetadata(conversation, response);
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
      conversation.messages.splice(
        0,
        conversation.messages.length,
        ...previousProjection.messages,
      );
      conversation.toolCalls.clear();
      for (const [toolCallId, toolCall] of previousProjection.toolCalls) {
        conversation.toolCalls.set(toolCallId, toolCall);
      }
      conversation.availableModes = previousProjection.availableModes;
      conversation.currentModeId = previousProjection.currentModeId;
      conversation.availableCommands = previousProjection.availableCommands;
      conversation.availableModels = previousProjection.availableModels;
      conversation.currentModelId = previousProjection.currentModelId;
      conversation.session.title = previousProjection.title;
      conversation.session.lastUpdated = previousProjection.lastUpdated;
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
    globalError.value = null;
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
      runtime.pendingSessionCreations > 0
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
      globalError.value = null;
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

  async function cancelConnection(agentName?: string): Promise<void> {
    const resolvedAgentName =
      agentName || activeConversation.value?.session.agentName;
    if (!resolvedAgentName) return;
    const state = getProfileState(resolvedAgentName);
    const runtime = getRuntime(resolvedAgentName);
    const attempt = runtime.connectionAttempt;
    if (!attempt) return;

    attempt.cancelled = true;
    state.startupPhase = 'cancelling';
    state.error = null;
    cancelAuthForProfile(resolvedAgentName);

    if (attempt.client) {
      try {
        if (runtime.client === attempt.client) {
          unbindClient(resolvedAgentName, attempt.client);
          runtime.client = null;
        }
        await attempt.client.disconnect();
      } catch (cause) {
        console.error('Error disconnecting:', cause);
      }
    }
    if (attempt.spawnedAgentId) {
      await killAgent(attempt.spawnedAgentId).catch(() => undefined);
    }
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

  async function disconnect(): Promise<void> {
    const agentName = activeConversation.value?.session.agentName;
    if (agentName) await disconnectProfile(agentName);
  }

  async function disconnectAll(): Promise<void> {
    await Promise.all(
      Array.from(runtimes.keys()).map((agentName) =>
        disconnectProfile(agentName),
      ),
    );
  }

  async function setMode(modeId: string): Promise<void> {
    const conversation = activeConversation.value;
    if (!conversation) throw new Error('No active session');
    const client = getRuntime(conversation.session.agentName).client;
    if (!client) throw new Error('No active session');
    await client.setMode({
      sessionId: conversation.session.sessionId,
      modeId,
    });
    conversation.currentModeId = modeId;
  }

  async function setModel(modelId: string): Promise<void> {
    const conversation = activeConversation.value;
    if (!conversation) throw new Error('No active session');
    const client = getRuntime(conversation.session.agentName).client;
    if (!client) throw new Error('No active session');
    await client.unstable_setSessionModel({
      sessionId: conversation.session.sessionId,
      modelId,
    });
    conversation.currentModelId = modelId;
  }

  function clearError(agentName?: string): void {
    globalError.value = null;
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

  function setError(message: string): void {
    globalError.value = message;
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
    const runtime = getRuntime(agentName);
    return (
      maintenanceProfiles.has(agentName) ||
      state.activePromptKey !== null ||
      pendingPermissions.has(agentName) ||
      runtime.pendingSessionCreations > 0 ||
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

  function sessionListErrorFor(agentName: string): string | null {
    return getProfileState(agentName).sessionListError;
  }

  function profileErrorFor(agentName: string): string | null {
    return getProfileState(agentName).error;
  }

  function startupPhaseFor(agentName: string): string {
    return getProfileState(agentName).startupPhase;
  }

  function startupLogsFor(agentName: string): string[] {
    return getProfileState(agentName).startupLogs;
  }

  function startupElapsedFor(agentName: string): number {
    return getProfileState(agentName).startupElapsed;
  }

  function isSessionOpen(agentName: string, sessionId: string): boolean {
    return conversations.has(keyOf(agentName, sessionId));
  }

  function isSessionActive(agentName: string, sessionId: string): boolean {
    return activeConversationKey.value === keyOf(agentName, sessionId);
  }

  function isSessionHydrating(agentName: string, sessionId: string): boolean {
    return Boolean(
      conversations.get(keyOf(agentName, sessionId))?.isHydrating,
    );
  }

  const acpClient = computed(() => {
    const agentName = activeConversation.value?.session.agentName;
    return agentName ? getRuntime(agentName).client : null;
  });

  return {
    savedSessions,
    currentSession,
    messages,
    isConnected,
    isLoading,
    isPrompting,
    isConnecting,
    isRefreshingSessions,
    sessionListError,
    isReconnecting,
    error,
    pendingPermission,
    pendingPermissionAgentName,
    pendingPermissionSessionTitle,
    pendingAuthMethods,
    pendingAuthAgentName,
    availableModes,
    currentModeId,
    availableCommands,
    availableModels,
    currentModelId,
    startupPhase,
    startupLogs,
    startupElapsed,
    activeConversationKey,
    openConversations,
    isCurrentProfileBusyElsewhere,
    acpClient,

    hasActiveSession,
    messageList,
    toolCallList,
    resumableSessions,

    initStore,
    refreshSessions,
    createSession,
    resumeSession,
    selectConversation,
    deleteConversation,
    sendPrompt,
    cancelOperation,
    cancelConnection,
    resolvePermission,
    cancelPermission,
    selectAuthMethod,
    cancelAuthSelection,
    disconnect,
    disconnectProfile,
    disconnectAll,
    setMode,
    setModel,
    clearError,
    setError,
    tryReconnect,
    isProfileConnected,
    isProfileConnecting,
    isProfileBusy,
    isRefreshingAgent,
    sessionListErrorFor,
    profileErrorFor,
    startupPhaseFor,
    startupLogsFor,
    startupElapsedFor,
    isSessionOpen,
    isSessionActive,
    isSessionHydrating,
  };
});
