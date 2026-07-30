import { describe, expect, it } from 'vitest';
import type { SavedSession } from './types';
import {
  applyProjectionUpdate,
  restoreProjection,
  snapshotProjection,
  type SessionProjection,
} from './session-projection';

function projection(
  overrides: Partial<SessionProjection> = {},
): SessionProjection {
  const session: SavedSession = {
    id: 'direct:session-1',
    runtimeId: 'direct',
    sessionId: 'session-1',
    title: 'Original',
    lastUpdated: 1,
    cwd: '.',
    supportsLoadSession: true,
  };
  return {
    session,
    messages: [],
    replayingHistory: false,
    replayLastUpdateAt: 0,
    ...overrides,
  };
}

describe('ACP Session projection', () => {
  it('keeps tool state in the assistant message and updates it in place', () => {
    const state = projection();

    applyProjectionUpdate(state, {
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-1',
        title: 'Query ontology',
        kind: 'execute',
        status: 'in_progress',
        rawInput: { anchors: ['Cell'] },
      },
    });
    applyProjectionUpdate(state, {
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-1',
        status: 'completed',
        rawOutput: { rows: 5 },
      },
    });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].toolCalls).toHaveLength(1);
    expect(state.messages[0].toolCalls?.[0]).toMatchObject({
      toolCallId: 'tool-1',
      title: 'Query ontology',
      status: 'completed',
      rawInput: { anchors: ['Cell'] },
      rawOutput: { rows: 5 },
    });
  });

  it('does not invent timestamps while replaying history', () => {
    const state = projection({ replayingHistory: true });

    applyProjectionUpdate(state, {
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'historical answer' },
      },
    });
    applyProjectionUpdate(state, {
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-history',
        title: 'Historical query',
        status: 'completed',
      },
    });

    expect(state.messages[0].timestamp).toBeUndefined();
    expect(state.messages[0].toolCalls?.[0]).toMatchObject({
      timingUnavailable: true,
      startedAt: undefined,
      finishedAt: undefined,
    });
    expect(state.replayLastUpdateAt).toBeGreaterThan(0);
  });

  it('restores the readable projection after a failed history load', () => {
    const state = projection({
      messages: [
        {
          id: 'message-1',
          role: 'assistant',
          content: 'answer to keep',
          timestamp: 10,
        },
      ],
    });
    const snapshot = snapshotProjection(state);

    state.messages.splice(0, state.messages.length, {
      id: 'partial',
      role: 'assistant',
      content: 'partial replay',
    });
    state.session.title = 'Partial';
    state.session.lastUpdated = 99;
    restoreProjection(state, snapshot);

    expect(state.messages).toEqual(snapshot.messages);
    expect(state.session).toMatchObject({
      title: 'Original',
      lastUpdated: 1,
    });
  });
});
