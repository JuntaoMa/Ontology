<script setup lang="ts">
defineProps<{
  name:
    | 'logo'
    | 'folder'
    | 'chevron'
    | 'info'
    | 'compose'
    | 'panel-left'
    | 'trash'
    | 'check'
    | 'close'
    | 'terminal'
    | 'thought'
    | 'skill'
    | 'tool'
    | 'plan'
    | 'send'
    | 'alert';
}>();
</script>

<template>
  <svg
    class="ui-icon"
    :data-icon="name"
    :viewBox="name === 'chevron' ? '0 0 20 20' : '0 0 24 24'"
    aria-hidden="true"
  >
    <template v-if="name === 'logo'">
      <path d="M5 6.5 12 3l7 3.5v8L12 18l-7-3.5z" fill="none" stroke="currentColor" stroke-width="1.7" />
      <path d="m5 10 7 3.5 7-3.5M12 13.5V18" fill="none" stroke="currentColor" stroke-width="1.7" />
    </template>
    <path
      v-else-if="name === 'folder'"
      d="M3.5 6.5h6l2 2h9v9.5a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2Z"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linejoin="round"
    />
    <path
      v-else-if="name === 'chevron'"
      d="m5.5 7.5 4.5 4.5 4.5-4.5"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <template v-else-if="name === 'info'">
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6" />
      <path d="M12 10.7v5.1M12 7.8h.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    </template>
    <template v-else-if="name === 'compose'">
      <path d="M13.5 5.5H6.8A2.8 2.8 0 0 0 4 8.3v8.9A2.8 2.8 0 0 0 6.8 20h8.9a2.8 2.8 0 0 0 2.8-2.8v-6.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
      <path d="m11.2 13 1.1-3.4 5.8-5.8a1.5 1.5 0 0 1 2.1 2.1l-5.8 5.8-3.2 1.3Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
    </template>
    <template v-else-if="name === 'panel-left'">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.6" />
      <path d="M9 4.8v14.4" fill="none" stroke="currentColor" stroke-width="1.6" />
    </template>
    <path
      v-else-if="name === 'trash'"
      d="M5.5 7.5h13M9 4.5h6M8 7.5l.7 12h6.6l.7-12M10.3 10.5v6M13.7 10.5v6"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <path
      v-else-if="name === 'check'"
      d="m5.5 12.5 4 4 9-9"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <path
      v-else-if="name === 'close'"
      d="m7 7 10 10M17 7 7 17"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
    />
    <template v-else-if="name === 'terminal'">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path d="m7 9 2.5 2.5L7 14M12 14h4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </template>
    <template v-else-if="name === 'thought'">
      <path d="m12 3 1.35 4.15L17.5 8.5l-4.15 1.35L12 14l-1.35-4.15L6.5 8.5l4.15-1.35Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
      <path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7ZM5 14.5l.55 1.45L7 16.5l-1.45.55L5 18.5l-.55-1.45L3 16.5l1.45-.55Z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round" />
    </template>
    <template v-else-if="name === 'skill'">
      <path d="M4 5.5h5.2A2.8 2.8 0 0 1 12 8.3V19a3.2 3.2 0 0 0-3.2-3.2H4Z" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linejoin="round" />
      <path d="M20 5.5h-5.2A2.8 2.8 0 0 0 12 8.3V19a3.2 3.2 0 0 1 3.2-3.2H20Z" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linejoin="round" />
    </template>
    <path
      v-else-if="name === 'tool'"
      d="M14.4 6.1a4.2 4.2 0 0 0-5.2 5.2L4.3 16.2a2 2 0 0 0 2.8 2.8l4.9-4.9a4.2 4.2 0 0 0 5.2-5.2l-2.4 2.4-2.1-2.1Z"
      fill="none"
      stroke="currentColor"
      stroke-width="1.55"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <template v-else-if="name === 'plan'">
      <rect x="5" y="3.5" width="14" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path d="m8 9 1.2 1.2L11 8.4M13 9.4h3M8 14l1.2 1.2L11 13.4M13 14.4h3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </template>
    <path
      v-else-if="name === 'send'"
      d="m5 12 7-7 7 7M12 5v14"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <template v-else-if="name === 'alert'">
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6" />
      <path d="M12 7.5v5.7M12 16.4h.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    </template>
  </svg>
</template>

<style scoped>
.ui-icon {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
