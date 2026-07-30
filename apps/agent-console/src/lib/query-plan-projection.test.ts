import { describe, expect, it } from 'vitest';
import {
  MAX_QUERY_PLAN_NODES,
  projectQueryPlan,
} from './query-plan-projection';

function plan(tasks: unknown[]): string {
  return JSON.stringify({
    schema_version: 'data-query-plan.v1',
    keywords: ['must not become a node'],
    query_tasks: tasks,
    assumptions: ['must stay in JSON only'],
  });
}

describe('projectQueryPlan', () => {
  it('merges entities, preserves roles, and projects all supported relations', () => {
    const projection = projectQueryPlan(
      plan([
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
      ]),
    );

    expect(projection.available).toBe(true);
    if (!projection.available) return;
    expect(projection.nodes).toHaveLength(6);
    expect(projection.edges.map((edge) => edge.kind)).toEqual([
      'target',
      'projection',
      'filter',
      'join',
      'evidence',
    ]);
    const sensor = projection.nodes.find(
      (node) => node.label === 'TemperatureSensor',
    );
    expect(sensor?.roles).toEqual(['evidence', 'join', 'target']);
    expect(projection.nodes.some((node) => node.label.includes('must not'))).toBe(
      false,
    );
    expect(projection.tasks[0].filters[0]).toContain('"status"');
  });

  it('disables Graph for the wrong schema, empty tasks, or unsupported fields', () => {
    expect(projectQueryPlan('{"schema_version":"other"}')).toMatchObject({
      available: false,
    });
    expect(projectQueryPlan(plan([]))).toMatchObject({
      available: false,
      reason: expect.stringContaining('at least one'),
    });
    expect(
      projectQueryPlan(
        plan([
          {
            targets: 'not-an-array',
            filters: [],
            projections: [],
            joins: [],
            ontology_evidence: [],
          },
        ]),
      ),
    ).toMatchObject({
      available: false,
      reason: expect.stringContaining('unsupported'),
    });
  });

  it('enforces the bounded in-memory graph projection', () => {
    const filters = Array.from(
      { length: MAX_QUERY_PLAN_NODES },
      (_, index) => `filter-${index}`,
    );
    expect(
      projectQueryPlan(
        plan([
          {
            targets: [],
            filters,
            projections: [],
            joins: [],
            ontology_evidence: [],
          },
        ]),
      ),
    ).toEqual({
      available: false,
      reason: expect.stringContaining(String(MAX_QUERY_PLAN_NODES)),
    });
  });
});
