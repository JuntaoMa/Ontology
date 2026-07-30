<script setup lang="ts">
import ModalDialog from './ModalDialog.vue';

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

function close(): void {
  if (!props.deleting) emit('cancel');
}
</script>

<template>
  <ModalDialog
    labelled-by="delete-dialog-title"
    described-by="delete-dialog-description"
    alert
    :dismissible="!deleting"
    @cancel="close"
  >
    <h2 id="delete-dialog-title">Delete conversation?</h2>
    <p id="delete-dialog-description" class="dialog-description">
      “{{ title }}” will be permanently deleted from
      {{ profileTitle }}.
    </p>
    <p class="irreversible-note">This action cannot be undone.</p>
    <p v-if="error" class="delete-error" role="alert">{{ error }}</p>
    <div class="modal-actions">
      <button
        class="modal-button"
        type="button"
        :disabled="deleting"
        autofocus
        @click="close"
      >
        Cancel
      </button>
      <button
        class="modal-button danger"
        type="button"
        :disabled="deleting"
        @click="emit('confirm')"
      >
        {{ deleting ? 'Deleting…' : 'Delete' }}
      </button>
    </div>
  </ModalDialog>
</template>

<style scoped>
.dialog-description {
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

.modal-button.danger {
  background: var(--danger);
  color: white;
}
</style>
