// Types for ACP UI application
import type {
  PlanEntry,
  ToolCallContent,
  ToolCallLocation,
  ToolCallStatus,
  ToolKind,
  StopReason,
} from '@agentclientprotocol/sdk';

export interface AgentConfig {
  /** Same-origin WebSocket URL published by the loopback ACP Bridge. */
  url?: string;
  id?: string;
  title?: string;
  description?: string;
  revision?: string;
  status?: string;
  cwd?: string;
  /** Sanitized Profile metadata exposed by the loopback Bridge. */
  model?: {
    id: string;
    source: 'opencode' | 'profile';
  };
  retrieval?: {
    vectorTopK: number;
    graphAlgorithm: string;
  };
  ontology?: {
    id: string;
  };
}

export interface AgentsConfig {
  agents: Record<string, AgentConfig>;
}

export interface SavedSession {
  id: string;
  agentName: string;
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
