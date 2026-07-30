export const MAX_QUERY_PLAN_NODES = 120;
export const MAX_QUERY_PLAN_EDGES = 240;

export type QueryPlanNodeKind = 'task' | 'entity' | 'filter';
export type QueryPlanEdgeKind =
  | 'target'
  | 'projection'
  | 'filter'
  | 'join'
  | 'evidence';

export interface QueryPlanNode {
  id: string;
  label: string;
  kind: QueryPlanNodeKind;
  roles: string[];
}

export interface QueryPlanEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  kind: QueryPlanEdgeKind;
}

export interface QueryPlanTaskAnnotation {
  id: string;
  title: string;
  targets: string[];
  projections: string[];
  filters: string[];
  joins: string[];
  evidence: string[];
}

export type QueryPlanProjection =
  | {
      available: true;
      nodes: QueryPlanNode[];
      edges: QueryPlanEdge[];
      tasks: QueryPlanTaskAnnotation[];
    }
  | {
      available: false;
      reason: string;
    };

interface MutableEntityNode {
  id: string;
  label: string;
  kind: 'entity';
  roles: Set<string>;
}

/**
 * Create a read-only display projection of data-query-plan.v1.
 *
 * This intentionally performs no ontology lookup, validation, inference or
 * repair. Invalid/unsupported output keeps its JSON view and disables Graph.
 */
export function projectQueryPlan(source: string): QueryPlanProjection {
  let root: unknown;
  try {
    root = JSON.parse(source);
  } catch {
    return unavailable('Graph requires a complete JSON document.');
  }
  if (!isRecord(root) || root.schema_version !== 'data-query-plan.v1') {
    return unavailable('Graph is available only for data-query-plan.v1.');
  }
  if (!Array.isArray(root.query_tasks) || root.query_tasks.length === 0) {
    return unavailable('Graph requires at least one valid query task.');
  }
  if (root.query_tasks.length > MAX_QUERY_PLAN_NODES) {
    return nodeLimit();
  }

  const fixedNodes: QueryPlanNode[] = [];
  const entities = new Map<string, MutableEntityNode>();
  const edges: QueryPlanEdge[] = [];
  const tasks: QueryPlanTaskAnnotation[] = [];

  const entity = (label: string, role: string): MutableEntityNode => {
    let node = entities.get(label);
    if (!node) {
      node = {
        id: `entity:${entities.size}`,
        label,
        kind: 'entity',
        roles: new Set(),
      };
      entities.set(label, node);
    }
    node.roles.add(role);
    return node;
  };

  const addEdge = (
    source: string,
    target: string,
    label: string,
    kind: QueryPlanEdgeKind,
  ): void => {
    edges.push({
      id: `edge:${edges.length}`,
      source,
      target,
      label,
      kind,
    });
  };

  for (let taskIndex = 0; taskIndex < root.query_tasks.length; taskIndex += 1) {
    const value = root.query_tasks[taskIndex];
    if (!isRecord(value)) return unsupported(taskIndex);
    if (
      arrayExceedsEdgeLimit(value.targets) ||
      arrayExceedsEdgeLimit(value.filters) ||
      arrayExceedsEdgeLimit(value.projections) ||
      arrayExceedsEdgeLimit(value.joins) ||
      arrayExceedsEdgeLimit(value.ontology_evidence)
    ) {
      return edgeLimit();
    }

    const targets = stringArray(value.targets);
    const projections = stringArray(value.projections);
    if (
      targets === null ||
      projections === null ||
      !Array.isArray(value.filters) ||
      !Array.isArray(value.joins) ||
      !Array.isArray(value.ontology_evidence)
    ) {
      return unsupported(taskIndex);
    }

    const taskId = `task:${taskIndex}`;
    fixedNodes.push({
      id: taskId,
      label: `Task ${taskIndex + 1}`,
      kind: 'task',
      roles: ['task'],
    });

    for (const target of targets) {
      const targetNode = entity(target, 'target');
      addEdge(taskId, targetNode.id, 'target', 'target');
      const limit = currentLimit(fixedNodes.length + entities.size, edges.length);
      if (limit) return limit;
    }
    for (const projection of projections) {
      const projectionNode = entity(projection, 'projection');
      addEdge(taskId, projectionNode.id, 'projection', 'projection');
      const limit = currentLimit(fixedNodes.length + entities.size, edges.length);
      if (limit) return limit;
    }

    const filterSummaries: string[] = [];
    for (let filterIndex = 0; filterIndex < value.filters.length; filterIndex += 1) {
      const summary = summarizeJson(value.filters[filterIndex]);
      if (summary === null) return unsupported(taskIndex);
      filterSummaries.push(summary);
      const filterId = `filter:${taskIndex}:${filterIndex}`;
      fixedNodes.push({
        id: filterId,
        label: summary,
        kind: 'filter',
        roles: ['filter'],
      });
      addEdge(taskId, filterId, 'filter', 'filter');
      const limit = currentLimit(fixedNodes.length + entities.size, edges.length);
      if (limit) return limit;
    }

    const joinSummaries: string[] = [];
    for (const join of value.joins) {
      if (!isRecord(join)) return unsupported(taskIndex);
      const from = nonEmptyString(join.from);
      const relation = nonEmptyString(join.relation);
      const to = nonEmptyString(join.to);
      if (!from || !relation || !to) return unsupported(taskIndex);
      const source = entity(from, 'join');
      const target = entity(to, 'join');
      addEdge(source.id, target.id, relation, 'join');
      joinSummaries.push(`${from} —${relation}→ ${to}`);
      const limit = currentLimit(fixedNodes.length + entities.size, edges.length);
      if (limit) return limit;
    }

    const evidenceSummaries: string[] = [];
    for (const evidence of value.ontology_evidence) {
      if (!isRecord(evidence)) return unsupported(taskIndex);
      const subject = nonEmptyString(evidence.subject);
      const predicate = nonEmptyString(evidence.predicate);
      const object = nonEmptyString(evidence.object);
      if (!subject || !predicate || !object) return unsupported(taskIndex);
      const source = entity(subject, 'evidence');
      const target = entity(object, 'evidence');
      addEdge(source.id, target.id, predicate, 'evidence');
      evidenceSummaries.push(`${subject} —${predicate}→ ${object}`);
      const limit = currentLimit(fixedNodes.length + entities.size, edges.length);
      if (limit) return limit;
    }

    tasks.push({
      id: taskId,
      title: `Task ${taskIndex + 1}`,
      targets,
      projections,
      filters: filterSummaries,
      joins: joinSummaries,
      evidence: evidenceSummaries,
    });

  }

  const entityNodes: QueryPlanNode[] = Array.from(entities.values()).map(
    (node) => ({
      id: node.id,
      label: node.label,
      kind: node.kind,
      roles: [...node.roles].sort(),
    }),
  );
  return {
    available: true,
    nodes: [...fixedNodes, ...entityNodes],
    edges,
    tasks,
  };
}

function unsupported(taskIndex: number): QueryPlanProjection {
  return unavailable(
    `Graph cannot display unsupported fields in Task ${taskIndex + 1}.`,
  );
}

function unavailable(reason: string): QueryPlanProjection {
  return { available: false, reason };
}

function currentLimit(
  nodeCount: number,
  edgeCount: number,
): QueryPlanProjection | null {
  if (nodeCount > MAX_QUERY_PLAN_NODES) return nodeLimit();
  if (edgeCount > MAX_QUERY_PLAN_EDGES) return edgeLimit();
  return null;
}

function nodeLimit(): QueryPlanProjection {
  return unavailable(
    `Graph is disabled above ${MAX_QUERY_PLAN_NODES} nodes.`,
  );
}

function edgeLimit(): QueryPlanProjection {
  return unavailable(
    `Graph is disabled above ${MAX_QUERY_PLAN_EDGES} edges.`,
  );
}

function arrayExceedsEdgeLimit(value: unknown): boolean {
  return Array.isArray(value) && value.length > MAX_QUERY_PLAN_EDGES;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const values: string[] = [];
  for (const item of value) {
    const normalized = nonEmptyString(item);
    if (!normalized) return null;
    values.push(normalized);
  }
  return values;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 1_000
    ? normalized
    : null;
}

function summarizeJson(value: unknown): string | null {
  if (typeof value === 'string') return nonEmptyString(value);
  try {
    const summary = JSON.stringify(value);
    if (summary === undefined) return null;
    return summary.length > 240 ? `${summary.slice(0, 239)}…` : summary;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
