import { describe, expect, it } from 'vitest';
import type { ToolCall, ToolCallUpdate } from '@agentclientprotocol/sdk';
import { applyToolCallUpdate, createToolCallInfo } from './tool-call';

describe('tool call state', () => {
  it('preserves ACP input, output, content, and observed start time', () => {
    const update: ToolCall = {
      toolCallId: 'tool-1',
      title: 'Query ontology',
      kind: 'execute',
      status: 'in_progress',
      rawInput: { anchors: ['Cell'] },
      rawOutput: { output: 'starting' },
      content: [
        {
          type: 'content',
          content: { type: 'text', text: 'running' },
        },
      ],
    };

    const toolCall = createToolCallInfo(update, 1_000);

    expect(toolCall).toMatchObject({
      toolCallId: 'tool-1',
      rawInput: { anchors: ['Cell'] },
      rawOutput: { output: 'starting' },
      startedAt: 1_000,
    });
    expect(toolCall.content).toEqual(update.content);
    expect(toolCall.finishedAt).toBeUndefined();
  });

  it('applies ACP replacement semantics and records terminal time', () => {
    const toolCall = createToolCallInfo({
      toolCallId: 'tool-2',
      title: 'Retrieve',
      status: 'in_progress',
      locations: [{ path: '/tmp/input.ttl' }],
      content: [
        {
          type: 'content',
          content: { type: 'text', text: 'partial' },
        },
      ],
    }, 2_000);
    const update: ToolCallUpdate = {
      toolCallId: 'tool-2',
      status: 'completed',
      locations: null,
      content: null,
      rawOutput: null,
    };

    applyToolCallUpdate(toolCall, update, 2_750);

    expect(toolCall.status).toBe('completed');
    expect(toolCall.locations).toBeUndefined();
    expect(toolCall.content).toBeUndefined();
    expect(toolCall.rawOutput).toBeNull();
    expect(toolCall.startedAt).toBe(2_000);
    expect(toolCall.finishedAt).toBe(2_750);
  });

  it('does not discard prior fields when a partial update omits them', () => {
    const toolCall = createToolCallInfo({
      toolCallId: 'tool-3',
      title: 'Search',
      rawInput: { query: 'AMF' },
      status: 'pending',
    }, 3_000);

    applyToolCallUpdate(toolCall, {
      toolCallId: 'tool-3',
      status: 'in_progress',
    }, 3_100);

    expect(toolCall.rawInput).toEqual({ query: 'AMF' });
    expect(toolCall.title).toBe('Search');
    expect(toolCall.finishedAt).toBeUndefined();
  });

  it('does not invent timing for replayed ACP history', () => {
    const toolCall = createToolCallInfo({
      toolCallId: 'tool-replayed',
      title: 'Historical query',
      status: 'completed',
    }, null);

    applyToolCallUpdate(toolCall, {
      toolCallId: 'tool-replayed',
      rawOutput: { rows: 5 },
    }, null);

    expect(toolCall.startedAt).toBeUndefined();
    expect(toolCall.finishedAt).toBeUndefined();
    expect(toolCall.timingUnavailable).toBe(true);
    expect(toolCall.rawOutput).toEqual({ rows: 5 });
  });
});
