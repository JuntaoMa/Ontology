import type { SessionNotification } from '@agentclientprotocol/sdk';
import type { ChatMessage, SavedSession, ToolCallInfo } from './types';
import { applyToolCallUpdate, createToolCallInfo } from './tool-call';

export interface SessionProjection {
  session: SavedSession;
  messages: ChatMessage[];
  replayingHistory: boolean;
  replayLastUpdateAt: number;
}

export interface ProjectionSnapshot {
  messages: ChatMessage[];
  title: string;
  lastUpdated: number;
}

export function snapshotProjection(
  conversation: SessionProjection,
): ProjectionSnapshot {
  return {
    messages: [...conversation.messages],
    title: conversation.session.title,
    lastUpdated: conversation.session.lastUpdated,
  };
}

export function restoreProjection(
  conversation: SessionProjection,
  snapshot: ProjectionSnapshot,
): void {
  conversation.messages.splice(
    0,
    conversation.messages.length,
    ...snapshot.messages,
  );
  conversation.session.title = snapshot.title;
  conversation.session.lastUpdated = snapshot.lastUpdated;
}

/**
 * Merge one ACP notification into the in-page conversation projection.
 *
 * Returns true when Session metadata changed and the catalog should be
 * synchronized. Unrecognized updates remain protocol-visible but do not
 * create a second frontend event model.
 */
export function applyProjectionUpdate(
  conversation: SessionProjection,
  notification: SessionNotification,
): boolean {
  if (conversation.replayingHistory) {
    conversation.replayLastUpdateAt = Date.now();
  }

  const update = notification.update;
  switch (update.sessionUpdate) {
    case 'user_message_chunk':
      appendMessageChunk(
        conversation,
        'user',
        update.content.type === 'text' ? update.content.text : '',
      );
      return false;

    case 'agent_message_chunk':
      appendMessageChunk(
        conversation,
        'assistant',
        update.content.type === 'text' ? update.content.text : '',
      );
      return false;

    case 'agent_thought_chunk': {
      const assistant = ensureAssistantMessage(conversation);
      if (update.content.type === 'text') {
        assistant.thought = (assistant.thought ?? '') + update.content.text;
      }
      return false;
    }

    case 'plan': {
      const assistant = ensureAssistantMessage(conversation);
      assistant.plan = update.entries.map((entry) => ({ ...entry }));
      return false;
    }

    case 'tool_call':
    case 'tool_call_update': {
      const observedAt = conversation.replayingHistory ? null : Date.now();
      let toolCall = findToolCall(conversation.messages, update.toolCallId);
      if (toolCall) {
        applyToolCallUpdate(toolCall, update, observedAt);
      } else {
        toolCall = createToolCallInfo(update, observedAt);
        const assistant = ensureAssistantMessage(conversation);
        assistant.toolCalls ??= [];
        assistant.toolCalls.push(toolCall);
      }
      return false;
    }

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
      return true;
    }

    default:
      return false;
  }
}

function appendMessageChunk(
  conversation: SessionProjection,
  role: 'user' | 'assistant',
  text: string,
): void {
  const last = conversation.messages[conversation.messages.length - 1];
  if (last?.role === role) {
    last.content += text;
    return;
  }

  conversation.messages.push({
    id: crypto.randomUUID(),
    role,
    content: text,
    timestamp: conversation.replayingHistory ? undefined : Date.now(),
    ...(role === 'assistant' ? { toolCalls: [] } : {}),
  });
}

function ensureAssistantMessage(
  conversation: SessionProjection,
): ChatMessage {
  const last = conversation.messages[conversation.messages.length - 1];
  if (last?.role === 'assistant') {
    last.toolCalls ??= [];
    return last;
  }

  const assistant: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: '',
    timestamp: conversation.replayingHistory ? undefined : Date.now(),
    toolCalls: [],
  };
  conversation.messages.push(assistant);
  return assistant;
}

function findToolCall(
  messages: ChatMessage[],
  toolCallId: string,
): ToolCallInfo | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const found = messages[index].toolCalls?.find(
      (toolCall) => toolCall.toolCallId === toolCallId,
    );
    if (found) return found;
  }
  return undefined;
}
