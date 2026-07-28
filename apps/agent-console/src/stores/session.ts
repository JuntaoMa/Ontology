// Session store for managing ACP sessions and persistence
import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { getAppVersion } from '../lib/host';
import type { SavedSession, ChatMessage, ToolCallInfo, PermissionRequest, SessionMode, SlashCommand, ModelInfo, AgentConfig } from '../lib/types';
import { getTransportKind } from '../lib/types';
import { applyToolCallUpdate, createToolCallInfo } from '../lib/tool-call';
import { AcpClientBridge, createAcpClient } from '../lib/acp-bridge';
import { onAgentStderr, spawnAgent, killAgent } from '../lib/host';
import { isDesktop } from '../lib/platform';
import { useConfigStore } from './config';
import type { SessionNotification, AuthMethod } from '@agentclientprotocol/sdk';

const PROTOCOL_VERSION = 1;

interface ConnectionAttempt {
  cancelled: boolean;
  client: AcpClientBridge | null;
  spawnedAgentId?: string;
}

// App version (loaded once at startup)
let appVersion = '0.1.0';

// Startup phase detection patterns
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

export const useSessionStore = defineStore('session', () => {
  // State
  const savedSessions = ref<SavedSession[]>([]);
  const currentSession = ref<SavedSession | null>(null);
  const messages = ref<ChatMessage[]>([]);
  const toolCalls = ref<Map<string, ToolCallInfo>>(new Map());
  const isConnected = ref(false);
  const isLoading = ref(false);
  const isConnecting = ref(false);
  const isRefreshingSessions = ref(false);
  const sessionListError = ref<string | null>(null);
  // True while a foreground reconnect attempt is in flight. Distinct from
  // `isConnecting` (which is the multi-phase initial spawn/connect path):
  // reconnects skip the spawn/stderr-progress UI and just need a small
  // "Reconnecting…" indicator.
  const isReconnecting = ref(false);
  const error = ref<string | null>(null);
  const pendingPermission = ref<PermissionRequest | null>(null);

  // Authentication state
  const pendingAuthMethods = ref<AuthMethod[]>([]);
  const pendingAuthAgentName = ref<string>('');
  let authMethodResolver: ((methodId: string | null) => void) | null = null;

  // Session modes
  const availableModes = ref<SessionMode[]>([]);
  const currentModeId = ref<string>('');

  // Slash commands
  const availableCommands = ref<SlashCommand[]>([]);

  // Session models
  const availableModels = ref<ModelInfo[]>([]);
  const currentModelId = ref<string>('');

  // Startup progress tracking
  const startupPhase = ref<string>('starting');
  const startupLogs = ref<string[]>([]);
  const startupElapsed = ref<number>(0);
  let startupTimer: ReturnType<typeof setInterval> | null = null;
  let stderrUnlisten: (() => void) | null = null;

  // Current ACP client
  let acpClient: AcpClientBridge | null = null;
  let sessionListGeneration = 0;
  let replayingHistory = false;
  let replayLastUpdateAt = 0;
  let activeSupportsSessionList = false;
  let connectionAttempt: ConnectionAttempt | null = null;
  let stopPermissionWatch: (() => void) | null = null;
  let expectedSessionId: string | null = null;

  // Computed
  const hasActiveSession = computed(() => currentSession.value !== null);
  const messageList = computed(() => messages.value);
  const toolCallList = computed(() => Array.from(toolCalls.value.values()));
  // Only sessions that support resuming (loadSession capability)
  const resumableSessions = computed(() =>
    savedSessions.value.filter(s => s.supportsLoadSession === true)
  );

  // Initialize store
  async function initStore() {
    // Load app version (Tauri API on desktop/mobile, build-time inject on web)
    try {
      appVersion = await getAppVersion();
    } catch (e) {
      console.warn('Failed to get app version:', e);
    }
  }

  function initializeClient(client: AcpClientBridge) {
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

  function replaceSessionsForAgent(
    agentName: string,
    sessions: SavedSession[],
  ): void {
    savedSessions.value = [
      ...savedSessions.value.filter((session) => session.agentName !== agentName),
      ...sessions,
    ];
  }

  async function waitForReplayQuiescence(): Promise<void> {
    const deadline = Date.now() + 250;
    while (Date.now() < deadline) {
      if (Date.now() - replayLastUpdateAt >= 50) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
  }

  async function connectProfileClient(
    agentName: string,
    agentConfig: AgentConfig,
    shouldStop: () => boolean = () => false,
  ): Promise<AcpClientBridge> {
    const delays = getTransportKind(agentConfig) === 'websocket'
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
        return await createAcpClient({ name: agentName, config: agentConfig });
      } catch (cause) {
        lastError = cause;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Unable to connect to the Agent');
  }

  /**
   * Ask the Agent for its durable sessions. The browser does not maintain a
   * competing session index; OpenCode remains the sole session owner.
   */
  async function refreshSessions(agentName: string): Promise<void> {
    const generation = ++sessionListGeneration;
    isRefreshingSessions.value = true;
    sessionListError.value = null;
    let listClient: AcpClientBridge | null = null;

    try {
      const configStore = useConfigStore();
      const agentConfig = configStore.getAgent(agentName);
      if (!agentConfig) {
        throw new Error(`Agent '${agentName}' not found in catalog`);
      }
      if (agentConfig.status === 'unavailable') {
        throw new Error('This Agent Profile is unavailable until its required environment is configured');
      }
      if (!agentConfig.cwd) {
        throw new Error(`Agent '${agentName}' has no fixed working directory`);
      }

      // Reuse an active connection for the same profile. Otherwise, open a
      // short-lived ACP connection solely for initialize + session/list.
      const activeClient = acpClient;
      const reusableClient =
        activeClient !== null &&
        currentSession.value?.agentName === agentName &&
        isConnected.value
          ? activeClient
          : null;
      const canReuseCurrent = reusableClient !== null;
      const client = reusableClient
        ? reusableClient
        : await connectProfileClient(
          agentName,
          agentConfig,
          () => generation !== sessionListGeneration,
        );
      listClient = client;

      const initResponse = canReuseCurrent
        ? null
        : await initializeClient(client);
      const supportsList = canReuseCurrent
        ? activeSupportsSessionList
        : initResponse?.agentCapabilities?.sessionCapabilities?.list != null;
      const supportsLoad = canReuseCurrent
        ? currentSession.value?.supportsLoadSession === true
        : initResponse?.agentCapabilities?.loadSession === true;

      if (!supportsList || !supportsLoad) {
        if (generation === sessionListGeneration) {
          replaceSessionsForAgent(agentName, []);
          sessionListError.value =
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
          // Do not let a non-conforming Agent redirect session/load to a cwd
          // outside the server-published profile.
          if (session.cwd !== agentConfig.cwd) continue;
          const parsedUpdatedAt = session.updatedAt
            ? Date.parse(session.updatedAt)
            : Number.NaN;
          listed.push({
            id: `${agentName}:${session.sessionId}`,
            agentName,
            sessionId: session.sessionId,
            title: session.title?.trim() || 'Untitled session',
            lastUpdated: Number.isFinite(parsedUpdatedAt) ? parsedUpdatedAt : 0,
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

      if (generation === sessionListGeneration) {
        replaceSessionsForAgent(agentName, listed);
      }
    } catch (cause) {
      if (generation === sessionListGeneration) {
        replaceSessionsForAgent(agentName, []);
        sessionListError.value =
          cause instanceof Error ? cause.message : String(cause);
      }
    } finally {
      if (listClient && listClient !== acpClient) {
        try {
          await listClient.disconnect();
        } catch {
          // The list request has already completed or failed; there is no
          // useful recovery action for a short-lived connection.
        }
      }
      if (generation === sessionListGeneration) {
        isRefreshingSessions.value = false;
      }
    }
  }

  // Handle an unexpected transport close (e.g. WebSocket dropped while idle,
  // local agent process exited). The bridge has already rejected any
  // in-flight requests; we just need to tear down UI state so the user gets
  // a clear "disconnected" signal instead of a stale "connected" view.
  function handleUnexpectedClose(client: AcpClientBridge, reason?: string): void {
    // If `acpClient` is already null, this fired during a voluntary
    // disconnect that's tearing down anyway — nothing to do.
    if (acpClient !== client) return;
    stopPermissionWatch?.();
    stopPermissionWatch = null;
    acpClient = null;
    activeSupportsSessionList = false;
    isConnected.value = false;
    isLoading.value = false;
    pendingPermission.value = null;
    error.value = `Connection lost: ${reason ?? 'transport closed'}`;
  }

  function bindClient(client: AcpClientBridge): void {
    client.onSessionUpdate = handleSessionUpdate;
    client.onTransportClose = (reason) => {
      handleUnexpectedClose(client, reason);
    };
    stopPermissionWatch?.();
    stopPermissionWatch = watch(
      () => client.pendingPermissionRequest.value,
      (newValue) => {
        if (acpClient === client) {
          pendingPermission.value = newValue ?? null;
        }
      },
      { immediate: true },
    );
  }

  function unbindClient(client: AcpClientBridge): void {
    if (acpClient !== client) return;
    stopPermissionWatch?.();
    stopPermissionWatch = null;
    pendingPermission.value = null;
  }

  function ensureAssistantMessageForToolCall(): ChatMessage {
    const lastMessage = messages.value[messages.value.length - 1];
    if (lastMessage?.role === 'assistant') {
      lastMessage.toolCalls ??= [];
      return lastMessage;
    }

    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: replayingHistory ? undefined : Date.now(),
      toolCalls: [],
    };
    messages.value.push(assistantMessage);
    return assistantMessage;
  }

  function attachToolCall(toolCall: ToolCallInfo): void {
    const assistantMessage = ensureAssistantMessageForToolCall();
    assistantMessage.toolCalls ??= [];
    if (!assistantMessage.toolCalls.some((item) => item.toolCallId === toolCall.toolCallId)) {
      assistantMessage.toolCalls.push(toolCall);
    }
  }

  // Session update handler
  function handleSessionUpdate(notification: SessionNotification) {
    if (
      expectedSessionId === null ||
      notification.sessionId !== expectedSessionId
    ) {
      return;
    }
    if (replayingHistory) replayLastUpdateAt = Date.now();
    const update = notification.update;

    switch (update.sessionUpdate) {
      case 'user_message_chunk':
        // Append to last user message or create new (for replay)
        const lastUserMsg = messages.value[messages.value.length - 1];
        if (lastUserMsg && lastUserMsg.role === 'user') {
          if (update.content.type === 'text') {
            lastUserMsg.content += update.content.text;
          }
        } else {
          messages.value.push({
            id: crypto.randomUUID(),
            role: 'user',
            content: update.content.type === 'text' ? update.content.text : '',
            timestamp: replayingHistory ? undefined : Date.now(),
          });
        }
        break;

      case 'agent_message_chunk':
        // Append to last assistant message or create new
        const lastMsg = messages.value[messages.value.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
          if (update.content.type === 'text') {
            lastMsg.content += update.content.text;
          }
        } else {
          messages.value.push({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: update.content.type === 'text' ? update.content.text : '',
            timestamp: replayingHistory ? undefined : Date.now(),
            toolCalls: [],
          });
        }
        break;

      case 'agent_thought_chunk':
        // Append to last assistant message's thought field or create new
        const lastAssistantMsg = messages.value[messages.value.length - 1];
        if (lastAssistantMsg && lastAssistantMsg.role === 'assistant') {
          if (update.content.type === 'text') {
            lastAssistantMsg.thought = (lastAssistantMsg.thought || '') + update.content.text;
          }
        } else {
          messages.value.push({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: '',
            thought: update.content.type === 'text' ? update.content.text : '',
            timestamp: replayingHistory ? undefined : Date.now(),
            toolCalls: [],
          });
        }
        break;

      case 'plan': {
        const assistantMessage = ensureAssistantMessageForToolCall();
        assistantMessage.plan = update.entries.map((entry) => ({ ...entry }));
        break;
      }

      case 'tool_call':
        {
          const observedAt = replayingHistory ? null : Date.now();
          const existingToolCall = toolCalls.value.get(update.toolCallId);
          const toolCall = existingToolCall
            ? applyToolCallUpdate(existingToolCall, update, observedAt)
            : createToolCallInfo(update, observedAt);
          toolCalls.value.set(update.toolCallId, toolCall);
          attachToolCall(toolCall);
        }
        break;

      case 'tool_call_update':
        {
          const observedAt = replayingHistory ? null : Date.now();
          const existing = toolCalls.value.get(update.toolCallId);
          const toolCall = existing
            ? applyToolCallUpdate(existing, update, observedAt)
            : createToolCallInfo(update, observedAt);
          toolCalls.value.set(update.toolCallId, toolCall);
          attachToolCall(toolCall);

          // Retain compatibility with any pre-existing state that held a
          // separate object instead of the shared map/message reference.
          for (const msg of messages.value) {
            if (msg.toolCalls) {
              const tc = msg.toolCalls.find(t => t.toolCallId === update.toolCallId);
              if (tc && tc !== toolCall) {
                applyToolCallUpdate(tc, update, observedAt);
              }
            }
          }
        }
        break;

      case 'current_mode_update':
        // Agent changed the mode
        if ('modeId' in update && update.modeId) {
          currentModeId.value = update.modeId as string;
        }
        break;

      case 'available_commands_update':
        // Agent advertised slash commands
        if ('availableCommands' in update && Array.isArray(update.availableCommands)) {
          availableCommands.value = update.availableCommands.map((cmd) => ({
            name: cmd.name,
            description: cmd.description,
            hint: cmd.input?.hint ?? undefined,
          }));
        }
        break;

      case 'session_info_update': {
        const matching = savedSessions.value.find(
          (session) =>
            session.sessionId === notification.sessionId &&
            session.agentName === currentSession.value?.agentName,
        );
        if (matching) {
          if ('title' in update && update.title !== undefined) {
            matching.title = update.title?.trim() || 'Untitled session';
          }
          if ('updatedAt' in update && update.updatedAt) {
            const parsed = Date.parse(update.updatedAt);
            if (Number.isFinite(parsed)) matching.lastUpdated = parsed;
          }
        }
        break;
      }

      default:
        // Unknown updates remain visible in ACP Traffic. Avoid logging the
        // payload because it may contain conversation or tool data.
        break;
    }
  }

  // Prompt user to select auth method
  async function promptForAuthMethod(authMethods: AuthMethod[], agentName: string): Promise<string | null> {
    return new Promise((resolve) => {
      pendingAuthMethods.value = authMethods;
      pendingAuthAgentName.value = agentName;
      authMethodResolver = resolve;
    });
  }

  // User selected an auth method
  function selectAuthMethod(methodId: string): void {
    if (authMethodResolver) {
      authMethodResolver(methodId);
      authMethodResolver = null;
      pendingAuthMethods.value = [];
      pendingAuthAgentName.value = '';
    }
  }

  // User cancelled auth selection
  function cancelAuthSelection(): void {
    if (authMethodResolver) {
      authMethodResolver(null);
      authMethodResolver = null;
      pendingAuthMethods.value = [];
      pendingAuthAgentName.value = '';
    }
  }

  // Create new session
  async function createSession(agentName: string, cwd: string): Promise<void> {
    if (isLoading.value || isConnected.value || acpClient) {
      throw new Error('Disconnect the current session before starting another one');
    }
    isLoading.value = true;
    isConnecting.value = true;
    const attempt: ConnectionAttempt = { cancelled: false, client: null };
    connectionAttempt = attempt;
    error.value = null;

    // Look up the agent's transport kind so we know whether to do the
    // stdio-only startup choreography (spawn → stderr progress) or the
    // streamlined remote path (just open a network transport).
    const configStore = useConfigStore();
    const agentConfig: AgentConfig | undefined = configStore.getAgent(agentName);
    const transportKind = agentConfig
      ? getTransportKind(agentConfig)
      : 'stdio';
    const isRemote = transportKind !== 'stdio';

    // Reset and start progress tracking
    startupPhase.value = 'starting';
    startupLogs.value = [];
    startupElapsed.value = 0;
    startupTimer = setInterval(() => {
      startupElapsed.value++;
    }, 1000);

    // Track the spawned stdio instance separately so we can `killAgent` it
    // if cancellation/abort happens before we've wrapped it in a bridge.
    // Once `acpClient` is set, ownership transfers to the bridge and
    // `acpClient.disconnect()` becomes the only correct cleanup path.
    let spawnedInstance: { id: string } | null = null;

    try {
      if (!agentConfig) {
        throw new Error(`Agent '${agentName}' not found in config`);
      }

      if (!isRemote) {
        // For stdio agents we need the spawned process's id up front so the
        // stderr listener can filter on it (multiple agents may be running
        // concurrently). We spawn here, hand the resulting AgentInstance to
        // a StdioTransport, then build the bridge from that transport.
        startupPhase.value = 'starting';
        const agentInstance = await spawnAgent(agentName);
        spawnedInstance = agentInstance;
        attempt.spawnedAgentId = agentInstance.id;

        stderrUnlisten = await onAgentStderr((stderr) => {
          if (stderr.agent_id !== agentInstance.id) return;
          startupLogs.value.push(stderr.line);
          // Detect phase from output
          const detectedPhase = detectPhase(stderr.line);
          if (detectedPhase) {
            startupPhase.value = detectedPhase;
          }
        }) as unknown as () => void;

        if (attempt.cancelled || connectionAttempt !== attempt) {
          // Process was spawned but no bridge exists yet — kill the orphan
          // before throwing so the local agent doesn't keep running.
          await killAgent(agentInstance.id).catch((err) =>
            console.warn('killAgent during abort failed:', err)
          );
          spawnedInstance = null;
          attempt.spawnedAgentId = undefined;
          throw new Error('Connection cancelled');
        }

        startupPhase.value = 'initializing';

        // Wrap the just-spawned instance in a StdioTransport. Using the
        // legacy single-arg form keeps backward compatibility and avoids a
        // double-spawn (StdioTransport.spawn would call spawnAgent again).
        const client = await createAcpClient(agentInstance);
        attempt.client = client;
        if (attempt.cancelled || connectionAttempt !== attempt) {
          await client.disconnect();
          throw new Error('Connection cancelled');
        }
        acpClient = client;
        bindClient(client);
        // Ownership of the child process now belongs to the bridge — clear
        // our local reference so the catch block doesn't double-kill it.
        spawnedInstance = null;
        attempt.spawnedAgentId = undefined;
      } else {
        // Remote agents have no stderr stream; show a minimal "connecting"
        // state instead of the multi-phase progress UI.
        startupPhase.value = 'connecting';

        if (attempt.cancelled || connectionAttempt !== attempt) {
          throw new Error('Connection cancelled');
        }

        // The factory opens a WebSocket / HTTP connection based on
        // agentConfig.transport.
        const client = await connectProfileClient(
          agentName,
          agentConfig,
          () => attempt.cancelled || connectionAttempt !== attempt,
        );
        attempt.client = client;
        if (attempt.cancelled || connectionAttempt !== attempt) {
          await client.disconnect();
          throw new Error('Connection cancelled');
        }
        acpClient = client;
        bindClient(client);
      }

      if (attempt.cancelled || connectionAttempt !== attempt) {
        await acpClient.disconnect();
        throw new Error('Connection cancelled');
      }

      startupPhase.value = 'connecting';

      const initResponse = await initializeClient(acpClient);
      activeSupportsSessionList =
        initResponse.agentCapabilities?.sessionCapabilities?.list != null;

      // Check if agent supports session loading
      const supportsLoadSession = initResponse.agentCapabilities?.loadSession ?? false;

      if (attempt.cancelled || connectionAttempt !== attempt) {
        await acpClient.disconnect();
        throw new Error('Connection cancelled');
      }

      // Store available auth methods for potential retry
      const availableAuthMethods = initResponse.authMethods || [];

      if (attempt.cancelled || connectionAttempt !== attempt) {
        await acpClient.disconnect();
        throw new Error('Connection cancelled');
      }

      // Try to create session - may fail with auth_required
      let sessionResponse;
      try {
        sessionResponse = await acpClient.newSession({
          cwd,
          mcpServers: [],
        });
      } catch (sessionError: unknown) {
        // Check if auth is required (error code -32000)
        const errorMessage = sessionError instanceof Error ? sessionError.message : String(sessionError);
        const isAuthRequired = errorMessage.toLowerCase().includes('authentication required') ||
                               errorMessage.includes('-32000');

        if (isAuthRequired && availableAuthMethods.length > 0) {
          // Prompt user to select auth method
          const selectedMethodId = await promptForAuthMethod(availableAuthMethods, agentName);

          if (
            !selectedMethodId ||
            attempt.cancelled ||
            connectionAttempt !== attempt
          ) {
            await acpClient.disconnect();
            throw new Error('Authentication cancelled by user');
          }

          await acpClient.authenticate({
            methodId: selectedMethodId,
          });

          if (attempt.cancelled || connectionAttempt !== attempt) {
            await acpClient.disconnect();
            throw new Error('Connection cancelled');
          }

          // Retry session creation after auth
          sessionResponse = await acpClient.newSession({
            cwd,
            mcpServers: [],
          });
        } else {
          throw sessionError;
        }
      }

      // Save session
      const session: SavedSession = {
        id: crypto.randomUUID(),
        agentName,
        sessionId: sessionResponse.sessionId,
        title: `Session ${new Date().toLocaleString()}`,
        lastUpdated: Date.now(),
        cwd,
        supportsLoadSession,
      };

      expectedSessionId = session.sessionId;
      currentSession.value = session;
      savedSessions.value = [
        session,
        ...savedSessions.value.filter(
          (saved) =>
            saved.agentName !== agentName ||
            saved.sessionId !== session.sessionId,
        ),
      ];

      isConnected.value = true;
      messages.value = [];
      toolCalls.value.clear();

      // Set up session modes if available
      if (sessionResponse.modes) {
        availableModes.value = (sessionResponse.modes.availableModes || []).map(m => ({
          id: m.id,
          name: m.name,
          description: m.description ?? undefined,
        }));
        currentModeId.value = sessionResponse.modes.currentModeId || '';
      } else {
        availableModes.value = [];
        currentModeId.value = '';
      }

      // Set up session models if available
      if (sessionResponse.models) {
        availableModels.value = (sessionResponse.models.availableModels || []).map(m => ({
          modelId: m.modelId,
          name: m.name,
          description: m.description ?? undefined,
        }));
        currentModelId.value = sessionResponse.models.currentModelId || '';
      } else {
        availableModels.value = [];
        currentModelId.value = '';
      }

    } catch (e) {
      error.value = attempt.cancelled
        ? null
        : (e instanceof Error ? e.message : String(e));
      // Tear down whichever side of the connection is live. The bridge owns
      // the spawned process once it exists, so prefer disconnecting it.
      // Otherwise (e.g. abort right after spawn but before bridge creation)
      // kill the orphaned local agent directly.
      if (attempt.client) {
        try {
          unbindClient(attempt.client);
          await attempt.client.disconnect();
        } catch (cleanupErr) {
          console.warn('disconnect during createSession cleanup failed:', cleanupErr);
        }
      } else if (spawnedInstance) {
        try {
          await killAgent(spawnedInstance.id);
        } catch (cleanupErr) {
          console.warn('killAgent during createSession cleanup failed:', cleanupErr);
        }
      }
      if (acpClient === attempt.client) acpClient = null;
      activeSupportsSessionList = false;
      throw e;
    } finally {
      if (connectionAttempt === attempt) {
        connectionAttempt = null;
        isLoading.value = false;
        isConnecting.value = false;
        // Clean up startup progress tracking
        if (startupTimer) {
          clearInterval(startupTimer);
          startupTimer = null;
        }
        if (stderrUnlisten) {
          stderrUnlisten();
          stderrUnlisten = null;
        }
      }
    }
  }

  // Resume existing session
  async function resumeSession(savedSession: SavedSession): Promise<void> {
    if (isLoading.value || isConnected.value || acpClient) {
      throw new Error('Disconnect the current session before resuming another one');
    }
    isLoading.value = true;
    const attempt: ConnectionAttempt = { cancelled: false, client: null };
    connectionAttempt = attempt;
    error.value = null;

    try {
      const configStore = useConfigStore();
      const agentConfig: AgentConfig | undefined = configStore.getAgent(savedSession.agentName);
      if (!agentConfig) {
        throw new Error(`Agent '${savedSession.agentName}' not found in config`);
      }

      // Create ACP client bridge (transport selected based on agent config).
      const client = await connectProfileClient(
        savedSession.agentName,
        agentConfig,
        () => attempt.cancelled || connectionAttempt !== attempt,
      );
      attempt.client = client;
      if (attempt.cancelled || connectionAttempt !== attempt) {
        await client.disconnect();
        throw new Error('Connection cancelled');
      }
      acpClient = client;
      bindClient(client);

      const initResponse = await initializeClient(acpClient);
      activeSupportsSessionList =
        initResponse.agentCapabilities?.sessionCapabilities?.list != null;

      // Store available auth methods for potential retry
      const availableAuthMethods = initResponse.authMethods || [];

      // Clear messages BEFORE loadSession - the agent will stream replay via notifications
      messages.value = [];
      toolCalls.value.clear();

      if (!agentConfig.cwd || savedSession.cwd !== agentConfig.cwd) {
        throw new Error('Session working directory does not match its Agent Profile');
      }
      expectedSessionId = savedSession.sessionId;

      // `session/load` replays historical events over session/update. ACP
      // does not carry canonical timestamps for those events, so mark the
      // replay and avoid displaying fabricated tool durations.
      replayingHistory = true;
      replayLastUpdateAt = Date.now();
      try {
        // Try to load existing session - may fail with auth_required
        try {
          await acpClient.loadSession({
            sessionId: savedSession.sessionId,
            cwd: agentConfig.cwd,
            mcpServers: [],
          });
        } catch (sessionError: unknown) {
          // Check if auth is required (error code -32000)
          const errorMessage = sessionError instanceof Error ? sessionError.message : String(sessionError);
          const isAuthRequired = errorMessage.toLowerCase().includes('authentication required') ||
                                 errorMessage.includes('-32000');

          if (isAuthRequired && availableAuthMethods.length > 0) {
            // Prompt user to select auth method
            const selectedMethodId = await promptForAuthMethod(availableAuthMethods, savedSession.agentName);

            if (!selectedMethodId) {
              await acpClient.disconnect();
              throw new Error('Authentication cancelled by user');
            }

            await acpClient.authenticate({
              methodId: selectedMethodId,
            });

            // Retry loading session after auth
            await acpClient.loadSession({
              sessionId: savedSession.sessionId,
              cwd: agentConfig.cwd,
              mcpServers: [],
            });
          } else {
            throw sessionError;
          }
        }
        await waitForReplayQuiescence();
      } finally {
        replayingHistory = false;
      }

      currentSession.value = savedSession;
      isConnected.value = true;
      // Messages already populated by session/update notifications during loadSession

    } catch (e) {
      error.value = attempt.cancelled
        ? null
        : (e instanceof Error ? e.message : String(e));
      expectedSessionId = null;
      expectedSessionId = null;
      // Disconnect the bridge if it was created — otherwise we leak the
      // spawned stdio process or open WebSocket on initialize/loadSession
      // failure.
      if (attempt.client) {
        try {
          unbindClient(attempt.client);
          await attempt.client.disconnect();
        } catch (cleanupErr) {
          console.warn('disconnect during resumeSession cleanup failed:', cleanupErr);
        }
        if (acpClient === attempt.client) acpClient = null;
        activeSupportsSessionList = false;
      }
      throw e;
    } finally {
      if (connectionAttempt === attempt) {
        connectionAttempt = null;
        isLoading.value = false;
      }
    }
  }

  // Send prompt
  async function sendPrompt(text: string): Promise<void> {
    if (!acpClient || !currentSession.value) {
      throw new Error('No active session');
    }

    // Add user message
    messages.value.push({
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    });

    isLoading.value = true;
    try {
      await acpClient.prompt({
        sessionId: currentSession.value.sessionId,
        prompt: [
          {
            type: 'text',
            text,
          },
        ],
      });

      // Update session title if it's the first message
      if (messages.value.length === 2 && currentSession.value) {
        currentSession.value.title = text.slice(0, 50) + (text.length > 50 ? '...' : '');
        currentSession.value.lastUpdated = Date.now();
      }
    } finally {
      isLoading.value = false;
    }
  }

  // Cancel current operation
  async function cancelOperation(): Promise<void> {
    if (!acpClient || !currentSession.value) return;

    await acpClient.cancel({
      sessionId: currentSession.value.sessionId,
    });
  }

  // Cancel ongoing connection attempt
  async function cancelConnection(): Promise<void> {
    const attempt = connectionAttempt;
    if (!attempt) return;
    attempt.cancelled = true;
    startupPhase.value = 'cancelling';
    error.value = null;

    // Cancel auth selection if pending
    if (authMethodResolver) {
      authMethodResolver(null);
      authMethodResolver = null;
      pendingAuthMethods.value = [];
      pendingAuthAgentName.value = '';
    }

    // Disconnect if client exists
    if (attempt.client) {
      try {
        unbindClient(attempt.client);
        await attempt.client.disconnect();
      } catch (e) {
        console.error('Error disconnecting:', e);
      }
      if (acpClient === attempt.client) acpClient = null;
      activeSupportsSessionList = false;
    }
    if (attempt.spawnedAgentId) {
      try {
        await killAgent(attempt.spawnedAgentId);
      } catch {
        // The create path may already have transferred or terminated it.
      }
    }
  }

  // Handle permission response
  function resolvePermission(optionId: string): void {
    if (acpClient) {
      acpClient.resolvePermission(optionId);
    }
  }

  function cancelPermission(): void {
    if (acpClient) {
      acpClient.cancelPermission();
    }
  }

  // Disconnect current session
  async function disconnect(): Promise<void> {
    const client = acpClient;
    if (client) {
      unbindClient(client);
      await client.disconnect();
      if (acpClient === client) acpClient = null;
    }
    activeSupportsSessionList = false;
    expectedSessionId = null;
    pendingPermission.value = null;

    currentSession.value = null;
    isConnected.value = false;
    messages.value = [];
    toolCalls.value.clear();
    availableModes.value = [];
    currentModeId.value = '';
    availableCommands.value = [];
    availableModels.value = [];
    currentModelId.value = '';
  }

  // Set session mode
  async function setMode(modeId: string): Promise<void> {
    if (!acpClient || !currentSession.value) {
      throw new Error('No active session');
    }

    await acpClient.setMode({
      sessionId: currentSession.value.sessionId,
      modeId,
    });

    // Optimistically update the current mode
    currentModeId.value = modeId;
  }

  // Set session model
  async function setModel(modelId: string): Promise<void> {
    if (!acpClient || !currentSession.value) {
      throw new Error('No active session');
    }

    await acpClient.unstable_setSessionModel({
      sessionId: currentSession.value.sessionId,
      modelId,
    });

    // Optimistically update the current model
    currentModelId.value = modelId;
  }

  function clearError() {
    error.value = null;
  }

  /**
   * Foreground reconnect: when the user returns to the app and we're
   * disconnected (because the OS froze the WebView, the NAT killed the TCP
   * connection, or the network changed), silently re-attach to the saved
   * session if possible.
   *
   * Returns `true` if a reconnect was attempted, `false` if there was
   * nothing to do (no saved session, already connected/connecting, agent
   * doesn't advertise session-load support, etc.).
   *
   * Errors are surfaced via `error.value` exactly like a manual resume
   * would; the caller doesn't need to handle them.
   */
  async function tryReconnect(): Promise<boolean> {
    // Already connected or already trying — leave it alone.
    if (isConnected.value || isConnecting.value || isLoading.value) {
      return false;
    }
    // No prior session to reconnect to.
    const session = currentSession.value;
    if (!session) {
      return false;
    }
    // Bridge already exists (race with another reconnect in flight).
    if (acpClient) {
      return false;
    }
    // Agent must support `session/load` for resume to be meaningful;
    // otherwise we'd just create a fresh session, which is a strictly
    // user-initiated action.
    if (!session.supportsLoadSession) {
      return false;
    }

    // Clear the stale "Connection lost" banner up-front so the UI shows
    // an honest "Reconnecting…" state instead of a contradictory red
    // banner during the attempt. If the reconnect ultimately fails, the
    // catch below restores a real error message.
    error.value = null;
    isReconnecting.value = true;
    try {
      await resumeSession(session);
      return true;
    } catch (e) {
      // `resumeSession`'s own catch already wrote `error.value`; nothing
      // more to do here. Returning true so the caller knows we tried.
      console.warn('Foreground reconnect failed:', e);
      return true;
    } finally {
      isReconnecting.value = false;
    }
  }

  return {
    // State
    savedSessions,
    currentSession,
    messages,
    isConnected,
    isLoading,
    isConnecting,
    isRefreshingSessions,
    sessionListError,
    isReconnecting,
    error,
    pendingPermission,
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

    // Computed
    hasActiveSession,
    messageList,
    toolCallList,
    resumableSessions,

    // Actions
    initStore,
    refreshSessions,
    createSession,
    resumeSession,
    sendPrompt,
    cancelOperation,
    cancelConnection,
    resolvePermission,
    cancelPermission,
    selectAuthMethod,
    cancelAuthSelection,
    disconnect,
    setMode,
    setModel,
    clearError,
    tryReconnect,

    // Expose client for permission handling
    get acpClient() { return acpClient; },
  };
});
