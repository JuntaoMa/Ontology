<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import { projectQueryPlan } from '../lib/query-plan-projection';
import QueryPlanGraph from './QueryPlanGraph.vue';
import UiIcon from './UiIcon.vue';

const props = defineProps<{
  formattedJson: string;
}>();

const selectedTab = ref<'json' | 'graph'>('json');
const projection = computed(() => projectQueryPlan(props.formattedJson));
const baseId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
const jsonTabId = `${baseId}-json-tab`;
const jsonPanelId = `${baseId}-json-panel`;
const graphTabId = `${baseId}-graph-tab`;
const graphPanelId = `${baseId}-graph-panel`;

watch(
  () => props.formattedJson,
  () => {
    selectedTab.value = 'json';
  },
);

function selectGraph(): void {
  if (projection.value.available) selectedTab.value = 'graph';
}
</script>

<template>
  <details class="disclosure-card formal-output-card">
    <summary
      class="disclosure-summary formal-output-summary"
      title="查询Plan"
    >
      <UiIcon class="disclosure-icon formal-output-icon" name="plan" />
      <span class="disclosure-title">查询Plan</span>
      <UiIcon
        class="disclosure-chevron formal-output-chevron"
        name="chevron"
      />
    </summary>

    <div class="plan-tabs" role="tablist" aria-label="Query Plan view">
      <button
        :id="jsonTabId"
        class="plan-tab"
        :class="{ active: selectedTab === 'json' }"
        type="button"
        role="tab"
        :aria-selected="selectedTab === 'json'"
        :aria-controls="jsonPanelId"
        @click="selectedTab = 'json'"
      >
        JSON
      </button>
      <button
        :id="graphTabId"
        class="plan-tab"
        :class="{ active: selectedTab === 'graph' }"
        type="button"
        role="tab"
        :aria-selected="selectedTab === 'graph'"
        :aria-controls="graphPanelId"
        :aria-describedby="!projection.available ? `${baseId}-graph-reason` : undefined"
        :disabled="!projection.available"
        :title="projection.available ? 'Show graph projection' : projection.reason"
        @click="selectGraph"
      >
        Graph
      </button>
      <span
        v-if="!projection.available"
        :id="`${baseId}-graph-reason`"
        class="graph-unavailable"
      >
        {{ projection.reason }}
      </span>
    </div>

    <div
      v-show="selectedTab === 'json'"
      :id="jsonPanelId"
      role="tabpanel"
      :aria-labelledby="jsonTabId"
    >
      <pre class="formal-output-code"><code class="language-json">{{ formattedJson }}</code></pre>
    </div>
    <div
      v-if="projection.available"
      v-show="selectedTab === 'graph'"
      :id="graphPanelId"
      role="tabpanel"
      :aria-labelledby="graphTabId"
    >
      <QueryPlanGraph :projection="projection" />
    </div>
  </details>
</template>

<style scoped>
.formal-output-card {
  margin: 14px 0 0;
}

.plan-tabs {
  display: flex;
  min-height: 35px;
  align-items: center;
  gap: 2px;
  border-top: 1px solid var(--line-soft);
  padding: 5px 8px;
  background: #f8f8f6;
}

.plan-tab {
  border: 0;
  border-radius: 7px;
  padding: 5px 9px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 10.5px;
  font-weight: 650;
}

.plan-tab:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text);
}

.plan-tab.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 0 0 1px var(--line);
}

.plan-tab:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.graph-unavailable {
  overflow: hidden;
  min-width: 0;
  margin-left: 5px;
  color: var(--text-muted);
  font-size: 9.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.formal-output-code {
  overflow: auto;
  max-height: 32rem;
  margin: 0;
  border-top: 1px solid var(--line-soft);
  border-radius: 0;
  padding: 12px 14px 14px;
  background: #f4f4f2;
  color: #40403c;
  font: 11.5px/1.6 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
  white-space: pre;
}
</style>
