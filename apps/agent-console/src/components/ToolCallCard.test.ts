// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ToolCallCard from './ToolCallCard.vue';

describe('ToolCallCard', () => {
  it('renders a collapsed card with I/O, timing, and a bounded ontology subgraph', () => {
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

    expect(wrapper.get('details.tool-call-card').attributes('open')).toBeUndefined();
    expect(wrapper.findAll('.tool-details > details')).toHaveLength(2);
    expect(wrapper.text()).toContain('625 ms');
    expect(wrapper.text()).not.toContain('ACP content');
    expect(wrapper.get('.tool-title').attributes('title')).toBe(
      'Retrieve ontology',
    );
    expect(wrapper.get('.kind-icon').attributes('data-icon')).toBe('terminal');
    expect(wrapper.find('svg[role="img"]').exists()).toBe(true);
    expect(wrapper.findAll('g.node')).toHaveLength(2);
    expect(wrapper.findAll('.edges line')).toHaveLength(1);
  });

  it('keeps ACP content available for artifact parsing without rendering it', () => {
    const wrapper = mount(ToolCallCard, {
      props: {
        toolCall: {
          toolCallId: 'tool-content-artifact',
          title: 'Search ontology',
          kind: 'search',
          status: 'completed',
          content: [
            {
              type: 'content',
              content: {
                type: 'text',
                text: 'ONTOLOGY_ARTIFACT: {"schema_version":1,"kind":"ontology.subgraph","nodes":[{"id":"room","label":"Room"}],"edges":[]}',
              },
            },
          ],
        },
      },
    });

    expect(wrapper.text()).not.toContain('ACP content');
    expect(wrapper.find('svg[role="img"]').exists()).toBe(true);
    expect(wrapper.get('.kind-icon').attributes('data-icon')).toBe('tool');
  });

  it.each([
    ['Loaded skill: ontology-retrieval', 'other', 'skill'],
    ['Run retrieval command', 'execute', 'terminal'],
    ['Think through candidates', 'think', 'thought'],
    ['Search ontology', 'search', 'tool'],
  ] as const)(
    'uses a semantic icon for %s',
    (title, kind, expectedIcon) => {
      const wrapper = mount(ToolCallCard, {
        props: {
          toolCall: {
            toolCallId: `${kind}-${expectedIcon}`,
            title,
            kind,
            status: 'completed',
          },
        },
      });

      expect(wrapper.get('.kind-icon').attributes('data-icon')).toBe(
        expectedIcon,
      );
    },
  );
});
