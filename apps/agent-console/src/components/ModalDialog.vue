<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

const props = withDefaults(
  defineProps<{
    labelledBy: string;
    describedBy?: string;
    alert?: boolean;
    dismissible?: boolean;
  }>(),
  {
    describedBy: undefined,
    alert: false,
    dismissible: true,
  },
);

const emit = defineEmits<{
  cancel: [];
}>();

const dialog = ref<HTMLDialogElement | null>(null);
let previousFocus: HTMLElement | null = null;

function requestCancel(): void {
  if (props.dismissible) emit('cancel');
}

function handleCancel(event: Event): void {
  event.preventDefault();
  requestCancel();
}

function handleBackdrop(event: MouseEvent): void {
  if (event.target === event.currentTarget) requestCancel();
}

onMounted(async () => {
  previousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  await nextTick();
  const element = dialog.value;
  if (!element) return;
  if (typeof element.showModal === 'function') {
    element.showModal();
  } else {
    // jsdom and older embedded browsers do not implement showModal().
    element.setAttribute('open', '');
  }
  await nextTick();
  element.querySelector<HTMLElement>('[autofocus]')?.focus();
});

onBeforeUnmount(() => {
  const element = dialog.value;
  if (element?.open && typeof element.close === 'function') {
    element.close();
  }
  if (previousFocus?.isConnected) previousFocus.focus();
});
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="modal-dialog"
      :role="alert ? 'alertdialog' : 'dialog'"
      aria-modal="true"
      :aria-labelledby="labelledBy"
      :aria-describedby="describedBy"
      @cancel="handleCancel"
      @mousedown="handleBackdrop"
    >
      <div class="modal-panel">
        <slot />
      </div>
    </dialog>
  </Teleport>
</template>
