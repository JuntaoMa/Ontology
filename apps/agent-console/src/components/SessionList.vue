<script setup lang="ts">
import { computed } from 'vue';
import { useSessionStore } from '../stores/session';
import type { SavedSession } from '../lib/types';

const props = defineProps<{
  agentName: string;
  resumeDisabled?: boolean;
}>();

const emit = defineEmits<{
  resume: [session: SavedSession];
  refresh: [];
}>();

const sessionStore = useSessionStore();

// Only show sessions that can be resumed (agent supports loadSession)
const sessions = computed(() =>
  sessionStore.resumableSessions
    .filter((session) => session.agentName === props.agentName)
    .sort((a, b) => b.lastUpdated - a.lastUpdated)
);
const isRefreshing = computed(() =>
  props.agentName
    ? sessionStore.isRefreshingAgent(props.agentName)
    : false,
);
const listError = computed(() =>
  props.agentName
    ? sessionStore.sessionListErrorFor(props.agentName)
    : null,
);

function formatDate(timestamp: number): string {
  if (!timestamp) return 'Updated time unavailable';
  return new Date(timestamp).toLocaleString();
}

function handleResume(session: SavedSession) {
  emit('resume', session);
}

</script>

<template>
  <div class="session-list">
    <div class="list-header">
      <h3>OpenCode sessions</h3>
      <button
        class="refresh-btn"
        type="button"
        :disabled="!agentName || isRefreshing"
        aria-label="Refresh OpenCode sessions"
        title="Refresh sessions from the Agent"
        @click="emit('refresh')"
      >
        {{ isRefreshing ? '…' : '↻' }}
      </button>
    </div>

    <p v-if="listError" class="list-error">
      {{ listError }}
    </p>

    <div v-else-if="isRefreshing" class="empty-state">
      <p>Loading sessions from the Agent…</p>
    </div>

    <div v-else-if="sessions.length === 0" class="empty-state">
      <p>No resumable sessions.</p>
      <p class="hint">Start a new conversation to create one.</p>
    </div>

    <ul v-else>
      <li
        v-for="session in sessions"
        :key="session.id"
      >
        <button
          class="session-item"
          :class="{
            active: sessionStore.isSessionActive(session.agentName, session.sessionId),
          }"
          type="button"
          :aria-current="
            sessionStore.isSessionActive(session.agentName, session.sessionId)
              ? 'page'
              : undefined
          "
          :disabled="
            sessionStore.isSessionHydrating(
              session.agentName,
              session.sessionId,
            ) ||
            (resumeDisabled &&
              !sessionStore.isSessionOpen(
                session.agentName,
                session.sessionId,
              ))
          "
          @click="handleResume(session)"
        >
          <span class="session-title">{{ session.title }}</span>
          <span class="session-meta">
            <span class="session-date">{{ formatDate(session.lastUpdated) }}</span>
            <span
              v-if="sessionStore.isSessionOpen(session.agentName, session.sessionId)"
              class="open-badge"
            >
              Open
            </span>
          </span>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.session-list {
  padding: 1rem;
}

h3 {
  margin: 0;
  font-size: 1rem;
  color: var(--text-secondary, #666);
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.refresh-btn {
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary, #666);
  cursor: pointer;
}

.refresh-btn:hover:not(:disabled) {
  background: var(--bg-hover, #f5f5f5);
}

.refresh-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.list-error {
  padding: 0.65rem;
  border: 1px solid color-mix(in srgb, var(--bg-danger, #dc3545) 35%, transparent);
  border-radius: 6px;
  color: var(--bg-danger, #dc3545);
  font-size: 0.8rem;
  overflow-wrap: anywhere;
}

.empty-state {
  text-align: center;
  padding: 2rem;
  color: var(--text-muted, #999);
}

.empty-state .hint {
  font-size: 0.875rem;
  margin-top: 0.5rem;
}

ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.session-item {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
  text-align: left;
  padding: 0.75rem;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  margin-bottom: 0.5rem;
  background: transparent;
  color: var(--text-primary, #333);
  font: inherit;
  cursor: pointer;
  transition: background 0.15s;
}

.session-item:hover:not(:disabled) {
  background: var(--bg-hover, #f5f5f5);
}

.session-item.active {
  border-color: var(--bg-primary, #0066cc);
}

.session-item:focus-visible {
  outline: 2px solid var(--bg-primary, #0066cc);
  outline-offset: 2px;
}

.session-item:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.session-title {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-date {
  font-size: 0.75rem;
  color: var(--text-muted, #999);
}

.session-meta {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.open-badge {
  color: var(--text-accent, #0066cc);
  font-size: 0.7rem;
  font-weight: 600;
}
</style>
