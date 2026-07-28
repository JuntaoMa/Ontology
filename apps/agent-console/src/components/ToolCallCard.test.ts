// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ToolCallCard from './ToolCallCard.vue';

describe('ToolCallCard', () => {
  it('renders collapsible I/O and a bounded ontology subgraph', () => {
    const wrapper = mount(ToolCallCard, {
      props: {
        toolCall: {
          toolCallId: 'tool-ui',
          title: 'Retrieve ontology',
          kind: 'execute',
          status: 'completed',
          rawInput: { query: 'AMF' },
          rawOutput: {
            output: 'ONTOLOGY_ARTIFACT: {"schema_version":1,"kind":"ontology.subgraph","nodes":[{"id":"amf","label":"AMF","anchor":true},{"id":"slice","label":"Slice"}],"edges":[{"source":"amf","target":"slice","label":"supports"}],"metadata":{"algorithm":"minimum_connected_subgraph"}}',
          },
          startedAt: 1_000,
          finishedAt: 1_625,
        },
      },
    });

    expect(wrapper.findAll('details')).toHaveLength(3);
    expect(wrapper.text()).toContain('625 ms');
    expect(wrapper.find('svg[role="img"]').exists()).toBe(true);
    expect(wrapper.findAll('g.node')).toHaveLength(2);
    expect(wrapper.findAll('.edges line')).toHaveLength(1);
  });
});
