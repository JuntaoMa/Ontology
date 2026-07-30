<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  watch,
} from 'vue';
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
import type {
  QueryPlanEdge,
  QueryPlanNode,
  QueryPlanProjection,
} from '../lib/query-plan-projection';

const props = defineProps<{
  projection: Extract<QueryPlanProjection, { available: true }>;
}>();

const WIDTH = 720;
const HEIGHT = 350;
const svgElement = ref<SVGSVGElement | null>(null);
const graphViewport = ref<SVGGElement | null>(null);
let zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> | null = null;

interface LayoutNode extends QueryPlanNode, SimulationNodeDatum {
  x: number;
  y: number;
}

interface LayoutLink extends SimulationLinkDatum<LayoutNode> {
  id: string;
  source: string | LayoutNode;
  target: string | LayoutNode;
  label: string;
  kind: QueryPlanEdge['kind'];
}

function createLayout(): { nodes: LayoutNode[]; links: LayoutLink[] } {
  const nodes = props.projection.nodes.map((node, index) => {
    const angle =
      (index / Math.max(props.projection.nodes.length, 1)) * Math.PI * 2;
    const radius = Math.min(WIDTH, HEIGHT) * 0.34;
    return {
      ...node,
      x: WIDTH / 2 + Math.cos(angle) * radius,
      y: HEIGHT / 2 + Math.sin(angle) * radius,
    };
  });
  const links: LayoutLink[] = props.projection.edges.map((edge) => ({
    ...edge,
  }));

  try {
    const simulation = forceSimulation<LayoutNode>(nodes)
      .force(
        'link',
        forceLink<LayoutNode, LayoutLink>(links)
          .id((node) => node.id)
          .distance((link) => (link.kind === 'join' ? 90 : 74))
          .strength(0.42),
      )
      .force(
        'charge',
        forceManyBody().strength(nodes.length > 45 ? -115 : -180),
      )
      .force(
        'collide',
        forceCollide<LayoutNode>().radius((node) =>
          node.kind === 'task' ? 34 : node.kind === 'filter' ? 30 : 14,
        ),
      )
      .force('center', forceCenter(WIDTH / 2, HEIGHT / 2))
      .stop();
    const ticks = Math.min(240, 90 + nodes.length * 2);
    for (let index = 0; index < ticks; index += 1) simulation.tick();
    simulation.stop();
  } catch {
    // The deterministic circular seed remains a usable fallback.
  }

  for (const node of nodes) {
    node.x = Math.min(
      WIDTH - 42,
      Math.max(42, Number.isFinite(node.x) ? node.x : WIDTH / 2),
    );
    node.y = Math.min(
      HEIGHT - 28,
      Math.max(28, Number.isFinite(node.y) ? node.y : HEIGHT / 2),
    );
  }
  return { nodes, links };
}

const layout = computed(createLayout);
const nodeById = computed(
  () => new Map(layout.value.nodes.map((node) => [node.id, node])),
);
const drawableLinks = computed(() =>
  layout.value.links.flatMap((link) => {
    const source = endpointNode(link.source);
    const target = endpointNode(link.target);
    return source && target ? [{ ...link, source, target }] : [];
  }),
);
const markerId = `query-plan-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

function endpointNode(endpoint: string | LayoutNode): LayoutNode | undefined {
  return typeof endpoint === 'string'
    ? nodeById.value.get(endpoint)
    : endpoint;
}

function installZoom(): void {
  if (!svgElement.value || !graphViewport.value) return;
  const svg = select(svgElement.value);
  zoomBehavior = zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.55, 4])
    .on('zoom', (event) => {
      if (graphViewport.value) {
        select(graphViewport.value).attr(
          'transform',
          event.transform.toString(),
        );
      }
    });
  svg.call(zoomBehavior).on('dblclick.zoom', null);
}

onMounted(installZoom);
watch(
  () => props.projection,
  async () => {
    await nextTick();
    installZoom();
  },
);
onBeforeUnmount(() => {
  if (svgElement.value) select(svgElement.value).on('.zoom', null);
  zoomBehavior = null;
});

function shortLabel(label: string, max = 24): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

function entityColor(node: LayoutNode): string {
  if (node.roles.includes('target')) return '#316dca';
  if (node.roles.includes('projection')) return '#5b45a8';
  if (node.roles.includes('join')) return '#277b68';
  return '#6f7772';
}

function edgeMidpoint(
  edge: { source: LayoutNode; target: LayoutNode },
): { x: number; y: number } {
  return {
    x: (edge.source.x + edge.target.x) / 2,
    y: (edge.source.y + edge.target.y) / 2,
  };
}
</script>

<template>
  <div class="query-graph">
    <div class="graph-legend" aria-label="Graph legend">
      <span><i class="legend-dot task" />Task</span>
      <span><i class="legend-dot target" />Target</span>
      <span><i class="legend-dot projection" />Projection</span>
      <span><i class="legend-line join" />Join</span>
      <span><i class="legend-line evidence" />Evidence</span>
    </div>

    <div class="graph-canvas">
      <svg
        ref="svgElement"
        class="query-graph-svg"
        :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
        role="img"
        :aria-label="`Query Plan graph with ${projection.nodes.length} nodes and ${projection.edges.length} edges`"
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
          <g class="graph-edges" aria-hidden="true">
            <line
              v-for="edge in drawableLinks"
              :key="edge.id"
              :class="`edge-${edge.kind}`"
              :x1="edge.source.x"
              :y1="edge.source.y"
              :x2="edge.target.x"
              :y2="edge.target.y"
              :marker-end="`url(#${markerId})`"
            >
              <title>{{ edge.label }}</title>
            </line>
            <text
              v-for="edge in drawableLinks"
              :key="`${edge.id}:label`"
              class="edge-label"
              :class="`edge-label-${edge.kind}`"
              :x="edgeMidpoint(edge).x"
              :y="edgeMidpoint(edge).y - 4"
              text-anchor="middle"
            >
              {{ shortLabel(edge.label, 20) }}
            </text>
          </g>

          <g
            v-for="node in layout.nodes"
            :key="node.id"
            class="graph-node"
            :class="`node-${node.kind}`"
            :transform="`translate(${node.x}, ${node.y})`"
          >
            <rect
              v-if="node.kind === 'task'"
              x="-27"
              y="-12"
              width="54"
              height="24"
              rx="7"
            />
            <rect
              v-else-if="node.kind === 'filter'"
              x="-24"
              y="-10"
              width="48"
              height="20"
              rx="5"
            />
            <circle v-else r="8" :fill="entityColor(node)" />
            <title>{{ node.label }} · {{ node.roles.join(', ') }}</title>
            <text
              :x="node.kind === 'entity' ? 12 : 0"
              :y="node.kind === 'entity' ? 3.5 : 3.5"
              :text-anchor="node.kind === 'entity' ? 'start' : 'middle'"
            >
              {{ shortLabel(node.label, node.kind === 'filter' ? 16 : 24) }}
            </text>
          </g>
        </g>
      </svg>
    </div>

    <p class="graph-hint">
      Scroll to zoom · drag to pan · hover for complete labels
    </p>

    <div class="task-annotations">
      <section
        v-for="task in projection.tasks"
        :key="task.id"
        class="task-annotation"
      >
        <h4>{{ task.title }} annotations</h4>
        <dl>
          <div v-if="task.projections.length">
            <dt>Projections</dt>
            <dd>{{ task.projections.join(', ') }}</dd>
          </div>
          <div v-if="task.filters.length">
            <dt>Filters</dt>
            <dd>
              <code v-for="filter in task.filters" :key="filter">
                {{ filter }}
              </code>
            </dd>
          </div>
          <div v-if="task.evidence.length">
            <dt>Evidence</dt>
            <dd>{{ task.evidence.join('; ') }}</dd>
          </div>
        </dl>
      </section>
    </div>
  </div>
</template>

<style scoped>
.query-graph {
  border-top: 1px solid var(--line-soft);
  background: #fafaf8;
}

.graph-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 9px 13px 4px;
  color: var(--text-muted);
  font-size: 10px;
}

.graph-legend span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #316dca;
}

.legend-dot.task {
  border-radius: 3px;
  background: #30383d;
}

.legend-dot.projection {
  background: #5b45a8;
}

.legend-line {
  width: 12px;
  border-top: 1.5px solid #277b68;
}

.legend-line.evidence {
  border-top-style: dashed;
  border-top-color: #a06442;
}

.query-graph-svg {
  display: block;
  width: 100%;
  min-height: 230px;
  max-height: 350px;
  background:
    radial-gradient(circle at center, rgba(148, 163, 184, 0.08), transparent 70%);
  cursor: grab;
  touch-action: none;
}

.graph-canvas {
  overflow-x: auto;
  scrollbar-color: #cacac4 transparent;
  scrollbar-width: thin;
}

.query-graph-svg:active {
  cursor: grabbing;
}

.graph-edges line {
  stroke: #8b928d;
  stroke-width: 1.15;
  stroke-opacity: 0.62;
  vector-effect: non-scaling-stroke;
}

.graph-edges .edge-projection,
.graph-edges .edge-filter {
  stroke-opacity: 0.4;
}

.graph-edges .edge-evidence {
  stroke: #a06442;
  stroke-dasharray: 4 3;
}

.arrow-head {
  fill: #8b928d;
}

.edge-label {
  fill: #7c817d;
  font: 8.5px ui-sans-serif, system-ui, sans-serif;
  paint-order: stroke;
  stroke: #fafaf8;
  stroke-width: 3px;
  stroke-linejoin: round;
}

.edge-label-filter,
.edge-label-projection {
  fill: #9b9e9a;
}

.graph-node rect {
  stroke: white;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.node-task rect {
  fill: #30383d;
}

.node-filter rect {
  fill: #ece8d8;
  stroke: #fafaf8;
}

.graph-node circle {
  stroke: white;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.graph-node text {
  fill: var(--text);
  font: 9.5px ui-sans-serif, system-ui, sans-serif;
  paint-order: stroke;
  stroke: #fafaf8;
  stroke-width: 3px;
  stroke-linejoin: round;
}

.node-task text {
  fill: white;
  font-weight: 650;
  stroke: none;
}

.node-filter text {
  font-size: 8px;
}

.graph-hint {
  margin: 0;
  padding: 3px 12px 8px;
  color: var(--text-muted);
  font-size: 9.5px;
  text-align: right;
}

.task-annotations {
  display: grid;
  gap: 8px;
  border-top: 1px solid var(--line-soft);
  padding: 10px 12px 12px;
}

.task-annotation {
  overflow: hidden;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--surface);
}

.task-annotation h4 {
  margin: 0;
  border-bottom: 1px solid var(--line-soft);
  padding: 6px 8px;
  color: var(--text-secondary);
  font-size: 10.5px;
}

.task-annotation dl {
  display: grid;
  margin: 0;
}

.task-annotation dl > div {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 8px;
  padding: 6px 8px;
  font-size: 10px;
}

.task-annotation dl > div + div {
  border-top: 1px solid var(--line-soft);
}

.task-annotation dt {
  color: var(--text-muted);
}

.task-annotation dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.task-annotation code {
  display: block;
  font: 9.5px/1.45 'SFMono-Regular', Consolas, monospace;
}

@media (max-width: 800px) {
  .query-graph-svg {
    width: 620px;
    min-height: 200px;
  }
}

@media (max-width: 500px) {
  .task-annotation dl > div {
    grid-template-columns: 1fr;
    gap: 2px;
  }
}
</style>
