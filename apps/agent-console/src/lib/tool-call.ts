import type { ToolCall, ToolCallStatus, ToolCallUpdate } from '@agentclientprotocol/sdk';
import type { ToolCallInfo } from './types';

type ToolCallPayload = ToolCall | ToolCallUpdate;

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function isTerminalToolStatus(status: ToolCallStatus): boolean {
  return status === 'completed' || status === 'failed';
}

/**
 * Convert an ACP tool event into the UI's lossless live representation.
 */
export function createToolCallInfo(
  update: ToolCallPayload,
  observedAt: number | null = Date.now(),
): ToolCallInfo {
  const status = update.status ?? 'pending';

  return {
    toolCallId: update.toolCallId,
    title: update.title ?? 'Tool call',
    kind: update.kind ?? 'other',
    status,
    locations: update.locations ?? undefined,
    rawInput: hasOwn(update, 'rawInput') ? update.rawInput : undefined,
    rawOutput: hasOwn(update, 'rawOutput') ? update.rawOutput : undefined,
    content: update.content ?? undefined,
    startedAt: observedAt ?? undefined,
    finishedAt: isTerminalToolStatus(status) ? (observedAt ?? undefined) : undefined,
    timingUnavailable: observedAt === null || undefined,
  };
}

/**
 * Apply ACP replacement semantics to an existing tool call.
 *
 * `content` and `locations` replace their previous collections when present.
 * Raw values are retained exactly, including explicit `null`.
 */
export function applyToolCallUpdate(
  target: ToolCallInfo,
  update: ToolCallPayload,
  observedAt: number | null = Date.now(),
): ToolCallInfo {
  if (update.title != null) target.title = update.title;
  if (update.kind != null) target.kind = update.kind;
  if (update.status != null) {
    target.status = update.status;
    if (isTerminalToolStatus(update.status)) {
      target.finishedAt ??= observedAt ?? undefined;
    } else {
      target.finishedAt = undefined;
    }
  }
  if (hasOwn(update, 'locations')) {
    target.locations = update.locations ?? undefined;
  }
  if (hasOwn(update, 'content')) {
    target.content = update.content ?? undefined;
  }
  if (hasOwn(update, 'rawInput')) {
    target.rawInput = update.rawInput;
  }
  if (hasOwn(update, 'rawOutput')) {
    target.rawOutput = update.rawOutput;
  }

  target.startedAt ??= observedAt ?? undefined;
  if (observedAt === null && target.startedAt === undefined) {
    target.timingUnavailable = true;
  }
  return target;
}
