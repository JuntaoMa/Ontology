<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
} from 'vue';
import { useConfigStore } from './stores/config';
import { useSessionStore } from './stores/session';
import AuthMethodDialog from './components/AuthMethodDialog.vue';
import ChatView from './components/ChatView.vue';
import PermissionDialog from './components/PermissionDialog.vue';
import ProfileSidebar from './components/ProfileSidebar.vue';
import UiIcon from './components/UiIcon.vue';

const configStore = useConfigStore();
const sessionStore = useSessionStore();
const showSidebar = ref(true);
const isNarrowLayout = ref(false);
let narrowMql: MediaQueryList | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let drawerReturnFocus: HTMLElement | null = null;

const hasActiveSession = computed(() => sessionStore.hasActiveSession);
const hasAgents = computed(() => configStore.hasAgents);
const isConnecting = computed(() => sessionStore.isConnecting);
const isReconnecting = computed(() => sessionStore.isReconnecting);
const isConnected = computed(() => sessionStore.isConnected);
const error = computed(
  () => sessionStore.error || configStore.error,
);
const reconnectingAgentName = computed(
  () => sessionStore.currentSession?.agentName ?? 'Agent',
);
const canManuallyReconnect = computed(
  () =>
    !isConnected.value &&
    !isReconnecting.value &&
    !isConnecting.value &&
    !!sessionStore.currentSession?.supportsLoadSession,
);
const pendingPermission = computed(() => sessionStore.pendingPermission);
const pendingAuthMethods = computed(() => sessionStore.pendingAuthMethods);
const pendingAuthAgentName = computed(
  () => sessionStore.pendingAuthAgentName,
);

function syncNarrowLayout(): void {
  if (narrowMql) isNarrowLayout.value = narrowMql.matches;
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    void sessionStore.tryReconnect();
  }, 250);
}

function handleVisibilityChange(): void {
  if (typeof document !== 'undefined' && !document.hidden) scheduleReconnect();
}

function handleOnline(): void {
  scheduleReconnect();
}

async function closeSidebar(restoreFocus = true): Promise<void> {
  showSidebar.value = false;
  await nextTick();
  if (!restoreFocus) return;
  const returnTarget =
    drawerReturnFocus?.isConnected && !drawerReturnFocus.closest('[inert]')
      ? drawerReturnFocus
      : document.querySelector<HTMLButtonElement>('[data-sidebar-reveal]');
  drawerReturnFocus = null;
  returnTarget?.focus();
}

async function collapseSidebar(): Promise<void> {
  await closeSidebar();
}

async function expandSidebar(): Promise<void> {
  if (isNarrowLayout.value) {
    drawerReturnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }
  showSidebar.value = true;
  await nextTick();
  document
    .querySelector<HTMLButtonElement>(
      '#profile-sidebar [aria-label="Collapse sidebar"]',
    )
    ?.focus();
}

async function handleConversationSelected(): Promise<void> {
  if (isNarrowLayout.value) await closeSidebar();
}

async function handleBackdropClick(): Promise<void> {
  if (isNarrowLayout.value) await closeSidebar();
}

function drawerFocusableElements(): HTMLElement[] {
  const sidebar = document.querySelector<HTMLElement>('#profile-sidebar');
  if (!sidebar) return [];
  return Array.from(
    sidebar.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.offsetParent !== null);
}

function handleWindowKeydown(event: KeyboardEvent): void {
  if (!isNarrowLayout.value || !showSidebar.value) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    void closeSidebar();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = drawerFocusableElements();
  if (focusable.length === 0) return;
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

async function handleManualReconnect(): Promise<void> {
  await sessionStore.tryReconnect();
}

function clearError(): void {
  sessionStore.clearError(sessionStore.currentSession?.agentName);
  configStore.clearError();
}

function handlePermissionSelect(optionId: string): void {
  sessionStore.resolvePermission(optionId);
}

function handlePermissionCancel(): void {
  sessionStore.cancelPermission();
}

function handleAuthMethodSelect(methodId: string): void {
  sessionStore.selectAuthMethod(methodId);
}

function handleAuthMethodCancel(): void {
  sessionStore.cancelAuthSelection();
}

onMounted(async () => {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    narrowMql = window.matchMedia('(max-width: 800px)');
    syncNarrowLayout();
    narrowMql.addEventListener('change', syncNarrowLayout);
    if (isNarrowLayout.value) showSidebar.value = false;
  }

  await configStore.loadConfig();

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('keydown', handleWindowKeydown);
  window.addEventListener('pageshow', scheduleReconnect);
  window.addEventListener('online', handleOnline);
});

onBeforeUnmount(() => {
  narrowMql?.removeEventListener('change', syncNarrowLayout);
  narrowMql = null;
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('keydown', handleWindowKeydown);
  window.removeEventListener('pageshow', scheduleReconnect);
  window.removeEventListener('online', handleOnline);
  if (reconnectTimer) clearTimeout(reconnectTimer);
});
</script>

<template>
  <div
    class="app-shell"
    :class="{
      'sidebar-collapsed': !showSidebar,
      'narrow-layout': isNarrowLayout,
    }"
  >
    <ProfileSidebar
      :collapsed="!showSidebar"
      :drawer="isNarrowLayout"
      @collapse="collapseSidebar"
      @conversation-selected="handleConversationSelected"
    />

    <div
      v-if="isNarrowLayout && showSidebar"
      class="drawer-backdrop"
      aria-hidden="true"
      @click="handleBackdropClick"
    />

    <main
      class="workspace"
      :inert="isNarrowLayout && showSidebar"
      :aria-hidden="isNarrowLayout && showSidebar ? 'true' : undefined"
    >
      <div class="status-stack" aria-live="polite">
        <div v-if="isReconnecting" class="status-banner">
          <span class="spinner" aria-hidden="true" />
          <span>
            Reconnecting to <strong>{{ reconnectingAgentName }}</strong>…
          </span>
        </div>
        <div v-else-if="error" class="status-banner is-error">
          <UiIcon name="alert" />
          <span class="status-copy">{{ error }}</span>
          <button
            v-if="canManuallyReconnect"
            class="banner-action"
            type="button"
            @click="handleManualReconnect"
          >
            Reconnect
          </button>
          <button
            class="banner-icon-button"
            type="button"
            aria-label="Dismiss error"
            title="Dismiss"
            @click="clearError"
          >
            <UiIcon name="close" />
          </button>
        </div>
        <div
          v-else-if="canManuallyReconnect"
          class="status-banner"
        >
          <span class="status-copy">
            <strong>{{ reconnectingAgentName }}</strong> is disconnected.
          </span>
          <button
            class="banner-action"
            type="button"
            @click="handleManualReconnect"
          >
            Reconnect
          </button>
        </div>
      </div>

      <ChatView
        v-if="hasActiveSession"
        :sidebar-collapsed="!showSidebar"
        @toggle-sidebar="expandSidebar"
      />

      <template v-else>
        <header class="workspace-header">
          <div class="workspace-heading-row">
            <button
              v-show="!showSidebar"
              class="icon-button sidebar-reveal"
              type="button"
              data-sidebar-reveal
              aria-label="Expand sidebar"
              aria-controls="profile-sidebar"
              :aria-expanded="showSidebar"
              title="Expand sidebar"
              @click="expandSidebar"
            >
              <UiIcon name="panel-left" />
            </button>
            <div class="conversation-heading">
              <h1>Ontology Agent Console</h1>
              <div class="conversation-profile">
                <UiIcon name="folder" />
                <span>Choose a Profile conversation</span>
              </div>
            </div>
          </div>
        </header>
        <div class="welcome-screen">
          <div class="welcome-mark" aria-hidden="true">
            <UiIcon name="logo" />
          </div>
          <h2>Start with an Agent Profile</h2>
          <p>
            Create a conversation from a fixed Profile in the sidebar, or
            reopen an existing OpenCode Session.
          </p>
          <p v-if="!configStore.loading && !hasAgents" class="welcome-hint">
            No valid Agent Profiles were published by the ACP Bridge.
          </p>
        </div>
      </template>
    </main>

    <PermissionDialog
      v-if="pendingPermission"
      :request="pendingPermission"
      :agent-name="sessionStore.pendingPermissionAgentName"
      :session-title="sessionStore.pendingPermissionSessionTitle"
      @select="handlePermissionSelect"
      @cancel="handlePermissionCancel"
    />

    <AuthMethodDialog
      v-if="pendingAuthMethods.length > 0"
      :auth-methods="pendingAuthMethods"
      :agent-name="pendingAuthAgentName"
      @select="handleAuthMethodSelect"
      @cancel="handleAuthMethodCancel"
    />
  </div>
</template>

<style scoped>
.app-shell {
  display: grid;
  grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
  width: 100%;
  height: 100%;
  overflow: hidden;
  transition: grid-template-columns 180ms ease;
}

.app-shell.sidebar-collapsed {
  grid-template-columns: 0 minmax(0, 1fr);
}

.workspace {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
}

.welcome-screen {
  display: grid;
  max-width: 430px;
  margin: auto;
  justify-items: center;
  padding: 40px;
  color: var(--text-secondary);
  text-align: center;
}

.welcome-mark {
  display: grid;
  width: 42px;
  height: 42px;
  margin-bottom: 16px;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 12px;
  color: var(--text);
  box-shadow: 0 2px 8px rgba(30, 30, 27, 0.06);
}

.welcome-mark :deep(svg) {
  width: 23px;
  height: 23px;
}

.welcome-screen h2 {
  margin: 0;
  color: var(--text);
  font-size: 19px;
  letter-spacing: -0.015em;
}

.welcome-screen p {
  margin: 9px 0 0;
  font-size: 13px;
  line-height: 1.65;
}

.welcome-hint {
  color: var(--danger);
}

.status-stack {
  position: absolute;
  z-index: 24;
  top: 74px;
  right: 18px;
  left: 18px;
  display: grid;
  justify-items: center;
  pointer-events: none;
}

.status-banner {
  display: flex;
  max-width: min(720px, 100%);
  align-items: center;
  gap: 8px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 9px 11px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 5px 20px rgba(32, 32, 28, 0.1);
  color: var(--text-secondary);
  font-size: 12px;
  pointer-events: auto;
}

.status-banner.is-error {
  border-color: color-mix(in srgb, var(--danger) 28%, var(--line));
  color: var(--danger);
}

.status-banner > :deep(svg) {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
}

.status-copy {
  min-width: 0;
  flex: 1;
}

.banner-action {
  border: 0;
  border-radius: 7px;
  padding: 5px 8px;
  background: var(--surface-hover);
  color: inherit;
  cursor: pointer;
  font-size: 11.5px;
  font-weight: 600;
}

.banner-icon-button {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.banner-icon-button :deep(svg) {
  width: 15px;
  height: 15px;
}

.drawer-backdrop {
  display: none;
}

@media (max-width: 800px) {
  .app-shell,
  .app-shell.sidebar-collapsed {
    grid-template-columns: minmax(0, 1fr);
  }

  .app-shell :deep(.sidebar.is-drawer) {
    position: fixed;
    z-index: 42;
    inset: 0 auto 0 0;
    width: min(85vw, 360px);
    box-shadow: 12px 0 36px rgba(32, 32, 28, 0.14);
  }

  .drawer-backdrop {
    position: fixed;
    z-index: 41;
    display: block;
    inset: 0;
    background: rgba(30, 30, 28, 0.24);
    backdrop-filter: blur(2px);
  }
}
</style>
