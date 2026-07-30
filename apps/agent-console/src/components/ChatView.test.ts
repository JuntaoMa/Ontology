// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { nextTick, reactive } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../lib/types';

let mockSessionStore: ReturnType<typeof createSessionStore>;
let mockConfigStore: ReturnType<typeof createConfigStore>;

vi.mock('../stores/session', () => ({
  useSessionStore: () => mockSessionStore,
}));

vi.mock('../stores/config', () => ({
  useConfigStore: () => mockConfigStore,
}));

import ChatView from './ChatView.vue';

function createSessionStore() {
  return reactive({
    messageList: [] as ChatMessage[],
    isLoading: false,
    isPrompting: false,
    isConnected: true,
    isReconnecting: false,
    isCurrentProfileBusyElsewhere: false,
    currentSession: {
      id: 'direct-context:session-1',
      agentName: 'direct-context',
      sessionId: 'session-1',
      title: 'Example conversation',
      lastUpdated: 1,
      cwd: '/workspace',
    },
    sendPrompt: vi.fn(async (_text: string) => {}),
    cancelOperation: vi.fn(async () => {}),
  });
}

function createConfigStore() {
  return {
    getAgent: vi.fn(() => ({
      title: 'Direct context',
    })),
  };
}

beforeEach(() => {
  mockSessionStore = createSessionStore();
  mockConfigStore = createConfigStore();
});

describe('ChatView', () => {
  it('uses native disclosures for plans and model thinking', async () => {
    mockSessionStore.messageList.push({
      id: 'assistant-1',
      role: 'assistant',
      content: 'Done.',
      thought: 'Inspect the ontology candidates.',
      plan: [
        {
          content: 'Resolve entities',
          priority: 'high',
          status: 'in_progress',
        },
      ],
    });
    const wrapper = mount(ChatView, {
      props: { sidebarCollapsed: false },
    });

    const plan = wrapper.get('details.plan-section');
    const thought = wrapper.get('details.thought-section');
    expect(plan.attributes('open')).toBeUndefined();
    expect(thought.attributes('open')).toBeUndefined();
    expect(plan.get('summary').text()).toContain('Agent plan');
    expect(thought.get('summary').text()).toContain('Thinking');
    expect(thought.get('.thought-content').text()).toContain(
      'Inspect the ontology candidates.',
    );
  });

  it('does not pull the reader away from older messages', async () => {
    const wrapper = mount(ChatView, {
      props: { sidebarCollapsed: false },
    });
    const thread = wrapper.get<HTMLElement>('.thread');
    let scrollHeight = 1_000;
    Object.defineProperty(thread.element, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(thread.element, 'clientHeight', {
      configurable: true,
      get: () => 400,
    });

    thread.element.scrollTop = 100;
    await thread.trigger('scroll');
    mockSessionStore.messageList.push({
      id: 'assistant-older',
      role: 'assistant',
      content: 'Streaming while the reader is above.',
    });
    await nextTick();
    await nextTick();
    expect(thread.element.scrollTop).toBe(100);

    thread.element.scrollTop = 550;
    await thread.trigger('scroll');
    scrollHeight = 1_200;
    mockSessionStore.messageList.push({
      id: 'assistant-latest',
      role: 'assistant',
      content: 'Follow the latest response.',
    });
    await nextTick();
    await nextTick();
    expect(thread.element.scrollTop).toBe(1_200);
  });

  it('sends Enter and keeps Shift+Enter for multiline input', async () => {
    const wrapper = mount(ChatView, {
      props: { sidebarCollapsed: false },
    });
    const input = wrapper.get('textarea');

    await input.setValue('first line');
    await input.trigger('keydown', { key: 'Enter', shiftKey: true });
    expect(mockSessionStore.sendPrompt).not.toHaveBeenCalled();

    await input.trigger('keydown', { key: 'Enter' });
    expect(mockSessionStore.sendPrompt).toHaveBeenCalledWith('first line');
  });
});
