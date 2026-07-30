// Types for the Runtime Project ACP UI.
import type {
  PlanEntry,
  ToolCallContent,
  ToolCallLocation,
  ToolCallStatus,
  ToolKind,
  StopReason,
} from '@agentclientprotocol/sdk';

export type RuntimeStatus =
  | 'initializing'
  | 'ready'
  | 'active'
  | 'initialization_failed'
  | 'deleting'
  | 'delete_failed';

export interface ProfileCatalogEntry {
  id: string;
  revision: string;
  title: string;
  description: string;
}

export interface DatasetCatalogEntry {
  id: string;
  title: string;
  description: string;
  ontologySha256: string;
}

export interface RuntimeProject {
  id: string;
  displayName: string;
  createdAt?: string;
  status: RuntimeStatus;
  profile: {
    id: string;
    revision: string;
    title?: string;
    description?: string;
  };
  dataset: {
    id: string;
    title?: string;
    description?: string;
    ontologySha256: string;
  };
  /** Derived by the server from the current source catalogs; never persisted. */
  stale: boolean;
  lastError?: {
    code?: string;
    message: string;
  };
  /** Same-origin WebSocket URL published by the loopback Runtime Bridge. */
  url: string;
  /**
   * ACP requires a cwd field. Runtime v1 owns the real workspace path, so the
   * browser sends only this fixed logical value and never receives a host path.
   */
  cwd: '.';
}

export interface SavedSession {
  id: string;
  runtimeId: string;
  sessionId: string;
  title: string;
  lastUpdated: number;
  cwd: string;
  supportsLoadSession?: boolean; // Whether the agent supports session/load
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thought?: string;
  timestamp?: number;
  /**
   * Browser-observed completion metadata for a live prompt. ACP history does
   * not currently provide authoritative turn timing, so replayed messages
   * intentionally omit these fields.
   */
  completedAt?: number;
  durationMs?: number;
  finishReason?: StopReason;
  toolCalls?: ToolCallInfo[];
  plan?: PlanEntry[];
}

export interface ToolCallInfo {
  toolCallId: string;
  title: string;
  kind: ToolKind;
  status: ToolCallStatus;
  locations?: ToolCallLocation[];
  rawInput?: unknown;
  rawOutput?: unknown;
  content?: ToolCallContent[];
  /**
   * Client-observed timestamps for the live stream. Replayed ACP history does
   * not contain canonical timing data, so these must not be treated as
   * durable agent-side timings.
   */
  startedAt?: number;
  finishedAt?: number;
  timingUnavailable?: boolean;
}

export interface PermissionRequest {
  sessionId: string;
  toolCall: ToolCallInfo;
  options: PermissionOption[];
}

export interface PermissionOption {
  kind: string;
  name: string;
  optionId: string;
}
