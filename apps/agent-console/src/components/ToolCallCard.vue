<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { ToolCallInfo } from '../lib/types';
import { findOntologyArtifact } from '../lib/ontology-artifact';
import OntologySubgraphCard from './OntologySubgraphCard.vue';

const props = defineProps<{
  toolCall: ToolCallInfo;
}>();

const clock = ref(Date.now());
let clockTimer: ReturnType<typeof setInterval> | undefined;

function syncClock(): void {
  if (props.toolCall.status === 'in_progress' && clockTimer === undefined) {
    clock.value = Date.now();
    clockTimer = setInterval(() => {
      clock.value = Date.now();
    }, 1000);
  } else if (props.toolCall.status !== 'in_progress' && clockTimer !== undefined) {
    clearInterval(clockTimer);
    clockTimer = undefined;
  }
}

watch(() => props.toolCall.status, syncClock, { immediate: true });
onBeforeUnmount(() => {
  if (clockTimer !== undefined) clearInterval(clockTimer);
});

const statusClass = computed(() => `status-${props.toolCall.status}`);

const statusIcon = computed(() => {
  switch (props.toolCall.status) {
    case 'pending': return '⏳';
    case 'in_progress': return '⚙️';
    case 'completed': return '✓';
    case 'failed': return '✕';
    default: return '•';
  }
});

const statusLabel = computed(() => {
  switch (props.toolCall.status) {
    case 'pending': return 'Pending';
    case 'in_progress': return 'Running';
    case 'completed': return 'Completed';
    case 'failed': return 'Failed';
    default: return props.toolCall.status;
  }
});

const kindIcon = computed(() => {
  switch (props.toolCall.kind) {
    case 'read': return '📖';
    case 'edit': return '✏️';
    case 'delete': return '🗑️';
    case 'move': return '📦';
    case 'search': return '🔍';
    case 'execute': return '▶️';
    case 'think': return '💭';
    case 'fetch': return '🌐';
    case 'switch_mode': return '↔️';
    default: return '🔧';
  }
});

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';

  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(
      value,
      (_key, item: unknown) => {
        if (typeof item === 'object' && item !== null) {
          if (seen.has(item)) return '[Circular]';
          seen.add(item);
        }
        return item;
      },
      2,
    );
  } catch {
    return String(value);
  }
}

const formattedInput = computed(() => formatValue(props.toolCall.rawInput));
const formattedOutput = computed(() => formatValue(props.toolCall.rawOutput));
const formattedContent = computed(() => formatValue(props.toolCall.content));
const ontologyArtifact = computed(() =>
  findOntologyArtifact(props.toolCall.rawOutput, props.toolCall.content),
);

const durationLabel = computed(() => {
  if (props.toolCall.timingUnavailable) return 'Timing unavailable';
  if (props.toolCall.startedAt === undefined) return '';
  const end = props.toolCall.finishedAt ?? clock.value;
  const durationMs = Math.max(0, end - props.toolCall.startedAt);
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
});
</script>

<template>
  <article class="tool-call-card" :class="statusClass">
    <header class="tool-header">
      <span class="kind-icon" aria-hidden="true">{{ kindIcon }}</span>
      <span class="tool-heading">
        <strong class="tool-title">{{ toolCall.title }}</strong>
        <span v-if="toolCall.locations?.length" class="tool-location">
          {{ toolCall.locations[0].path }}
        </span>
      </span>
      <span v-if="durationLabel" class="tool-duration">{{ durationLabel }}</span>
      <span class="tool-status" aria-live="polite">
        <span aria-hidden="true">{{ statusIcon }}</span>
        {{ statusLabel }}
      </span>
    </header>

    <div v-if="toolCall.locations && toolCall.locations.length > 1" class="tool-locations">
      <span v-for="location in toolCall.locations.slice(1)" :key="`${location.path}:${location.line ?? ''}`">
        {{ location.path }}<template v-if="location.line">:{{ location.line }}</template>
      </span>
    </div>

    <div
      v-if="formattedInput || formattedOutput || formattedContent"
      class="tool-details"
    >
      <details v-if="formattedInput">
        <summary>Input</summary>
        <pre>{{ formattedInput }}</pre>
      </details>
      <details v-if="formattedOutput">
        <summary>Output</summary>
        <pre>{{ formattedOutput }}</pre>
      </details>
      <details v-if="formattedContent">
        <summary>ACP content</summary>
        <pre>{{ formattedContent }}</pre>
      </details>
    </div>

    <OntologySubgraphCard
      v-if="ontologyArtifact"
      :artifact="ontologyArtifact"
    />
  </article>
</template>

<style scoped>
.tool-call-card {
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--border-color, #d7dce3);
  border-left: 3px solid var(--border-color, #cbd5e1);
  border-radius: 7px;
  background: var(--bg-tool, rgba(255, 255, 255, 0.58));
}

.status-pending {
  border-left-color: #d97706;
}

.status-in_progress {
  border-left-color: #2563eb;
  background: color-mix(in srgb, #2563eb 6%, var(--bg-tool, white));
}

.status-completed {
  border-left-color: #059669;
}

.status-failed {
  border-left-color: #dc2626;
  background: color-mix(in srgb, #dc2626 5%, var(--bg-tool, white));
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
}

.kind-icon {
  flex: 0 0 auto;
  font-size: 0.9rem;
}

.tool-heading {
  display: flex;
  flex: 1;
  align-items: baseline;
  gap: 0.6rem;
  min-width: 0;
}

.tool-title {
  color: var(--text-primary, #1f2937);
  font-size: 0.82rem;
  font-weight: 600;
}

.tool-location {
  overflow: hidden;
  min-width: 0;
  color: var(--text-muted, #64748b);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.7rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-duration {
  color: var(--text-muted, #64748b);
  font-size: 0.7rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.tool-status {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.7rem;
  font-weight: 600;
  white-space: nowrap;
}

.status-pending .tool-status { color: #b45309; }
.status-in_progress .tool-status { color: #1d4ed8; }
.status-completed .tool-status { color: #047857; }
.status-failed .tool-status { color: #b91c1c; }

.tool-locations {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin: 0.45rem 0 0 1.45rem;
  color: var(--text-muted, #64748b);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.7rem;
}

.tool-details {
  display: grid;
  gap: 0.4rem;
  margin-top: 0.55rem;
}

.tool-details details {
  overflow: hidden;
  border: 1px solid var(--border-color, #d7dce3);
  border-radius: 6px;
  background: var(--bg-main, #fff);
}

.tool-details summary {
  padding: 0.4rem 0.55rem;
  color: var(--text-muted, #475569);
  cursor: pointer;
  font-size: 0.72rem;
  font-weight: 600;
  user-select: none;
}

.tool-details summary:focus-visible {
  outline: 2px solid var(--text-accent, #2563eb);
  outline-offset: -2px;
}

.tool-details pre {
  overflow: auto;
  max-height: 22rem;
  margin: 0;
  padding: 0.65rem;
  border-top: 1px solid var(--border-color, #d7dce3);
  background: var(--bg-code, #111827);
  color: var(--text-code, #e5e7eb);
  font: 0.72rem/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  overflow-wrap: normal;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 800px) {
  .tool-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 0.15rem;
  }

  .tool-duration {
    display: none;
  }
}
</style>
