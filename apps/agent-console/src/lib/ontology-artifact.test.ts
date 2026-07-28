import { describe, expect, it } from 'vitest';
import {
  findOntologyArtifact,
  MAX_ONTOLOGY_EDGES,
  MAX_ONTOLOGY_NODES,
  parseOntologyArtifact,
} from './ontology-artifact';

describe('ontology artifact parsing', () => {
  it('extracts a balanced prefixed artifact from noisy tool output', () => {
    const text = [
      'query started',
      'ONTOLOGY_ARTIFACT: {"schema":"ontology.artifact/v1","type":"subgraph","title":"AMF {slice}","data":{"nodes":[{"id":"amf","label":"AMF"},{"id":"slice","label":"Network Slice"}],"edges":[{"source":"amf","target":"slice","predicate":"supports"}]}}',
      'query finished',
    ].join('\n');

    const artifact = parseOntologyArtifact(text);

    expect(artifact).toMatchObject({
      schema: 'ontology.artifact/v1',
      schemaVersion: 1,
      kind: 'ontology.subgraph',
      type: 'subgraph',
      title: 'AMF {slice}',
      truncated: false,
    });
    expect(artifact?.nodes).toHaveLength(2);
    expect(artifact?.edges[0]).toMatchObject({
      source: 'amf',
      target: 'slice',
      label: 'supports',
    });
  });

  it('finds marker text nested in ACP raw output and handles cycles', () => {
    const rawOutput: Record<string, unknown> = {
      output: 'ONTOLOGY_ARTIFACT: {"schema_version":1,"kind":"ontology.subgraph","nodes":[{"id":"n1"}],"edges":[]}',
    };
    rawOutput.self = rawOutput;

    expect(findOntologyArtifact(rawOutput)?.nodes[0].id).toBe('n1');
  });

  it('caps graph size and removes edges outside the retained node set', () => {
    const nodes = Array.from({ length: MAX_ONTOLOGY_NODES + 5 }, (_, index) => ({
      id: `n${index}`,
    }));
    const edges = Array.from({ length: MAX_ONTOLOGY_EDGES + 20 }, (_, index) => ({
      source: `n${index % MAX_ONTOLOGY_NODES}`,
      target: `n${(index + 1) % MAX_ONTOLOGY_NODES}`,
    }));
    edges.unshift({ source: 'n0', target: `n${MAX_ONTOLOGY_NODES + 1}` });

    const artifact = parseOntologyArtifact(
      `ONTOLOGY_ARTIFACT: ${JSON.stringify({
        schema_version: 1,
        kind: 'ontology.subgraph',
        nodes,
        edges,
      })}`,
    );

    expect(artifact?.nodes).toHaveLength(MAX_ONTOLOGY_NODES);
    expect(artifact?.edges).toHaveLength(MAX_ONTOLOGY_EDGES);
    expect(artifact?.truncated).toBe(true);
    expect(artifact?.renderable).toBe(false);
    expect(artifact?.edges.some((edge) => edge.target === `n${MAX_ONTOLOGY_NODES + 1}`)).toBe(false);
  });

  it('fails closed for malformed or unsupported payloads', () => {
    expect(parseOntologyArtifact('not an artifact')).toBeNull();
    expect(parseOntologyArtifact('ONTOLOGY_ARTIFACT: {broken')).toBeNull();
    expect(parseOntologyArtifact(
      'ONTOLOGY_ARTIFACT: {"schema_version":1,"kind":"ontology.table","nodes":[],"edges":[]}',
    )).toBeNull();
    expect(parseOntologyArtifact(
      'ONTOLOGY_ARTIFACT: {"type":"subgraph","data":{"nodes":[{"id":"n1"}],"edges":[]}}',
    )).toBeNull();
  });

  it('bounds traversal of very large nested arrays', () => {
    const values = Array.from({ length: 100_000 }, () => 'ordinary output');
    values[0] =
      'ONTOLOGY_ARTIFACT: {"schema_version":1,"kind":"ontology.subgraph","nodes":[{"id":"bounded"}],"edges":[]}';

    expect(findOntologyArtifact({ values })?.nodes[0].id).toBe('bounded');
  });

  it('rewrites duplicate edge ids into stable unique renderer keys', () => {
    const artifact = parseOntologyArtifact(
      'ONTOLOGY_ARTIFACT: {"schema_version":1,"kind":"ontology.subgraph","nodes":[{"id":"a"},{"id":"b"}],"edges":[{"id":"same","source":"a","target":"b"},{"id":"same","source":"b","target":"a"}]}',
    );

    expect(artifact?.edges.map((edge) => edge.id)).toEqual(['same', 'same#2']);
  });
});
