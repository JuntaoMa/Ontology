<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { ToolCallInfo } from '../lib/types';
import { findOntologyArtifact } from '../lib/ontology-artifact';
import OntologySubgraphCard from './OntologySubgraphCard.vue';
import UiIcon from './UiIcon.vue';

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

const statusLabel = computed(() => {
  switch (props.toolCall.status) {
    case 'pending': return 'Pending';
    case 'in_progress': return 'Running';
    case 'completed': return 'Completed';
    case 'failed': return 'Failed';
    default: return props.toolCall.status;
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
const ontologyArtifact = computed(() =>
  findOntologyArtifact(props.toolCall.rawOutput, props.toolCall.content),
);

const kindIcon = computed<'skill' | 'terminal' | 'thought' | 'tool'>(() => {
  if (/^Loaded skill:\s+/i.test(props.toolCall.title.trimStart())) {
    return 'skill';
  }
  if (props.toolCall.kind === 'think') return 'thought';
  if (props.toolCall.kind === 'execute') return 'terminal';
  return 'tool';
});

const durationLabel = computed(() => {
  if (props.toolCall.timingUnavailable) return 'Timing unavailable';
  if (props.toolCall.startedAt === undefined) return '';
  const end = props.toolCall.finishedAt ?? clock.value;
  const durationMs = Math.max(0, end - props.toolCall.startedAt);
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
});
</script>

<template>
  <details class="disclosure-card tool-call-card" :class="statusClass">
    <summary class="disclosure-summary tool-header">
      <UiIcon class="disclosure-icon kind-icon" :name="kindIcon" />
      <span class="tool-heading">
        <strong class="tool-title" :title="toolCall.title">
          {{ toolCall.title }}
        </strong>
        <span v-if="toolCall.locations?.length" class="tool-location">
          {{ toolCall.locations[0].path }}
        </span>
      </span>
      <span class="tool-status" aria-live="polite">
        <span
          v-if="
            toolCall.status === 'pending' ||
            toolCall.status === 'in_progress'
          "
          class="status-marker"
          :class="{ spinner: toolCall.status === 'in_progress' }"
          aria-hidden="true"
        />
        {{ statusLabel }}
      </span>
      <span
        v-if="durationLabel"
        class="tool-separator"
        aria-hidden="true"
      >
        ·
      </span>
      <span v-if="durationLabel" class="tool-duration">{{ durationLabel }}</span>
      <UiIcon class="disclosure-chevron tool-chevron" name="chevron" />
    </summary>

    <div v-if="toolCall.locations && toolCall.locations.length > 1" class="tool-locations">
      <span v-for="location in toolCall.locations.slice(1)" :key="`${location.path}:${location.line ?? ''}`">
        {{ location.path }}<template v-if="location.line">:{{ location.line }}</template>
      </span>
    </div>

    <div
      v-if="formattedInput || formattedOutput"
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
    </div>

    <OntologySubgraphCard
      v-if="ontologyArtifact"
      :artifact="ontologyArtifact"
    />
  </details>
</template>

<style scoped>
.tool-header {
  color: var(--text-secondary, #5f5f5b);
}

.tool-heading {
  display: flex;
  overflow: hidden;
  flex: 1;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.tool-title {
  display: block;
  overflow: hidden;
  min-width: 0;
  flex: 1 1 auto;
  color: var(--text, #282826);
  font-size: 12px;
  font-weight: 590;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-location {
  display: block;
  overflow: hidden;
  min-width: 0;
  max-width: min(34%, 14rem);
  flex: 0 1 auto;
  color: var(--text-muted, #8a8a84);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-duration {
  color: var(--text-muted, #8a8a84);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.tool-separator {
  margin: 0 -3px;
  color: var(--text-muted, #8a8a84);
  font-size: 11px;
}

.tool-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--success, #39835d);
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}

.status-pending .tool-status,
.status-in_progress .tool-status {
  color: var(--warning, #b47b20);
}

.status-failed .tool-status {
  color: var(--danger, #c83f35);
}

.status-marker {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}

.status-marker.spinner {
  width: 12px;
  height: 12px;
  border-top-color: currentColor;
}

.tool-locations {
  display: flex;
  flex-direction: column;
  gap: 3px;
  border-top: 1px solid var(--line-soft, #e9e9e5);
  padding: 10px 13px 0 36px;
  color: var(--text-muted, #8a8a84);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
}

.tool-details {
  display: grid;
  gap: 0;
  border-top: 1px solid var(--line-soft, #e9e9e5);
}

.tool-details details {
  overflow: hidden;
  border: 0;
  background: transparent;
}

.tool-details details + details {
  border-top: 1px solid var(--line-soft, #e9e9e5);
}

.tool-details summary {
  padding: 8px 13px;
  color: var(--text-secondary, #5f5f5b);
  cursor: pointer;
  font-size: 11.5px;
  font-weight: 550;
  user-select: none;
}

.tool-details summary:focus-visible {
  outline: 2px solid var(--accent, #3b6ee8);
  outline-offset: -2px;
}

.tool-details pre {
  overflow: auto;
  max-height: 22rem;
  margin: 0;
  border-top: 1px solid var(--line-soft, #e9e9e5);
  padding: 10px 13px 12px;
  background: #f4f4f2;
  color: #40403c;
  font: 11.5px/1.6 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
  overflow-wrap: normal;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 800px) {
  .tool-location {
    display: none;
  }

  .tool-duration {
    display: none;
  }
}
</style>
