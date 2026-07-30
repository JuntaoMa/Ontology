<script setup lang="ts">
import { computed } from 'vue';
import { useSessionStore } from '../stores/session';

const emit = defineEmits<{
  select: [key: string];
}>();

const sessionStore = useSessionStore();
const conversations = computed(() => sessionStore.openConversations);
</script>

<template>
  <div class="open-conversations">
    <h3>Open conversations</h3>

    <p v-if="conversations.length === 0" class="empty-state">
      No conversations open in this page.
    </p>

    <ul v-else>
      <li v-for="conversation in conversations" :key="conversation.key">
        <button
          type="button"
          class="conversation-item"
          :class="{ active: conversation.isActive }"
          :aria-current="conversation.isActive ? 'page' : undefined"
          @click="emit('select', conversation.key)"
        >
          <span class="conversation-title">{{ conversation.title }}</span>
          <span class="conversation-meta">
            <span class="profile-name">{{ conversation.agentName }}</span>
            <span
              class="status"
              :class="`status-${conversation.status}`"
            >
              {{ conversation.statusLabel }}
            </span>
          </span>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.open-conversations {
  padding: 1rem;
}

h3 {
  margin: 0 0 0.75rem;
  color: var(--text-secondary, #666);
  font-size: 1rem;
}

ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

li + li {
  margin-top: 0.45rem;
}

.conversation-item {
  width: 100%;
  padding: 0.7rem;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 7px;
  background: transparent;
  color: var(--text-primary, #333);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.conversation-item:hover {
  background: var(--bg-hover, #f5f5f5);
}

.conversation-item:focus-visible {
  outline: 2px solid var(--bg-primary, #0066cc);
  outline-offset: 2px;
}

.conversation-item.active {
  border-color: var(--bg-primary, #0066cc);
  background: color-mix(
    in srgb,
    var(--bg-primary, #0066cc) 8%,
    transparent
  );
}

.conversation-title {
  display: block;
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 0.3rem;
  color: var(--text-muted, #777);
  font-size: 0.72rem;
}

.profile-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status {
  flex-shrink: 0;
  font-weight: 600;
}

.status-running,
.status-reconnecting,
.status-connecting {
  color: var(--text-accent, #0066cc);
}

.status-needs_attention,
.status-error {
  color: var(--bg-danger, #dc3545);
}

.status-connected {
  color: var(--bg-success, #218838);
}

.empty-state {
  margin: 0;
  padding: 0.75rem 0;
  color: var(--text-muted, #999);
  font-size: 0.8rem;
}
</style>
