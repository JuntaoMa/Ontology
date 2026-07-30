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
      <pre class="formal-output-code"><code class="language-json">{{ jsonPresentation.formattedJson }}</code></pre>
    </details>
  </template>
  <div v-else v-html="renderSafeMarkdown(content)" />
</template>

<style scoped>
.formal-output-card {
  margin: 14px 0 0;
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
