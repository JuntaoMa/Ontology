// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCatalogStore } from '../stores/catalog';
import { useRuntimeStore } from '../stores/runtime';
import { useSessionStore } from '../stores/session';
import RuntimeSidebar from './RuntimeSidebar.vue';

describe('RuntimeSidebar', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useCatalogStore().updateFromEvent({
      profiles: [
        {
          id: 'direct',
          revision: 'v1',
          title: 'Direct context',
          description: 'Full ontology context.',
        },
      ],
      datasets: [
        {
          id: 'sample',
          title: 'Sample building',
          description: 'Small public sample.',
          ontologySha256: 'a'.repeat(64),
        },
      ],
    });
    useRuntimeStore().updateFromEvent([
      {
        id: 'direct--sample',
        displayName: 'Direct · Sample',
        status: 'initializing',
        profile: {
          id: 'direct',
          revision: 'v1',
          title: 'Direct context',
        },
        dataset: {
          id: 'sample',
          title: 'Sample building',
          ontologySha256: 'a'.repeat(64),
        },
        stale: false,
        url: 'ws://127.0.0.1/runtimes/direct--sample/acp',
        cwd: '.',
      },
    ]);
  });

  it('renders created projects as Profile titles with Dataset tags and state', () => {
    const wrapper = mount(RuntimeSidebar, {
      props: { collapsed: false, drawer: false },
    });

    expect(wrapper.get('.project-title').text()).toBe('Direct context');
    expect(wrapper.get('.dataset-tag').text()).toBe('Sample building');
    expect(wrapper.get('.project-state').text()).toContain('Initializing');
    expect(
      wrapper.get('.new-conversation').attributes(),
    ).toHaveProperty('disabled');
  });

  it('shows Session discovery errors, retries after project changes, and offers Retry', async () => {
    const runtimeStore = useRuntimeStore();
    const readyProject = {
      ...runtimeStore.projects[0],
      status: 'ready' as const,
    };
    runtimeStore.updateFromEvent([readyProject]);

    const sessionStore = useSessionStore();
    const discoveryError = ref<string | null>('temporary ACP failure');
    const refreshSessions = vi.fn(async () => {
      if (refreshSessions.mock.calls.length === 3) {
        discoveryError.value = null;
      }
    });
    sessionStore.refreshSessions = refreshSessions;
    sessionStore.runtimeErrorFor = vi.fn(() => discoveryError.value);

    const wrapper = mount(RuntimeSidebar, {
      props: { collapsed: false, drawer: false },
    });

    await vi.waitFor(() => {
      expect(refreshSessions).toHaveBeenCalledTimes(1);
      expect(wrapper.get('.session-discovery-error').text()).toContain(
        'temporary ACP failure',
      );
    });

    runtimeStore.updateFromEvent([
      {
        ...readyProject,
        status: 'active',
      },
    ]);
    await vi.waitFor(() => {
      expect(refreshSessions).toHaveBeenCalledTimes(2);
    });

    await wrapper.get('.session-discovery-error button').trigger('click');
    await vi.waitFor(() => {
      expect(refreshSessions).toHaveBeenCalledTimes(3);
      expect(wrapper.find('.session-discovery-error').exists()).toBe(false);
      expect(wrapper.get('.empty-project').text()).toContain(
        'No conversations yet',
      );
    });
  });
});
