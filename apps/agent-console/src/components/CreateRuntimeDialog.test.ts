// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import CreateRuntimeDialog from './CreateRuntimeDialog.vue';

const profiles = [
  {
    id: 'direct-context',
    revision: 'v1',
    title: 'Direct context',
    description: 'Full ontology context.',
  },
  {
    id: 'oag',
    revision: 'v2',
    title: 'OAG retrieval',
    description: 'Retriever-assisted context.',
  },
];

const datasets = [
  {
    id: 'sample',
    title: 'Sample building',
    description: 'Small public sample.',
    ontologySha256: 'a'.repeat(64),
  },
];

describe('CreateRuntimeDialog', () => {
  it('submits only the selected catalog IDs', async () => {
    const wrapper = mount(CreateRuntimeDialog, {
      props: { profiles, datasets, creating: false },
      global: {
        stubs: {
          ModalDialog: { template: '<div><slot /></div>' },
        },
      },
    });

    await wrapper.get('#runtime-profile').setValue('oag');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('create')).toEqual([['oag', 'sample']]);
    expect(wrapper.text()).toContain('Retriever-assisted context.');
    wrapper.unmount();
  });

  it('blocks creation when a catalog side is empty', () => {
    const wrapper = mount(CreateRuntimeDialog, {
      props: { profiles: [], datasets, creating: false },
      global: {
        stubs: {
          ModalDialog: { template: '<div><slot /></div>' },
        },
      },
    });

    expect(wrapper.get('button[type="submit"]').attributes()).toHaveProperty(
      'disabled',
    );
    expect(wrapper.text()).toContain('valid Profile and Dataset');
    wrapper.unmount();
  });

  it('offers only Profile and Dataset pairs without an existing Runtime', async () => {
    const wrapper = mount(CreateRuntimeDialog, {
      props: {
        profiles,
        datasets,
        existingRuntimeIds: ['direct-context--sample'],
        creating: false,
      },
      global: {
        stubs: {
          ModalDialog: { template: '<div><slot /></div>' },
        },
      },
    });

    expect(wrapper.get('#runtime-profile').element).toHaveProperty(
      'value',
      'oag',
    );
    expect(wrapper.findAll('#runtime-profile option')).toHaveLength(1);
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('create')).toEqual([['oag', 'sample']]);
    wrapper.unmount();
  });

  it('blocks creation when every Catalog pair already exists', () => {
    const wrapper = mount(CreateRuntimeDialog, {
      props: {
        profiles,
        datasets,
        existingRuntimeIds: [
          'direct-context--sample',
          'oag--sample',
        ],
        creating: false,
      },
      global: {
        stubs: {
          ModalDialog: { template: '<div><slot /></div>' },
        },
      },
    });

    expect(wrapper.get('button[type="submit"]').attributes()).toHaveProperty(
      'disabled',
    );
    expect(wrapper.text()).toContain(
      'Every Profile and Dataset combination already has',
    );
    wrapper.unmount();
  });
});
