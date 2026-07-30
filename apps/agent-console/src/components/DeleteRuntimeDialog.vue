<script setup lang="ts">
import ModalDialog from './ModalDialog.vue';

const props = defineProps<{
  title: string;
  datasetTitle: string;
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
    labelled-by="delete-runtime-title"
    described-by="delete-runtime-description"
    alert
    :dismissible="!deleting"
    @cancel="close"
  >
    <h2 id="delete-runtime-title">Delete Runtime Project?</h2>
    <p id="delete-runtime-description" class="dialog-description">
      “{{ title }}” with Dataset “{{ datasetTitle }}” and all of its OpenCode
      Sessions will be permanently deleted.
    </p>
    <p class="irreversible-note">
      The Profile and source Dataset are not changed. This action cannot be
      undone.
    </p>
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
        {{ deleting ? 'Deleting…' : 'Delete Project' }}
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
  margin-top: 14px;
  border-radius: 9px;
  padding: 10px 11px;
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 11px;
  line-height: 1.5;
}

.delete-error {
  color: var(--danger);
}

.modal-button.danger {
  background: var(--danger);
  color: white;
}
</style>
