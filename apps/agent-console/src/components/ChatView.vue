<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useConfigStore } from '../stores/config';
import { useSessionStore } from '../stores/session';
import type { ChatMessage } from '../lib/types';
import MessageContent from './MessageContent.vue';
import ToolCallCard from './ToolCallCard.vue';
import UiIcon from './UiIcon.vue';

defineProps<{
  sidebarCollapsed: boolean;
}>();

const emit = defineEmits<{
  'toggle-sidebar': [];
}>();

const configStore = useConfigStore();
const sessionStore = useSessionStore();
const inputText = ref('');
const textarea = ref<HTMLTextAreaElement | null>(null);
const messagesContainer = ref<HTMLElement | null>(null);
let followsLatestMessage = true;

const messages = computed(() => sessionStore.messageList);
const isLoading = computed(() => sessionStore.isLoading);
const isPrompting = computed(() => sessionStore.isPrompting);
const isConnected = computed(() => sessionStore.isConnected);
const isReconnecting = computed(() => sessionStore.isReconnecting);
const isProfileBusyElsewhere = computed(
  () => sessionStore.isCurrentProfileBusyElsewhere,
);
const currentSession = computed(() => sessionStore.currentSession);
const currentProfile = computed(() =>
  currentSession.value
    ? configStore.getAgent(currentSession.value.agentName)
    : undefined,
);
const profileDisplayName = computed(
  () =>
    currentProfile.value?.title?.trim() ||
    currentSession.value?.agentName ||
    'Agent Profile',
);
const connectionLabel = computed(() => {
  if (isReconnecting.value) return 'Reconnecting';
  if (isPrompting.value) return 'Running';
  if (isConnected.value) return 'Connected';
  return 'Disconnected';
});

watch(
  messages,
  async () => {
    await nextTick();
    if (followsLatestMessage) scrollToLatestMessage();
  },
  { deep: true },
);

watch(
  () => currentSession.value?.id,
  () => {
    inputText.value = '';
    followsLatestMessage = true;
    void nextTick(() => {
      resizeTextarea();
      scrollToLatestMessage();
    });
  },
);

function scrollToLatestMessage(): void {
  const element = messagesContainer.value;
  if (!element) return;
  element.scrollTop = element.scrollHeight;
  followsLatestMessage = true;
}

function handleThreadScroll(): void {
  const element = messagesContainer.value;
  if (!element) return;
  const distanceFromBottom =
    element.scrollHeight - element.scrollTop - element.clientHeight;
  followsLatestMessage = distanceFromBottom <= 96;
}

function resizeTextarea(): void {
  const element = textarea.value;
  if (!element) return;
  element.style.height = 'auto';
  element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
}

async function handleSend(): Promise<void> {
  const text = inputText.value.trim();
  if (
    !text ||
    isLoading.value ||
    !isConnected.value ||
    isProfileBusyElsewhere.value
  ) {
    return;
  }
  inputText.value = '';
  resizeTextarea();
  try {
    await sessionStore.sendPrompt(text);
  } catch (cause) {
    console.error('Failed to send prompt:', cause);
  }
}

function handleKeyDown(event: KeyboardEvent): void {
  if (
    event.key === 'Enter' &&
    !event.shiftKey &&
    !event.isComposing
  ) {
    event.preventDefault();
    void handleSend();
  }
}

function handleCancel(): void {
  void sessionStore.cancelOperation();
}

function completionVerb(message: ChatMessage): string {
  return message.finishReason === 'end_turn' || !message.finishReason
    ? 'Completed'
    : 'Finished';
}

function completionTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));
}

function completionTitle(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'full',
    timeStyle: 'long',
  }).format(new Date(timestamp));
}

function durationLabel(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs} ms`;
  if (durationMs < 60_000) {
    const seconds = durationMs / 1000;
    return `${seconds.toFixed(durationMs < 10_000 ? 1 : 0)}s`;
  }
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}
</script>

<template>
  <div class="chat-view">
    <header class="workspace-header">
      <div class="workspace-heading-row">
        <button
          v-show="sidebarCollapsed"
          class="icon-button sidebar-reveal"
          type="button"
          data-sidebar-reveal
          aria-label="Expand sidebar"
          aria-controls="profile-sidebar"
          :aria-expanded="!sidebarCollapsed"
          title="Expand sidebar"
          @click="emit('toggle-sidebar')"
        >
          <UiIcon name="panel-left" />
        </button>
        <div class="conversation-heading">
          <h1>{{ currentSession?.title || 'Conversation' }}</h1>
          <div class="conversation-profile">
            <UiIcon name="folder" />
            <span>{{ profileDisplayName }}</span>
          </div>
        </div>
      </div>
      <div class="header-meta">
        <span
          class="status-pill"
          :class="{
            running: isPrompting,
            disconnected: !isConnected && !isReconnecting,
          }"
        >
          {{ connectionLabel }}
        </span>
      </div>
    </header>

    <div v-if="isProfileBusyElsewhere" class="profile-busy-notice">
      This Profile is running another conversation. You can read this Session
      now and send after that turn finishes.
    </div>

    <section class="conversation">
      <div
        ref="messagesContainer"
        class="thread"
        @scroll.passive="handleThreadScroll"
      >
        <div class="thread-inner">
          <article
            v-for="message in messages"
            :key="message.id"
            class="message"
            :class="`message-${message.role}`"
          >
            <div class="message-label">
              {{ message.role === 'user' ? 'You' : message.role === 'system' ? 'System' : 'Agent' }}
            </div>

            <div v-if="message.role === 'user'" class="user-message">
              <MessageContent :content="message.content" />
            </div>

            <div v-else class="assistant-message">
              <details
                v-if="message.plan?.length"
                class="disclosure-card plan-section"
              >
                <summary
                  class="disclosure-summary plan-heading"
                  title="Agent plan"
                >
                  <UiIcon class="disclosure-icon" name="plan" />
                  <span class="disclosure-title">Agent plan</span>
                  <UiIcon
                    class="disclosure-chevron"
                    name="chevron"
                  />
                </summary>
                <ol>
                  <li
                    v-for="(entry, index) in message.plan"
                    :key="`${index}:${entry.content}`"
                    :class="`plan-${entry.status}`"
                  >
                    <span class="plan-status" aria-hidden="true">
                      <UiIcon
                        v-if="entry.status === 'completed'"
                        name="check"
                      />
                      <span
                        v-else
                        class="plan-dot"
                        :class="{ active: entry.status === 'in_progress' }"
                      />
                    </span>
                    <span>{{ entry.content }}</span>
                  </li>
                </ol>
              </details>

              <details
                v-if="message.thought && message.role === 'assistant'"
                class="disclosure-card thought-section"
              >
                <summary
                  class="disclosure-summary"
                  title="Thinking"
                >
                  <UiIcon class="disclosure-icon" name="thought" />
                  <span class="disclosure-title">Thinking</span>
                  <UiIcon
                    class="disclosure-chevron"
                    name="chevron"
                  />
                </summary>
                <div class="thought-content">
                  <MessageContent :content="message.thought" />
                </div>
              </details>

              <div
                v-if="message.toolCalls?.length"
                class="tool-calls-section"
              >
                <ToolCallCard
                  v-for="toolCall in message.toolCalls"
                  :key="toolCall.toolCallId"
                  :tool-call="toolCall"
                />
              </div>

              <div v-if="message.content" class="message-content">
                <MessageContent
                  :content="message.content"
                  :format-json="message.role === 'assistant'"
                />
              </div>

              <footer
                v-if="
                  message.role === 'assistant' &&
                  message.completedAt !== undefined &&
                  message.durationMs !== undefined
                "
                class="completion-meta"
              >
                <UiIcon name="check" />
                <span>{{ completionVerb(message) }} at</span>
                <time
                  :datetime="new Date(message.completedAt).toISOString()"
                  :title="completionTitle(message.completedAt)"
                >
                  {{ completionTime(message.completedAt) }}
                </time>
                <span class="completion-separator" aria-hidden="true">·</span>
                <span>{{ durationLabel(message.durationMs) }} total</span>
              </footer>
            </div>
          </article>

          <div v-if="isLoading" class="loading-indicator" role="status">
            <span class="spinner" aria-hidden="true" />
            <span>{{ isPrompting ? 'Thinking…' : 'Loading history…' }}</span>
            <button
              v-if="isPrompting"
              class="cancel-button"
              type="button"
              @click="handleCancel"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>

      <div class="composer-wrap">
        <div class="composer-shell">
          <div class="composer">
            <textarea
              ref="textarea"
              v-model="inputText"
              rows="1"
              :placeholder="
                isReconnecting
                  ? 'Reconnecting…'
                  : !isConnected
                    ? 'Reconnect this conversation to continue'
                    : isProfileBusyElsewhere
                      ? 'This Profile is busy in another conversation'
                      : 'Ask this Profile…'
              "
              :disabled="
                isLoading ||
                isReconnecting ||
                !isConnected ||
                isProfileBusyElsewhere
              "
              aria-label="Message"
              @input="resizeTextarea"
              @keydown="handleKeyDown"
            />
            <button
              class="send-button"
              type="button"
              aria-label="Send message"
              title="Send message"
              :disabled="
                !inputText.trim() ||
                isLoading ||
                isReconnecting ||
                !isConnected ||
                isProfileBusyElsewhere
              "
              @click="handleSend"
            >
              <UiIcon name="send" />
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.chat-view {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.header-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-pill {
  display: flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 4px 8px;
  color: var(--success);
  font-size: 11px;
}

.status-pill::before {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  content: '';
}

.status-pill.running {
  color: var(--warning);
}

.status-pill.disconnected {
  color: var(--text-muted);
}

.profile-busy-notice {
  border-bottom: 1px solid var(--line-soft);
  padding: 7px 24px;
  background: #fff9ee;
  color: var(--text-secondary);
  font-size: 11.5px;
  text-align: center;
}

.conversation {
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
}

.thread {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: 42px 32px 128px;
  scrollbar-color: #cacac4 transparent;
  scrollbar-width: thin;
}

.thread-inner {
  width: min(100%, 790px);
  margin: 0 auto;
}

.message {
  margin-bottom: 32px;
}

.message-label {
  margin-bottom: 9px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.message-user .message-label {
  text-align: right;
}

.user-message {
  width: fit-content;
  max-width: 78%;
  margin-left: auto;
  border-radius: 17px 17px 5px 17px;
  padding: 11px 15px;
  background: var(--surface-subtle);
  color: #333330;
  font-size: 14px;
  line-height: 1.65;
}

.assistant-message {
  color: #333330;
  font-size: 14px;
  line-height: 1.75;
}

.message-content {
  overflow-wrap: break-word;
}

.message-content :deep(p),
.user-message :deep(p) {
  margin: 0 0 12px;
}

.message-content :deep(p:last-child),
.user-message :deep(p:last-child) {
  margin-bottom: 0;
}

.message-content :deep(ol),
.message-content :deep(ul) {
  margin: 8px 0;
  padding-left: 22px;
}

.message-content :deep(pre) {
  overflow: auto;
  margin: 14px 0 0;
  border-radius: 10px;
  padding: 13px 15px;
  background: #f4f4f2;
  color: #40403c;
  font-family:
    'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
  font-size: 11.5px;
  line-height: 1.6;
  white-space: pre;
}

.message-content :deep(code) {
  font-family:
    'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
  font-size: 0.9em;
}

.plan-section {
  margin: 0 0 18px;
}

.plan-section ol {
  display: grid;
  gap: 6px;
  margin: 0;
  border-top: 1px solid var(--line-soft);
  padding: 10px 13px 12px;
  list-style: none;
  color: var(--text-secondary);
  font-size: 12px;
}

.plan-section li {
  display: flex;
  gap: 8px;
}

.plan-status {
  display: grid;
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
  place-items: center;
  color: var(--success);
}

.plan-status :deep(svg) {
  width: 13px;
  height: 13px;
}

.plan-dot {
  width: 7px;
  height: 7px;
  border: 1.5px solid var(--text-muted);
  border-radius: 50%;
}

.plan-dot.active {
  border: 0;
  background: var(--warning);
}

.thought-section {
  margin: 18px 0;
}

.thought-content {
  border-top: 1px solid var(--line-soft);
  padding: 10px 13px 12px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.65;
}

.tool-calls-section {
  display: grid;
  gap: 10px;
  margin: 18px 0;
}

.completion-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 13px 2px 0;
  color: var(--text-muted);
  font-size: 11.5px;
  line-height: 1.4;
}

.completion-meta :deep(svg) {
  width: 13px;
  height: 13px;
  color: var(--success);
}

.completion-separator {
  color: #b5b5af;
}

.loading-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 32px;
  color: var(--text-muted);
  font-size: 12px;
}

.cancel-button {
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 4px 8px;
  background: var(--surface);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 11.5px;
}

.composer-wrap {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  padding: 22px 32px 24px;
  background: linear-gradient(
    to bottom,
    rgba(255, 255, 255, 0),
    rgba(255, 255, 255, 0.92) 26%,
    #ffffff 62%
  );
}

.composer-shell {
  position: relative;
  width: min(100%, 790px);
  margin: 0 auto;
}

.composer {
  display: flex;
  min-height: 58px;
  align-items: flex-end;
  gap: 10px;
  border: 1px solid #cecec8;
  border-radius: 17px;
  padding: 9px 10px 9px 15px;
  background: var(--surface);
  box-shadow: 0 7px 24px rgba(35, 35, 31, 0.08);
}

.composer textarea {
  min-height: 38px;
  max-height: 160px;
  flex: 1;
  resize: none;
  overflow-y: auto;
  border: 0;
  outline: 0;
  padding: 8px 0 4px;
  background: transparent;
  color: var(--text);
  line-height: 1.45;
}

.composer textarea::placeholder {
  color: #9a9a94;
}

.send-button {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  place-items: center;
  border: 0;
  border-radius: 11px;
  background: #30302d;
  color: white;
  cursor: pointer;
}

.send-button :deep(svg) {
  width: 16px;
  height: 16px;
}

.send-button:disabled {
  cursor: not-allowed;
  opacity: 0.28;
}

@media (max-width: 1040px) {
  .thread {
    padding-right: 24px;
    padding-left: 24px;
  }

  .composer-wrap {
    padding-right: 24px;
    padding-left: 24px;
  }
}

@media (max-width: 800px) {
  .thread {
    padding: 28px 16px 132px;
  }

  .composer-wrap {
    padding: 22px 16px calc(16px + env(safe-area-inset-bottom, 0px));
  }

  .composer textarea {
    font-size: 16px;
  }
}
</style>
