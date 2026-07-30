<script setup lang="ts">
import { computed } from 'vue';
import { tryPresentJsonOutput } from '../lib/json-presentation';
import { renderSafeMarkdown } from '../lib/markdown';
import QueryPlanCard from './QueryPlanCard.vue';

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
    <QueryPlanCard :formatted-json="jsonPresentation.formattedJson" />
  </template>
  <div v-else v-html="renderSafeMarkdown(content)" />
</template>
