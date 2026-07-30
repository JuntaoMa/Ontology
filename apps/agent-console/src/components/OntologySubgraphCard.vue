<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { select } from 'd3-selection';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { zoom, type ZoomBehavior } from 'd3-zoom';
import {
  MAX_ONTOLOGY_EDGES,
  MAX_ONTOLOGY_NODES,
} from '../lib/ontology-artifact';
import type {
  OntologyArtifactEdge,
  OntologyArtifactNode,
  OntologySubgraphArtifact,
} from '../lib/ontology-artifact';

const props = defineProps<{
  artifact: OntologySubgraphArtifact;
}>();

const WIDTH = 720;
const HEIGHT = 360;
const NODE_RADIUS = 7;
const svgElement = ref<SVGSVGElement | null>(null);
const graphViewport = ref<SVGGElement | null>(null);
let zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> | null = null;

interface LayoutNode extends OntologyArtifactNode, SimulationNodeDatum {
  x: number;
  y: number;
}

interface LayoutLink extends SimulationLinkDatum<LayoutNode> {
  id: string;
  source: string | LayoutNode;
  target: string | LayoutNode;
  label?: string;
  kind?: string;
}

function initialNodes(nodes: OntologyArtifactNode[]): LayoutNode[] {
  const radius = Math.min(WIDTH, HEIGHT) * 0.34;
  return nodes.map((node, index) => {
    const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2;
    return {
      ...node,
      x: WIDTH / 2 + Math.cos(angle) * radius,
      y: HEIGHT / 2 + Math.sin(angle) * radius,
    };
  });
}

function endpointId(endpoint: string | LayoutNode): string {
  return typeof endpoint === 'string' ? endpoint : endpoint.id;
}

function createLayout(
  nodes: OntologyArtifactNode[],
  edges: OntologyArtifactEdge[],
): { nodes: LayoutNode[]; links: LayoutLink[] } {
  const layoutNodes = initialNodes(nodes);
  const links: LayoutLink[] = edges.map((edge) => ({ ...edge }));

  try {
    const simulation = forceSimulation<LayoutNode>(layoutNodes)
      .force(
        'link',
        forceLink<LayoutNode, LayoutLink>(links)
          .id((node) => node.id)
          .distance(72)
          .strength(0.42),
      )
      .force('charge', forceManyBody().strength(nodes.length > 45 ? -105 : -165))
      .force('collide', forceCollide(NODE_RADIUS + 6))
      .force('center', forceCenter(WIDTH / 2, HEIGHT / 2))
      .stop();

    const ticks = Math.min(220, 80 + nodes.length * 2);
    for (let index = 0; index < ticks; index += 1) simulation.tick();
    simulation.stop();
  } catch {
    // The circular seed is still a usable, deterministic fallback.
  }

  for (const node of layoutNodes) {
    node.x = Math.min(WIDTH - 24, Math.max(24, Number.isFinite(node.x) ? node.x : WIDTH / 2));
    node.y = Math.min(HEIGHT - 24, Math.max(24, Number.isFinite(node.y) ? node.y : HEIGHT / 2));
  }

  return { nodes: layoutNodes, links };
}

const layout = computed(() => createLayout(props.artifact.nodes, props.artifact.edges));
const nodeById = computed(
  () => new Map(layout.value.nodes.map((node) => [node.id, node])),
);
const drawableLinks = computed(() =>
  layout.value.links.flatMap((link) => {
    const source = nodeById.value.get(endpointId(link.source));
    const target = nodeById.value.get(endpointId(link.target));
    return source && target ? [{ ...link, source, target }] : [];
  }),
);

const markerId = `ontology-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

function installZoom(): void {
  if (!svgElement.value || !graphViewport.value || !props.artifact.renderable) return;
  const svg = select(svgElement.value);
  zoomBehavior = zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.55, 4])
    .on('zoom', (event) => {
      if (graphViewport.value) {
        select(graphViewport.value).attr('transform', event.transform.toString());
      }
    });
  svg.call(zoomBehavior).on('dblclick.zoom', null);
}

onMounted(installZoom);
watch(
  () => props.artifact,
  async () => {
    await nextTick();
    installZoom();
  },
);
onBeforeUnmount(() => {
  if (svgElement.value) select(svgElement.value).on('.zoom', null);
  zoomBehavior = null;
});

function nodeColor(node: LayoutNode): string {
  const key = node.kind ?? node.id;
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  const palette = ['#2563eb', '#0f766e', '#7c3aed', '#b45309', '#be123c', '#0369a1'];
  return palette[hash % palette.length];
}

function shortLabel(label: string): string {
  return label.length > 28 ? `${label.slice(0, 27)}…` : label;
}
</script>

<template>
  <details class="subgraph-card">
    <summary class="subgraph-header">
      <span class="subgraph-heading">
        <strong
          class="subgraph-title"
          :title="artifact.title || 'Ontology subgraph'"
        >
          {{ artifact.title || 'Ontology subgraph' }}
        </strong>
        <span class="subgraph-counts">
          {{ artifact.totalNodeCount }} nodes · {{ artifact.totalEdgeCount }} edges
        </span>
      </span>
      <span class="subgraph-meta">
        <span v-if="artifact.algorithm">{{ artifact.algorithm }}</span>
        <span v-if="artifact.durationMs !== undefined">{{ artifact.durationMs }} ms</span>
      </span>
    </summary>

    <svg
      v-if="artifact.renderable"
      ref="svgElement"
      class="subgraph-svg"
      :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
      role="img"
      :aria-label="`${artifact.title || 'Ontology subgraph'} with ${artifact.nodes.length} nodes and ${artifact.edges.length} edges`"
    >
      <defs>
        <marker
          :id="markerId"
          viewBox="0 -5 10 10"
          refX="18"
          refY="0"
          markerWidth="5"
          markerHeight="5"
          orient="auto"
        >
          <path d="M0,-5L10,0L0,5" class="arrow-head" />
        </marker>
      </defs>

      <g ref="graphViewport">
        <g class="edges" aria-hidden="true">
          <line
            v-for="edge in drawableLinks"
            :key="edge.id"
            :x1="edge.source.x"
            :y1="edge.source.y"
            :x2="edge.target.x"
            :y2="edge.target.y"
            :marker-end="`url(#${markerId})`"
          >
            <title>{{ edge.label || edge.kind || edge.id }}</title>
          </line>
        </g>

        <g
          v-for="node in layout.nodes"
          :key="node.id"
          class="node"
          :class="{ 'is-anchor': node.anchor }"
          :transform="`translate(${node.x}, ${node.y})`"
        >
          <circle :r="node.anchor ? NODE_RADIUS + 2 : NODE_RADIUS" :fill="nodeColor(node)">
            <title>{{ node.label }}{{ node.kind ? ` (${node.kind})` : '' }}</title>
          </circle>
          <text x="10" y="3.5">{{ shortLabel(node.label) }}</text>
        </g>
      </g>
    </svg>

    <div v-else class="subgraph-limit" role="note">
      Graph preview is disabled above {{ MAX_ONTOLOGY_NODES }} nodes or
      {{ MAX_ONTOLOGY_EDGES }} edges. Inspect the raw tool output instead.
    </div>

    <p v-if="artifact.renderable" class="subgraph-hint">
      Scroll to zoom · drag to pan · hover for full labels
    </p>
  </details>
</template>

<style scoped>
.subgraph-card {
  margin: 0.75rem 0 0;
  border: 1px solid var(--border-color, #d7dce3);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-main, #fff);
}

.subgraph-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid var(--border-color, #d7dce3);
  font-size: 0.8rem;
  cursor: pointer;
  list-style-position: inside;
}

.subgraph-heading {
  display: flex;
  overflow: hidden;
  min-width: 0;
  flex: 1;
  align-items: baseline;
}

.subgraph-title {
  display: block;
  overflow: hidden;
  min-width: 0;
  flex: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subgraph-counts {
  margin-left: 0.5rem;
  flex: 0 0 auto;
  color: var(--text-muted, #64748b);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.subgraph-meta {
  display: inline-flex;
  overflow: hidden;
  max-width: 38%;
  flex: 0 1 auto;
  gap: 0.45rem;
  color: var(--text-muted, #64748b);
  font-size: 0.72rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subgraph-svg {
  display: block;
  width: 100%;
  min-height: 220px;
  max-height: 360px;
  background:
    radial-gradient(circle at center, rgba(148, 163, 184, 0.08), transparent 70%);
  cursor: grab;
  touch-action: none;
}

.subgraph-svg:active {
  cursor: grabbing;
}

.edges line {
  stroke: var(--text-muted, #94a3b8);
  stroke-width: 1.2;
  stroke-opacity: 0.58;
  vector-effect: non-scaling-stroke;
}

.arrow-head {
  fill: var(--text-muted, #94a3b8);
}

.node circle {
  stroke: var(--bg-main, #fff);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.node.is-anchor circle {
  stroke: #f59e0b;
  stroke-width: 3;
}

.node text {
  fill: var(--text-primary, #1f2937);
  font: 10px ui-sans-serif, system-ui, sans-serif;
  paint-order: stroke;
  stroke: var(--bg-main, #fff);
  stroke-width: 3px;
  stroke-linejoin: round;
}

.subgraph-limit {
  padding: 0.9rem 1rem;
  color: #b45309;
  font-size: 0.78rem;
}

.subgraph-hint {
  margin: 0;
  padding: 0.35rem 0.75rem 0.55rem;
  color: var(--text-muted, #64748b);
  font-size: 0.68rem;
  text-align: right;
}

@media (max-width: 800px) {
  .subgraph-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .subgraph-svg {
    min-height: 190px;
  }
}
</style>
