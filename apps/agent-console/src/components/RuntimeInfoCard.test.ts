// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import RuntimeInfoCard from './RuntimeInfoCard.vue';

describe('RuntimeInfoCard', () => {
  it('shows redacted Runtime facts and exposes only the dangerous delete action', async () => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const wrapper = mount(RuntimeInfoCard, {
      props: {
        project: {
          id: 'direct--sample',
          displayName: 'Direct · Sample',
          createdAt: '2026-07-30T10:00:00.000Z',
          status: 'delete_failed',
          profile: { id: 'direct', revision: 'v1' },
          dataset: { id: 'sample', ontologySha256: 'a'.repeat(64) },
          stale: false,
          lastError: {
            code: 'delete_interrupted',
            message: 'The Runtime operation failed.',
          },
          url: 'ws://127.0.0.1/runtimes/direct--sample/acp',
          cwd: '.',
        },
        profileTitle: 'Direct context',
        profileDescription: 'Full ontology context.',
        datasetTitle: 'Sample building',
        statusLabel: 'Delete failed',
        anchor,
      },
      global: {
        stubs: { Teleport: true },
      },
    });

    expect(wrapper.text()).toContain('Direct context');
    expect(wrapper.text()).toContain('Sample building');
    expect(wrapper.text()).toContain('delete_interrupted');
    expect(wrapper.findAll('.danger-button')).toHaveLength(1);
    expect(wrapper.get('.danger-button').text()).toBe('Retry delete');

    await wrapper.get('.danger-button').trigger('click');
    expect(wrapper.emitted('delete')).toHaveLength(1);
    wrapper.unmount();
    anchor.remove();
  });
});
