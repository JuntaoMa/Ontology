// Host abstraction — the rest of the app talks to this module instead of
// `@tauri-apps/*` packages directly. There are three runtime hosts:
//
//   - Tauri desktop: full feature set (stdio agents, fs RPCs, plugin-store,
//     plugin-dialog, machine-uid).
//   - Tauri mobile:  websocket-only agents, plugin-store/dialog, machine-id
//     unsupported (already handled by call sites).
//   - Web (browser): websocket-only agents, no fs, no folder picker,
//     localStorage for persistence, no machine id.
//
// All functions live behind a runtime `isTauriHost()` switch; Tauri SDK
// imports are deferred via `await import(...)` so a web build can ship
// without the Tauri runtime in its bundle.

import type {
  AgentsConfig,
  AgentConfig,
  AgentInstance,
  AgentMessage,
  AgentStderr,
} from '../types';
import { getTransportKind } from '../types';
import { isTauriHost, isDesktop } from '../platform';

export type Unlisten = () => void;

/** Optional fields used when adding/updating a remote (websocket / http) agent. */
export interface RemoteAgentOptions {
  transport?: 'websocket' | 'http';
  url?: string;
  headers?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Web-side state comes from the same-origin ACP Bridge. Browser code never
// stores arbitrary Agent endpoints, commands, credentials or working
// directories.
// ---------------------------------------------------------------------------

const WEB_CONFIG_PATH_LABEL = '(server Agent Profile catalog)';

interface PublicAgentProfile {
  id: string;
  revision: string;
  title: string;
  description: string;
  mutable: boolean;
  status: string;
  ws_url: string;
  cwd: string;
  model: {
    id: string;
    source: 'opencode' | 'profile';
  };
  retrieval?: {
    vector_top_k: number;
    graph_algorithm: string;
  };
  ontology: {
    id: string;
  };
}

async function loadWebConfig(): Promise<AgentsConfig> {
  const response = await fetch('/agents', {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  });
  if (!response.ok) {
    throw new Error(`Agent Profile catalog request failed (${response.status})`);
  }
  const payload = await response.json() as { agents?: unknown };
  if (!Array.isArray(payload.agents)) {
    throw new Error('Agent Profile catalog returned an invalid response');
  }

  const agents: Record<string, AgentConfig> = {};
  for (const candidate of payload.agents) {
    if (!isPublicAgentProfile(candidate)) continue;
    agents[candidate.id] = {
      id: candidate.id,
      title: candidate.title,
      description: candidate.description,
      revision: candidate.revision,
      mutable: candidate.mutable,
      status: candidate.status,
      cwd: candidate.cwd,
      model: candidate.model,
      retrieval: candidate.retrieval
        ? {
            vectorTopK: candidate.retrieval.vector_top_k,
            graphAlgorithm: candidate.retrieval.graph_algorithm,
          }
        : undefined,
      ontology: candidate.ontology,
      transport: 'websocket',
      url: toWebSocketUrl(candidate.ws_url),
    };
  }
  return { agents };
}

function isPublicAgentProfile(value: unknown): value is PublicAgentProfile {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<PublicAgentProfile>;
  return (
    typeof candidate.id === 'string' &&
    /^[a-z0-9-]+$/.test(candidate.id) &&
    typeof candidate.revision === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.description === 'string' &&
    typeof candidate.mutable === 'boolean' &&
    typeof candidate.status === 'string' &&
    typeof candidate.ws_url === 'string' &&
    candidate.ws_url.startsWith('/agents/') &&
    typeof candidate.cwd === 'string' &&
    isPublicModel(candidate.model) &&
    (candidate.retrieval === undefined ||
      isPublicRetrieval(candidate.retrieval)) &&
    typeof candidate.ontology === 'object' &&
    candidate.ontology !== null &&
    typeof candidate.ontology.id === 'string'
  );
}

function isPublicModel(value: unknown): value is PublicAgentProfile['model'] {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<PublicAgentProfile['model']>;
  return (
    typeof candidate.id === 'string' &&
    (candidate.source === 'opencode' || candidate.source === 'profile')
  );
}

function isPublicRetrieval(
  value: unknown,
): value is NonNullable<PublicAgentProfile['retrieval']> {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<
    NonNullable<PublicAgentProfile['retrieval']>
  >;
  return (
    typeof candidate.vector_top_k === 'number' &&
    Number.isInteger(candidate.vector_top_k) &&
    candidate.vector_top_k > 0 &&
    typeof candidate.graph_algorithm === 'string'
  );
}

export async function deleteProfileSession(
  profileId: string,
  sessionId: string,
): Promise<void> {
  if (isTauriHost()) {
    throw new Error(
      'Permanent OpenCode Session deletion is only available through the ACP Bridge',
    );
  }
  const response = await fetch(
    `/agents/${encodeURIComponent(profileId)}/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    },
  );
  if (response.ok) return;

  let message = `Conversation deletion failed (${response.status})`;
  try {
    const payload = (await response.json()) as {
      error?: unknown;
      message?: unknown;
    };
    if (typeof payload.message === 'string' && payload.message.trim()) {
      message = payload.message;
    } else if (payload.error === 'session_busy') {
      message = 'This conversation is still running and cannot be deleted';
    }
  } catch {
    // Keep the status-based fallback for malformed or empty responses.
  }
  throw new Error(message);
}

function toWebSocketUrl(relativeUrl: string): string {
  const url = new URL(relativeUrl, window.location.href);
  url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

// ---------------------------------------------------------------------------
// Config CRUD
// ---------------------------------------------------------------------------

export async function getConfig(): Promise<AgentsConfig> {
  if (isTauriHost()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<AgentsConfig>('get_config');
  }
  return await loadWebConfig();
}

export async function reloadConfig(): Promise<AgentsConfig> {
  if (isTauriHost()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<AgentsConfig>('reload_config');
  }
  return await loadWebConfig();
}

export async function getConfigPath(): Promise<string> {
  if (isTauriHost()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string>('get_config_path');
  }
  return WEB_CONFIG_PATH_LABEL;
}

export async function addAgent(
  name: string,
  command: string | null,
  args: string[],
  env: Record<string, string> = {},
  remote: RemoteAgentOptions = {}
): Promise<AgentsConfig> {
  if (isTauriHost()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<AgentsConfig>('add_agent', {
      name,
      command,
      args,
      env,
      transport: remote.transport,
      url: remote.url,
      headers: remote.headers,
    });
  }
  void name;
  void command;
  void args;
  void env;
  void remote;
  throw new Error('Agent Profiles are read-only and managed by the ACP Bridge');
}

export async function updateAgent(
  name: string,
  command: string | null,
  args: string[],
  env: Record<string, string> = {},
  remote: RemoteAgentOptions = {}
): Promise<AgentsConfig> {
  if (isTauriHost()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<AgentsConfig>('update_agent', {
      name,
      command,
      args,
      env,
      transport: remote.transport,
      url: remote.url,
      headers: remote.headers,
    });
  }
  void name;
  void command;
  void args;
  void env;
  void remote;
  throw new Error('Agent Profiles are read-only and managed by the ACP Bridge');
}

export async function removeAgent(name: string): Promise<AgentsConfig> {
  if (isTauriHost()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<AgentsConfig>('remove_agent', { name });
  }
  void name;
  throw new Error('Agent Profiles are read-only and managed by the ACP Bridge');
}

// ---------------------------------------------------------------------------
// Stdio agent lifecycle (Tauri desktop only — throws elsewhere)
// ---------------------------------------------------------------------------

function throwNoStdio(): never {
  throw new Error('stdio agents are not supported on this platform');
}

export async function spawnAgent(name: string): Promise<AgentInstance> {
  if (!isTauriHost()) throwNoStdio();
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<AgentInstance>('spawn_agent', { name });
}

export async function sendToAgent(agentId: string, message: string): Promise<void> {
  if (!isTauriHost()) throwNoStdio();
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<void>('send_to_agent', { agentId, message });
}

export async function killAgent(agentId: string): Promise<void> {
  if (!isTauriHost()) throwNoStdio();
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<void>('kill_agent', { agentId });
}

export async function listRunningAgents(): Promise<string[]> {
  if (!isTauriHost()) return [];
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string[]>('list_running_agents');
}

export async function onAgentMessage(
  callback: (message: AgentMessage) => void
): Promise<Unlisten> {
  if (!isTauriHost()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<AgentMessage>('agent-message', (event) => callback(event.payload)) as Promise<Unlisten>;
}

export async function onAgentClosed(
  callback: (agentId: string) => void
): Promise<Unlisten> {
  if (!isTauriHost()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<string>('agent-closed', (event) => callback(event.payload)) as Promise<Unlisten>;
}

export async function onAgentStderr(
  callback: (stderr: AgentStderr) => void
): Promise<Unlisten> {
  if (!isTauriHost()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<AgentStderr>('agent-stderr', (event) => callback(event.payload)) as Promise<Unlisten>;
}

export async function onConfigChanged(
  callback: (config: AgentsConfig) => void
): Promise<Unlisten> {
  if (!isTauriHost()) {
    // No external mutator on web — call sites already update Pinia state
    // synchronously when they invoke addAgent/updateAgent/removeAgent.
    void callback;
    return () => {};
  }
  const { listen } = await import('@tauri-apps/api/event');
  return listen<AgentsConfig>('config-changed', (event) => callback(event.payload)) as Promise<Unlisten>;
}

// ---------------------------------------------------------------------------
// Misc capability helpers
// ---------------------------------------------------------------------------

export async function getMachineId(): Promise<string> {
  if (!isTauriHost()) {
    throw new Error('machine id is not available on this platform');
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('get_machine_id');
}

const FALLBACK_VERSION = '0.0.0-web';

export async function getAppVersion(): Promise<string> {
  if (isTauriHost()) {
    const { getVersion } = await import('@tauri-apps/api/app');
    return getVersion();
  }
  // Injected by Vite (see vite.config.ts).
  const v = (import.meta.env as Record<string, string | undefined>).VITE_APP_VERSION;
  return v ?? FALLBACK_VERSION;
}

/** True when the host can present a native folder picker. */
export function canPickFolder(): boolean {
  return isDesktop();
}

/** Open the platform folder picker. Returns the absolute path the user
 * selected, or `null` if cancelled / unsupported. */
export async function pickFolder(title?: string): Promise<string | null> {
  if (!canPickFolder()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({
    directory: true,
    multiple: false,
    title: title ?? 'Select Folder',
  });
  return typeof result === 'string' ? result : null;
}

// ---------------------------------------------------------------------------
// Filesystem RPC handlers (Tauri desktop only)
// ---------------------------------------------------------------------------

export async function readTextFile(path: string): Promise<string> {
  if (!isTauriHost()) {
    throw new Error('readTextFile is not supported on this platform');
  }
  const { readTextFile: rtf } = await import('@tauri-apps/plugin-fs');
  return rtf(path);
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  if (!isTauriHost()) {
    throw new Error('writeTextFile is not supported on this platform');
  }
  const { writeTextFile: wtf } = await import('@tauri-apps/plugin-fs');
  await wtf(path, content);
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { loadKvStore } from './storage';
export type { KVStore } from './storage';

// Re-export `getTransportKind` for convenience so call sites that already
// pull from `host` don't need a second import.
export { getTransportKind };
