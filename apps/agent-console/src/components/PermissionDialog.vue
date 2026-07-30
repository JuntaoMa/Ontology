<script setup lang="ts">
import type { PermissionRequest } from '../lib/types';
import ModalDialog from './ModalDialog.vue';
import UiIcon from './UiIcon.vue';

defineProps<{
  request: PermissionRequest;
  agentName?: string;
  sessionTitle?: string;
}>();

const emit = defineEmits<{
  select: [optionId: string];
  cancel: [];
}>();

function handleSelect(optionId: string) {
  emit('select', optionId);
}

function handleCancel() {
  emit('cancel');
}
</script>

<template>
  <ModalDialog
    labelled-by="permission-dialog-title"
    alert
    @cancel="handleCancel"
  >
    <div class="dialog-header">
      <UiIcon name="terminal" />
      <h2 id="permission-dialog-title">Permission required</h2>
    </div>

    <div class="dialog-content">
      <p v-if="agentName || sessionTitle" class="request-context">
        <strong>{{ agentName || 'Agent Profile' }}</strong>
        <span v-if="sessionTitle"> · {{ sessionTitle }}</span>
      </p>

      <div class="tool-info">
        <span class="tool-title">{{ request.toolCall.title }}</span>
        <span class="tool-kind">{{ request.toolCall.kind }}</span>
      </div>

      <div v-if="request.toolCall.locations?.length" class="locations">
        <div
          v-for="(loc, index) in request.toolCall.locations"
          :key="index"
          class="location"
        >
          <UiIcon name="folder" />
          <span>{{ loc.path }}</span>
        </div>
      </div>
    </div>

    <div class="modal-actions">
      <button
        v-for="(option, index) in request.options"
        :key="option.optionId"
        :class="['modal-button', 'option-btn', `option-${option.kind}`]"
        type="button"
        :autofocus="index === 0"
        @click="handleSelect(option.optionId)"
      >
        {{ option.name }}
      </button>
      <button class="modal-button" type="button" @click="handleCancel">
        Cancel
      </button>
    </div>
  </ModalDialog>
</template>

<style scoped>
.dialog-header {
  display: flex;
  align-items: center;
  gap: 9px;
}

.dialog-header :deep(svg) {
  width: 19px;
  height: 19px;
  color: var(--text-secondary);
}

.dialog-header h2 {
  margin: 0;
  font-size: 17px;
  letter-spacing: -0.015em;
}

.dialog-content {
  padding-top: 14px;
}

.request-context {
  margin: 0 0 12px;
  color: var(--text-secondary);
  font-size: 12px;
}

.tool-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid var(--line-soft);
  border-radius: 9px;
  padding: 9px 10px;
}

.tool-title {
  font-size: 13px;
  font-weight: 600;
}

.tool-kind {
  color: var(--text-muted);
  font-size: 11px;
  text-transform: capitalize;
}

.locations {
  display: grid;
  gap: 5px;
  margin-top: 8px;
  border-radius: 9px;
  padding: 9px 10px;
  background: #f4f4f1;
}

.location {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--text-secondary);
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 11px;
  word-break: break-all;
}

.location :deep(svg) {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
}

.option-btn {
  background: var(--surface-hover);
}

.option-allow_once,
.option-allow_always {
  background: #30302d;
  color: white;
}

.option-allow_once:hover,
.option-allow_always:hover {
  background: #1f1f1d;
}

.option-reject_once,
.option-reject_always {
  background: var(--danger);
  color: white;
}

.option-reject_once:hover,
.option-reject_always:hover {
  background: #ad332c;
}

</style>
