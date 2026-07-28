export const ONTOLOGY_ARTIFACT_PREFIX = 'ONTOLOGY_ARTIFACT:';
export const MAX_ONTOLOGY_NODES = 80;
export const MAX_ONTOLOGY_EDGES = 160;

const MAX_ARTIFACT_TEXT_LENGTH = 1_000_000;
const MAX_SCAN_VALUES = 256;

export interface OntologyArtifactNode {
  id: string;
  label: string;
  kind?: string;
  anchor?: boolean;
}

export interface OntologyArtifactEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  kind?: string;
}

export interface OntologySubgraphArtifact {
  schema: 'ontology.artifact/v1';
  schemaVersion: 1;
  kind: 'ontology.subgraph';
  type: 'subgraph';
  title?: string;
  nodes: OntologyArtifactNode[];
  edges: OntologyArtifactEdge[];
  totalNodeCount: number;
  totalEdgeCount: number;
  truncated: boolean;
  renderable: boolean;
  algorithm?: string;
  durationMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizedString(value: unknown, maxLength = 500): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function normalizedNonNegativeNumber(value: unknown): number | undefined {
  const numberValue = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : undefined;
}

/**
 * Extract one balanced JSON object after a marker without assuming that it is
 * the last line of stdout. Braces inside JSON strings are handled correctly.
 */
function extractJsonObject(text: string, markerIndex: number): string | null {
  const objectStart = text.indexOf('{', markerIndex + ONTOLOGY_ARTIFACT_PREFIX.length);
  if (objectStart === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = objectStart; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(objectStart, index + 1);
      if (depth < 0) return null;
    }
  }

  return null;
}

function normalizeArtifact(value: unknown): OntologySubgraphArtifact | null {
  if (!isRecord(value)) return null;

  const schemaVersion = value.schema_version;
  const artifactKind = normalizedString(value.kind, 80);
  const schema = normalizedString(value.schema, 120);
  const rawType = normalizedString(value.type, 80);
  const usesDocumentedShape =
    schemaVersion === 1 &&
    artifactKind === 'ontology.subgraph';
  const usesLegacyShape =
    schema === 'ontology.artifact/v1' &&
    (rawType === 'subgraph' || rawType === 'ontology-subgraph');
  if (!usesDocumentedShape && !usesLegacyShape) return null;

  const data = isRecord(value.data) ? value.data : value;
  if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) return null;

  const metadata = isRecord(value.metadata)
    ? value.metadata
    : (isRecord(data.metadata) ? data.metadata : {});
  const anchorNodeIds = new Set(
    Array.isArray(metadata.anchor_nodes)
      ? metadata.anchor_nodes
        .map((item) => normalizedString(item, 200))
        .filter((item): item is string => Boolean(item))
      : [],
  );
  const totalNodeCount = Math.max(
    data.nodes.length,
    normalizedNonNegativeNumber(metadata.node_count) ?? 0,
  );
  const totalEdgeCount = Math.max(
    data.edges.length,
    normalizedNonNegativeNumber(metadata.edge_count) ?? 0,
  );
  const nodes: OntologyArtifactNode[] = [];
  const nodeIds = new Set<string>();

  for (const candidate of data.nodes) {
    if (nodes.length >= MAX_ONTOLOGY_NODES) break;
    if (!isRecord(candidate)) continue;

    const id = normalizedString(candidate.id, 200);
    if (!id || nodeIds.has(id)) continue;

    nodes.push({
      id,
      label: normalizedString(candidate.label ?? candidate.name, 500) ?? id,
      kind: normalizedString(candidate.kind ?? candidate.type, 120),
      anchor: candidate.anchor === true || anchorNodeIds.has(id),
    });
    nodeIds.add(id);
  }

  if (nodes.length === 0) return null;

  const edges: OntologyArtifactEdge[] = [];
  const edgeIds = new Set<string>();
  for (const candidate of data.edges) {
    if (edges.length >= MAX_ONTOLOGY_EDGES) break;
    if (!isRecord(candidate)) continue;

    const source = normalizedString(candidate.source, 200);
    const target = normalizedString(candidate.target, 200);
    if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) continue;

    const baseId =
      normalizedString(candidate.id, 200) ??
      `edge-${edges.length}-${source}-${target}`;
    let id = baseId;
    for (let suffix = 2; edgeIds.has(id); suffix += 1) {
      id = `${baseId}#${suffix}`;
    }
    edgeIds.add(id);
    edges.push({
      id,
      source,
      target,
      label: normalizedString(candidate.label ?? candidate.predicate, 500),
      kind: normalizedString(candidate.kind ?? candidate.type, 120),
    });
  }

  return {
    schema: 'ontology.artifact/v1',
    schemaVersion: 1,
    kind: 'ontology.subgraph',
    type: 'subgraph',
    title: normalizedString(value.title ?? data.title, 500),
    nodes,
    edges,
    totalNodeCount,
    totalEdgeCount,
    truncated:
      totalNodeCount > nodes.length ||
      totalEdgeCount > edges.length,
    renderable:
      totalNodeCount <= MAX_ONTOLOGY_NODES &&
      totalEdgeCount <= MAX_ONTOLOGY_EDGES,
    algorithm: normalizedString(metadata.algorithm, 120),
    durationMs: normalizedNonNegativeNumber(metadata.duration_ms),
  };
}

/**
 * Parse the first valid `ONTOLOGY_ARTIFACT:` JSON object found in a text
 * stream. Malformed or unsupported artifacts safely return `null`.
 */
export function parseOntologyArtifact(text: string): OntologySubgraphArtifact | null {
  if (!text || text.length > MAX_ARTIFACT_TEXT_LENGTH) return null;

  let markerIndex = text.indexOf(ONTOLOGY_ARTIFACT_PREFIX);
  while (markerIndex !== -1) {
    const json = extractJsonObject(text, markerIndex);
    if (json) {
      try {
        const artifact = normalizeArtifact(JSON.parse(json));
        if (artifact) return artifact;
      } catch {
        // Continue scanning in case a later marker contains a valid artifact.
      }
    }
    markerIndex = text.indexOf(
      ONTOLOGY_ARTIFACT_PREFIX,
      markerIndex + ONTOLOGY_ARTIFACT_PREFIX.length,
    );
  }

  return null;
}

/**
 * Search ACP raw output/content structures for a marker while limiting work
 * and handling cyclic objects. Only strings are parsed; arbitrary objects are
 * never treated as trusted graph data.
 */
export function findOntologyArtifact(
  ...values: unknown[]
): OntologySubgraphArtifact | null {
  const queue: unknown[] = values.slice(0, MAX_SCAN_VALUES);
  const seen = new WeakSet<object>();
  let scanned = 0;
  let cursor = 0;

  while (cursor < queue.length && scanned < MAX_SCAN_VALUES) {
    const value = queue[cursor];
    cursor += 1;
    scanned += 1;

    if (typeof value === 'string') {
      const artifact = parseOntologyArtifact(value);
      if (artifact) return artifact;
      continue;
    }

    if (typeof value !== 'object' || value === null || seen.has(value)) continue;
    seen.add(value);

    if (Array.isArray(value)) {
      for (
        let index = 0;
        index < value.length && queue.length < MAX_SCAN_VALUES;
        index += 1
      ) {
        queue.push(value[index]);
      }
    } else {
      const record = value as Record<string, unknown>;
      for (const key in record) {
        if (queue.length >= MAX_SCAN_VALUES) break;
        if (Object.prototype.hasOwnProperty.call(record, key)) {
          queue.push(record[key]);
        }
      }
    }
  }

  return null;
}
