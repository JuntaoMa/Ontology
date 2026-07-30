// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import QueryPlanCard from './QueryPlanCard.vue';

const validPlan = JSON.stringify({
  schema_version: 'data-query-plan.v1',
  query_tasks: [
    {
      targets: ['TemperatureSensor'],
      filters: [{ field: 'status', operator: 'eq', value: 'active' }],
      projections: ['Building'],
      joins: [
        {
          from: 'TemperatureSensor',
          relation: 'locatedIn',
          to: 'Room',
        },
      ],
      ontology_evidence: [
        {
          subject: 'TemperatureSensor',
          predicate: 'subClassOf',
          object: 'Sensor',
        },
      ],
    },
  ],
});

describe('QueryPlanCard', () => {
  it('keeps JSON as the default and shows an in-memory Graph projection', async () => {
    const wrapper = mount(QueryPlanCard, {
      props: { formattedJson: validPlan },
    });
    const tabs = wrapper.findAll('[role="tab"]');

    expect(tabs[0].attributes('aria-selected')).toBe('true');
    expect(wrapper.get('code.language-json').text()).toContain(
      '"schema_version"',
    );
    await tabs[1].trigger('click');

    expect(tabs[1].attributes('aria-selected')).toBe('true');
    expect(wrapper.get('svg.query-graph-svg').attributes('aria-label')).toContain(
      'nodes',
    );
    expect(wrapper.text()).toContain('Task 1 annotations');
  });

  it('keeps JSON available and disables Graph for unsupported output', () => {
    const wrapper = mount(QueryPlanCard, {
      props: {
        formattedJson: '{"schema_version":"other","query_tasks":[]}',
      },
    });
    const graphTab = wrapper.findAll('[role="tab"]')[1];

    expect(graphTab.attributes()).toHaveProperty('disabled');
    expect(wrapper.get('code.language-json').text()).toContain(
      '"schema_version"',
    );
    expect(wrapper.text()).toContain('data-query-plan.v1');
  });
});
