<script setup lang="ts">
import type { AuthMethod } from '@agentclientprotocol/sdk';
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import UiIcon from './UiIcon.vue';

defineProps<{
  authMethods: AuthMethod[];
  agentName: string;
}>();

const emit = defineEmits<{
  (e: 'select', methodId: string): void;
  (e: 'cancel'): void;
}>();

function handleSelect(methodId: string) {
  emit('select', methodId);
}

const dialogRef = ref<HTMLElement | null>(null);
let previousFocus: HTMLElement | null = null;

function focusableButtons(): HTMLButtonElement[] {
  return Array.from(
    dialogRef.value?.querySelectorAll<HTMLButtonElement>(
      'button:not(:disabled)',
    ) ?? [],
  );
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('cancel');
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
  <div class="modal-backdrop" @mousedown.self="emit('cancel')">
    <section
      ref="dialogRef"
      class="modal auth-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-dialog-title"
    >
      <div class="dialog-header">
        <h2 id="auth-dialog-title">Authentication required</h2>
        <button
          class="icon-button"
          type="button"
          aria-label="Cancel authentication"
          title="Close"
          @click="emit('cancel')"
        >
          <UiIcon name="close" />
        </button>
      </div>

      <div class="dialog-content">
        <p class="description">
          <strong>{{ agentName }}</strong> requires authentication to continue.
          Select an authentication method:
        </p>

        <div class="auth-methods">
          <button
            v-for="method in authMethods"
            :key="method.id"
            class="auth-method-btn"
            @click="handleSelect(method.id)"
          >
            <div class="method-info">
              <span class="method-name">{{ method.name }}</span>
              <span v-if="method.description" class="method-desc">
                {{ method.description }}
              </span>
            </div>
            <UiIcon class="method-arrow" name="chevron" />
          </button>
        </div>
      </div>

      <div class="dialog-footer">
        <button class="cancel-btn" @click="emit('cancel')">
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
  justify-content: space-between;
  gap: 12px;
}

.dialog-header h2 {
  margin: 0;
  font-size: 17px;
  letter-spacing: -0.015em;
}

.icon-button {
  display: grid;
  width: 29px;
  height: 29px;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.icon-button:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.icon-button :deep(svg) {
  width: 16px;
  height: 16px;
}

.dialog-content {
  padding-top: 12px;
}

.description {
  margin: 0 0 14px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.55;
}

.auth-methods {
  display: grid;
  gap: 8px;
}

.auth-method-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 10px 11px;
  background: #fbfbfa;
  cursor: pointer;
  text-align: left;
  transition:
    border-color 120ms ease,
    background 120ms ease;
}

.auth-method-btn:hover {
  border-color: #c8c8c2;
  background: var(--surface-hover);
}

.method-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.method-name {
  color: var(--text);
  font-size: 13px;
  font-weight: 590;
}

.method-desc {
  color: var(--text-muted);
  font-size: 11.5px;
  line-height: 1.45;
}

.method-arrow {
  width: 15px;
  height: 15px;
  color: var(--text-muted);
  transform: rotate(-90deg);
}

.auth-method-btn:hover .method-arrow {
  color: var(--text);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 20px;
}

.cancel-btn {
  border: 0;
  border-radius: 8px;
  padding: 8px 13px;
  background: var(--surface-hover);
  color: var(--text);
  cursor: pointer;
  font-size: 12.5px;
  font-weight: 550;
}

.cancel-btn:hover {
  background: var(--surface-active);
}
</style>
