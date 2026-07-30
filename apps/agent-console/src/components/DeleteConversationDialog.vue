<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps<{
  title: string;
  profileTitle: string;
  deleting: boolean;
  error?: string;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [];
}>();

const dialog = ref<HTMLElement | null>(null);
const cancelButton = ref<HTMLButtonElement | null>(null);
let previousFocus: HTMLElement | null = null;

function close(): void {
  if (!props.deleting) emit('cancel');
}

function handleBackdrop(event: MouseEvent): void {
  if (event.target === event.currentTarget) close();
}

function focusableElements(): HTMLElement[] {
  if (!dialog.value) return [];
  return Array.from(
    dialog.value.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = focusableElements();
  if (focusable.length === 0) {
    event.preventDefault();
    dialog.value?.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
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
  cancelButton.value?.focus();
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown);
  previousFocus?.focus();
});
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @mousedown="handleBackdrop">
      <section
        ref="dialog"
        class="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
        tabindex="-1"
      >
        <h2 id="delete-dialog-title">Delete conversation?</h2>
        <p id="delete-dialog-description">
          “{{ title }}” will be permanently deleted from
          {{ profileTitle }}.
        </p>
        <p class="irreversible-note">This action cannot be undone.</p>
        <p v-if="error" class="delete-error" role="alert">{{ error }}</p>
        <div class="modal-actions">
          <button
            ref="cancelButton"
            class="button"
            type="button"
            :disabled="deleting"
            @click="close"
          >
            Cancel
          </button>
          <button
            class="button danger"
            type="button"
            :disabled="deleting"
            @click="emit('confirm')"
          >
            {{ deleting ? 'Deleting…' : 'Delete' }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
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

.modal h2 {
  margin: 0;
  color: var(--text);
  font-size: 17px;
  font-weight: 650;
  letter-spacing: -0.015em;
}

.modal p {
  margin: 10px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.55;
}

.irreversible-note {
  margin-top: 14px !important;
  border-radius: 9px;
  padding: 10px 11px;
  background: #f4f4f1;
  color: var(--text-muted) !important;
  font-size: 11px !important;
  line-height: 1.5 !important;
}

.delete-error {
  color: var(--danger) !important;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}

.button {
  border: 0;
  border-radius: 8px;
  padding: 8px 13px;
  background: var(--surface-hover);
  color: var(--text);
  font-size: 12.5px;
  font-weight: 550;
  cursor: pointer;
}

.button.danger {
  background: var(--danger);
  color: white;
}

.button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
</style>
