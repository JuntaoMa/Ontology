<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import type { PermissionRequest } from '../lib/types';
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

const dialogRef = ref<HTMLDivElement | null>(null);
let previousFocus: HTMLElement | null = null;

function handleSelect(optionId: string) {
  emit('select', optionId);
}

function handleCancel() {
  emit('cancel');
}

function focusableButtons(): HTMLButtonElement[] {
  return Array.from(
    dialogRef.value?.querySelectorAll<HTMLButtonElement>(
      'button:not(:disabled)',
    ) ?? [],
  );
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    handleCancel();
    return;
  }
  if (event.key !== 'Tab') return;

  const buttons = focusableButtons();
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (!first || !last) return;

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

onMounted(async () => {
  previousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  window.addEventListener('keydown', handleKeydown);
  await nextTick();
  focusableButtons()[0]?.focus();
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown);
  previousFocus?.focus();
});
</script>

<template>
  <div class="modal-backdrop" @mousedown.self="handleCancel">
    <section
      ref="dialogRef"
      class="modal permission-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="permission-dialog-title"
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

      <div class="dialog-actions">
        <button
          v-for="option in request.options"
          :key="option.optionId"
          :class="['option-btn', `option-${option.kind}`]"
          type="button"
          @click="handleSelect(option.optionId)"
        >
          {{ option.name }}
        </button>
        <button class="cancel-btn" type="button" @click="handleCancel">
          Cancel
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  z-index: 50;
  display: grid;
  inset: 0;
  place-items: center;
  padding: 24px;
  background: rgba(30, 30, 28, 0.28);
  backdrop-filter: blur(3px);
}

.modal {
  width: min(100%, 430px);
  border: 1px solid var(--line);
  border-radius: 15px;
  padding: 20px;
  background: var(--surface);
  box-shadow: var(--shadow);
}

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

.dialog-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}

.option-btn {
  border: 0;
  border-radius: 8px;
  padding: 8px 13px;
  font-size: 12.5px;
  font-weight: 550;
  cursor: pointer;
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

.cancel-btn {
  border: 0;
  border-radius: 8px;
  padding: 8px 13px;
  background: var(--surface-hover);
  font-size: 12.5px;
  font-weight: 550;
  cursor: pointer;
}

.cancel-btn:hover {
  background: var(--surface-active);
}
</style>
