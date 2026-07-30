<script setup lang="ts">
import { computed } from 'vue';
import { tryPresentJsonOutput } from '../lib/json-presentation';
import { renderSafeMarkdown } from '../lib/markdown';
import UiIcon from './UiIcon.vue';

const props = withDefaults(defineProps<{
  content: string;
  formatJson?: boolean;
}>(), {
  formatJson: false,
});

const jsonPresentation = computed(() =>
  props.formatJson ? tryPresentJsonOutput(props.content) : null,
);
</script>

<template>
  <template v-if="jsonPresentation !== null">
    <div
      v-if="jsonPresentation.leadingMarkdown"
      v-html="renderSafeMarkdown(jsonPresentation.leadingMarkdown)"
    />
    <details class="formal-output-card">
      <summary class="formal-output-summary" title="查询Plan">
        <UiIcon class="formal-output-icon" name="plan" />
        <span>查询Plan</span>
        <UiIcon class="formal-output-chevron" name="chevron" />
      </summary>
      <pre class="formal-output-code"><code class="language-json">{{ jsonPresentation.formattedJson }}</code></pre>
    </details>
  </template>
  <div v-else v-html="renderSafeMarkdown(content)" />
</template>

<style scoped>
.formal-output-card {
  overflow: hidden;
  margin: 14px 0 0;
  border: 1px solid var(--line, #deded9);
  border-radius: 11px;
  background: #fbfbfa;
}

.formal-output-summary {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  padding: 11px 13px;
  color: var(--text-secondary, #5f5f5b);
  cursor: pointer;
  font-size: 12px;
  font-weight: 590;
  list-style: none;
  user-select: none;
}

.formal-output-summary::-webkit-details-marker {
  display: none;
}

.formal-output-summary:focus-visible {
  outline: 2px solid var(--accent, #3b6ee8);
  outline-offset: -2px;
}

.formal-output-summary > span {
  overflow: hidden;
  min-width: 0;
  flex: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.formal-output-icon,
.formal-output-chevron {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
}

.formal-output-icon {
  color: var(--text-secondary, #5f5f5b);
}

.formal-output-chevron {
  color: var(--text-muted, #8a8a84);
  transform: rotate(-90deg);
  transition: transform 130ms ease;
}

.formal-output-card[open] .formal-output-chevron {
  transform: rotate(0);
}

.formal-output-card > .formal-output-code {
  overflow: auto;
  max-height: 32rem;
  margin: 0;
  border-top: 1px solid var(--line-soft, #e9e9e5);
  border-radius: 0;
  padding: 12px 14px 14px;
  background: #f4f4f2;
  color: #40403c;
  font: 11.5px/1.6 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
  white-space: pre;
}
</style>
