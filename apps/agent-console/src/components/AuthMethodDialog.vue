<script setup lang="ts">
import type { AuthMethod } from '@agentclientprotocol/sdk';
import ModalDialog from './ModalDialog.vue';
import UiIcon from './UiIcon.vue';

defineProps<{
  authMethods: AuthMethod[];
  runtimeName: string;
}>();

const emit = defineEmits<{
  (e: 'select', methodId: string): void;
  (e: 'cancel'): void;
}>();

function handleSelect(methodId: string) {
  emit('select', methodId);
}
</script>

<template>
  <ModalDialog
    labelled-by="auth-dialog-title"
    @cancel="emit('cancel')"
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
        <strong>{{ runtimeName }}</strong> requires authentication to continue.
        Select an authentication method:
      </p>

      <div class="auth-methods">
        <button
          v-for="(method, index) in authMethods"
          :key="method.id"
          class="auth-method-btn"
          type="button"
          :autofocus="index === 0"
          @click="handleSelect(method.id)"
        >
          <span class="method-info">
            <span class="method-name">{{ method.name }}</span>
            <span v-if="method.description" class="method-desc">
              {{ method.description }}
            </span>
          </span>
          <UiIcon class="method-arrow" name="chevron" />
        </button>
      </div>
    </div>

    <div class="dialog-footer">
      <button
        class="modal-button"
        type="button"
        @click="emit('cancel')"
      >
        Cancel
      </button>
    </div>
  </ModalDialog>
</template>

<style scoped>
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

</style>
