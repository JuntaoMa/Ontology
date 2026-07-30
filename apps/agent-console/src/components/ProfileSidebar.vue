<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
  type CSSProperties,
} from 'vue';
import { useConfigStore } from '../stores/config';
import {
  useSessionStore,
  type OpenConversationStatus,
  type OpenConversationSummary,
} from '../stores/session';
import type { AgentConfig, SavedSession } from '../lib/types';
import DeleteConversationDialog from './DeleteConversationDialog.vue';
import UiIcon from './UiIcon.vue';

const props = defineProps<{
  collapsed: boolean;
  drawer: boolean;
}>();

const emit = defineEmits<{
  collapse: [];
  'conversation-selected': [];
}>();

interface SidebarSession {
  key: string;
  agentName: string;
  sessionId: string;
  title: string;
  lastUpdated: number;
  status: OpenConversationStatus | 'saved';
  statusLabel: string;
  isActive: boolean;
  open?: OpenConversationSummary;
  saved?: SavedSession;
}

interface PendingDelete {
  row: SidebarSession;
  profileTitle: string;
}

const configStore = useConfigStore();
const sessionStore = useSessionStore();
const collapsedProfiles = reactive(new Set<string>());
const creatingProfiles = reactive(new Set<string>());
const deletingKeys = reactive(new Set<string>());
const pendingDelete = ref<PendingDelete | null>(null);
const deleteError = ref('');
const toastMessage = ref('');
const infoProfileId = ref<string | null>(null);
const infoCard = ref<HTMLElement | null>(null);
const infoAnchor = ref<HTMLElement | null>(null);
const infoCloseButton = ref<HTMLButtonElement | null>(null);
const infoPosition = ref<CSSProperties>({ top: '12px', left: '12px' });
let toastTimer: ReturnType<typeof setTimeout> | null = null;

const groups = computed(() =>
  configStore.agentNames.map((agentName) => {
    const config = configStore.getAgent(agentName);
    const sessions = sessionsForProfile(agentName);
    return {
      agentName,
      config,
      sessions,
      isCurrent: sessionStore.currentSession?.agentName === agentName,
      isUnavailable: config?.status === 'unavailable',
      activeCount: sessions.filter((row) =>
        ['running', 'connecting', 'reconnecting', 'needs_attention'].includes(
          row.status,
        ),
      ).length,
    };
  }),
);

const infoConfig = computed(() =>
  infoProfileId.value
    ? configStore.getAgent(infoProfileId.value)
    : undefined,
);

function sessionsForProfile(agentName: string): SidebarSession[] {
  const merged = new Map<string, SidebarSession>();
  for (const saved of sessionStore.resumableSessions) {
    if (saved.agentName !== agentName) continue;
    merged.set(saved.id, {
      key: saved.id,
      agentName,
      sessionId: saved.sessionId,
      title: saved.title,
      lastUpdated: saved.lastUpdated,
      status: 'saved',
      statusLabel: 'Saved',
      isActive: false,
      saved,
    });
  }
  for (const open of sessionStore.openConversations) {
    if (open.agentName !== agentName) continue;
    merged.set(open.key, {
      key: open.key,
      agentName,
      sessionId: open.sessionId,
      title: open.title,
      lastUpdated: open.lastUpdated,
      status: open.status,
      statusLabel: open.statusLabel,
      isActive: open.isActive,
      open,
      saved: merged.get(open.key)?.saved,
    });
  }
  return Array.from(merged.values()).sort(
    (left, right) => right.lastUpdated - left.lastUpdated,
  );
}

function profileTitle(agentName: string, config?: AgentConfig): string {
  return config?.title?.trim() || agentName;
}

function isExpanded(agentName: string): boolean {
  return !collapsedProfiles.has(agentName);
}

function toggleProfile(agentName: string): void {
  if (collapsedProfiles.has(agentName)) {
    collapsedProfiles.delete(agentName);
  } else {
    collapsedProfiles.add(agentName);
  }
}

function sessionStateClass(row: SidebarSession): string {
  if (row.status === 'running') return 'running';
  if (row.status === 'needs_attention' || row.status === 'error') {
    return 'attention';
  }
  if (row.status === 'connected') return 'done';
  return '';
}

function cannotDelete(row: SidebarSession): boolean {
  return (
    deletingKeys.has(row.key) ||
    sessionStore.isProfileBusy(row.agentName) ||
    row.status === 'running' ||
    row.status === 'connecting' ||
    row.status === 'reconnecting' ||
    row.status === 'needs_attention'
  );
}

async function activateSession(
  row: SidebarSession,
  notify = true,
): Promise<void> {
  try {
    if (
      row.open &&
      sessionStore.isProfileConnected(row.agentName)
    ) {
      sessionStore.selectConversation(row.key);
    } else if (row.saved) {
      await sessionStore.resumeSession(row.saved);
    } else if (row.open) {
      sessionStore.selectConversation(row.key);
    }
    if (notify) emit('conversation-selected');
  } catch (cause) {
    console.error('Failed to open conversation:', cause);
  }
}

async function createConversation(
  agentName: string,
  config?: AgentConfig,
): Promise<void> {
  if (
    creatingProfiles.has(agentName) ||
    config?.status === 'unavailable' ||
    !config?.cwd
  ) {
    return;
  }
  const activeBefore = sessionStore.activeConversationKey;
  collapsedProfiles.delete(agentName);
  creatingProfiles.add(agentName);
  try {
    const key = await sessionStore.createSession(agentName, config.cwd, {
      activate: false,
    });
    if (sessionStore.activeConversationKey === activeBefore) {
      sessionStore.selectConversation(key);
      emit('conversation-selected');
      await nextTick();
      focusSession(key);
    }
  } catch (cause) {
    console.error('Failed to create conversation:', cause);
  } finally {
    creatingProfiles.delete(agentName);
  }
}

function requestDelete(
  event: MouseEvent,
  row: SidebarSession,
  title: string,
): void {
  if (cannotDelete(row)) return;
  deleteError.value = '';
  pendingDelete.value = { row, profileTitle: title };
  // Keep the trigger focused so the dialog can restore focus on close.
  (event.currentTarget as HTMLElement | null)?.focus();
}

function fallbackFor(row: SidebarSession): SidebarSession | undefined {
  const profileRows = sessionsForProfile(row.agentName);
  const profileIndex = profileRows.findIndex(
    (candidate) => candidate.key === row.key,
  );
  const adjacent =
    profileRows[profileIndex + 1] ?? profileRows[profileIndex - 1];
  if (adjacent) return adjacent;
  return groups.value
    .flatMap((group) => group.sessions)
    .find((candidate) => candidate.key !== row.key);
}

function focusSession(key: string): void {
  const item = Array.from(
    document.querySelectorAll<HTMLElement>('[data-session-key]'),
  ).find((candidate) => candidate.dataset.sessionKey === key);
  item?.querySelector<HTMLButtonElement>('.session-main')?.focus();
}

async function focusDeleteFallback(
  target: PendingDelete,
  fallback?: SidebarSession,
): Promise<void> {
  await nextTick();
  if (fallback) {
    collapsedProfiles.delete(fallback.agentName);
    await nextTick();
    focusSession(fallback.key);
    return;
  }
  const profile = document.querySelector<HTMLElement>(
    `[data-profile-id="${target.row.agentName}"]`,
  );
  (
    profile?.querySelector<HTMLButtonElement>(
      '.new-conversation:not(:disabled)',
    ) ?? profile?.querySelector<HTMLButtonElement>('.profile-toggle')
  )?.focus();
}

async function confirmDelete(): Promise<void> {
  const target = pendingDelete.value;
  if (!target || deletingKeys.has(target.row.key)) return;
  const fallback = target.row.isActive
    ? fallbackFor(target.row)
    : undefined;
  deletingKeys.add(target.row.key);
  deleteError.value = '';
  try {
    await sessionStore.deleteConversation(
      target.row.agentName,
      target.row.sessionId,
    );
    pendingDelete.value = null;
    if (fallback) {
      collapsedProfiles.delete(fallback.agentName);
      await activateSession(fallback, false);
    }
    showToast(`Deleted “${target.row.title}”`);
    void sessionStore.refreshSessions(target.row.agentName);
    await focusDeleteFallback(target, fallback);
  } catch (cause) {
    deleteError.value =
      cause instanceof Error ? cause.message : String(cause);
  } finally {
    deletingKeys.delete(target.row.key);
  }
}

function showToast(message: string): void {
  toastMessage.value = message;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastMessage.value = '';
    toastTimer = null;
  }, 3200);
}

function profileStatus(agentName: string, config?: AgentConfig): string {
  if (config?.status === 'unavailable') return 'Unavailable';
  if (sessionStore.isProfileConnecting(agentName)) return 'Connecting';
  if (sessionStore.isProfileConnected(agentName)) {
    return sessionStore.isProfileBusy(agentName)
      ? 'Connected · running'
      : 'Connected';
  }
  if (sessionStore.profileErrorFor(agentName)) return 'Error';
  return 'Ready';
}

function retrievalLabel(config?: AgentConfig): string {
  if (!config?.retrieval) return 'None · full prompt context';
  return `Top ${config.retrieval.vectorTopK} · ${config.retrieval.graphAlgorithm.replace(/_/g, ' ')}`;
}

async function toggleInfo(
  event: MouseEvent,
  agentName: string,
): Promise<void> {
  const anchor = event.currentTarget as HTMLElement;
  if (infoProfileId.value === agentName) {
    closeInfo(true);
    return;
  }
  infoProfileId.value = agentName;
  infoAnchor.value = anchor;
  await nextTick();
  const card = infoCard.value;
  if (card && typeof card.showPopover === 'function') card.showPopover();
  positionInfoCard(anchor);
  infoCloseButton.value?.focus();
}

function positionInfoCard(anchor = infoAnchor.value): void {
  if (!anchor) return;
  const anchorRect = anchor.getBoundingClientRect();
  const cardWidth = infoCard.value?.offsetWidth ?? 306;
  const left = Math.min(
    window.innerWidth - cardWidth - 12,
    Math.max(12, anchorRect.right - cardWidth),
  );
  const cardHeight = infoCard.value?.offsetHeight ?? 290;
  const top = Math.min(
    window.innerHeight - cardHeight - 12,
    anchorRect.bottom + 6,
  );
  infoPosition.value = {
    top: `${Math.max(12, top)}px`,
    left: `${Math.max(12, left)}px`,
  };
}

function closeInfo(restoreFocus = false): void {
  const anchor = infoAnchor.value;
  const card = infoCard.value;
  if (
    card &&
    typeof card.hidePopover === 'function' &&
    card.matches(':popover-open')
  ) {
    card.hidePopover();
  }
  infoProfileId.value = null;
  infoAnchor.value = null;
  if (restoreFocus) void nextTick(() => anchor?.focus());
}

function handleInfoToggle(event: Event): void {
  const state = (event as Event & { newState?: string }).newState;
  if (state === 'closed') {
    infoProfileId.value = null;
    infoAnchor.value = null;
  }
}

function handleViewportChange(): void {
  if (infoProfileId.value) positionInfoCard();
}

watch(
  () => configStore.agentNames,
  (agentNames) => {
    for (const agentName of agentNames) {
      if (configStore.getAgent(agentName)?.status === 'unavailable') continue;
      void sessionStore.refreshSessions(agentName);
    }
  },
  { immediate: true },
);

watch(
  () => props.collapsed,
  (collapsed) => {
    if (collapsed) closeInfo();
  },
);

onMounted(() => {
  window.addEventListener('resize', handleViewportChange);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleViewportChange);
  if (toastTimer) clearTimeout(toastTimer);
});
</script>

<template>
  <aside
    id="profile-sidebar"
    class="sidebar"
    :class="{ 'is-collapsed': collapsed, 'is-drawer': drawer }"
    aria-label="Agent Profiles and conversations"
    :aria-hidden="collapsed"
    :inert="collapsed"
  >
    <header class="sidebar-top">
      <div class="app-mark" aria-hidden="true">
        <UiIcon name="logo" />
      </div>
      <div class="app-identity">
        <div class="app-name">Ontology Agent Console</div>
        <div class="app-subtitle">Agent Profiles</div>
      </div>
      <button
        class="icon-button"
        type="button"
        aria-label="Collapse sidebar"
        aria-controls="profile-sidebar"
        :aria-expanded="!collapsed"
        title="Collapse sidebar"
        @click="emit('collapse')"
      >
        <UiIcon name="panel-left" />
      </button>
    </header>

    <nav class="profiles" aria-label="Fixed Agent Profiles">
      <section
        v-for="group in groups"
        :key="group.agentName"
        class="profile-group"
        :class="{
          current: group.isCurrent,
          collapsed: !isExpanded(group.agentName),
          unavailable: group.isUnavailable,
        }"
        :data-profile-id="group.agentName"
      >
        <div class="profile-row">
          <button
            class="profile-toggle"
            type="button"
            :aria-expanded="isExpanded(group.agentName)"
            :aria-controls="`${group.agentName}-sessions`"
            :aria-label="`Toggle ${profileTitle(group.agentName, group.config)} conversations`"
            @click="toggleProfile(group.agentName)"
          >
            <UiIcon class="chevron" name="chevron" />
            <UiIcon class="folder-icon" name="folder" />
            <span class="profile-copy">
              <span class="profile-title">
                {{ profileTitle(group.agentName, group.config) }}
              </span>
              <span v-if="group.activeCount" class="profile-badge">
                {{ group.activeCount }} active
              </span>
              <span
                v-else-if="group.isUnavailable"
                class="profile-badge"
              >
                unavailable
              </span>
            </span>
          </button>
          <div class="profile-actions">
            <button
              class="icon-button profile-info"
              type="button"
              :aria-label="`${profileTitle(group.agentName, group.config)} information`"
              aria-controls="profile-info-card"
              :aria-expanded="infoProfileId === group.agentName"
              title="Profile information"
              @click="toggleInfo($event, group.agentName)"
            >
              <UiIcon name="info" />
            </button>
            <button
              class="icon-button new-conversation"
              type="button"
              :aria-label="`New ${profileTitle(group.agentName, group.config)} conversation`"
              title="New conversation"
              :disabled="
                group.isUnavailable ||
                creatingProfiles.has(group.agentName) ||
                sessionStore.isProfileConnecting(group.agentName) ||
                sessionStore.isProfileBusy(group.agentName)
              "
              @click="createConversation(group.agentName, group.config)"
            >
              <UiIcon name="compose" />
            </button>
          </div>
        </div>

        <ul
          :id="`${group.agentName}-sessions`"
          class="session-list"
        >
          <li
            v-for="row in group.sessions"
            :key="row.key"
            class="session-item"
            :class="{ active: row.isActive }"
            :data-session-key="row.key"
          >
            <button
              class="session-main"
              type="button"
              :aria-current="row.isActive ? 'page' : undefined"
              @click="activateSession(row)"
            >
              <span class="session-title">{{ row.title }}</span>
              <span
                class="session-state"
                :class="sessionStateClass(row)"
                :aria-label="row.statusLabel"
                role="img"
              />
            </button>
            <button
              class="icon-button session-delete"
              type="button"
              :aria-label="`Delete ${row.title}`"
              :title="
                cannotDelete(row)
                  ? 'Wait for this Profile to finish'
                  : 'Delete conversation'
              "
              :disabled="cannotDelete(row)"
              @click="requestDelete($event, row, profileTitle(group.agentName, group.config))"
            >
              <UiIcon name="trash" />
            </button>
          </li>
          <li
            v-if="group.sessions.length === 0"
            class="empty-profile"
          >
            {{
              sessionStore.isRefreshingAgent(group.agentName)
                ? 'Loading conversations…'
                : 'No conversations yet'
            }}
          </li>
        </ul>
      </section>
    </nav>

    <footer class="sidebar-footer">
      <span>{{ groups.length }} fixed Profiles</span>
      <span class="footer-status">ACP bridge</span>
    </footer>

    <Teleport to="body">
      <section
        v-if="infoProfileId && infoConfig"
        id="profile-info-card"
        ref="infoCard"
        class="floating-card profile-card"
        :style="infoPosition"
        popover="auto"
        role="dialog"
        :aria-label="`${profileTitle(infoProfileId, infoConfig)} Profile information`"
        @toggle="handleInfoToggle"
      >
        <div class="profile-card-head">
          <div class="profile-card-title">
            <UiIcon name="folder" />
            <span>{{ profileTitle(infoProfileId, infoConfig) }}</span>
          </div>
          <button
            ref="infoCloseButton"
            class="icon-button"
            type="button"
            aria-label="Close Profile information"
            title="Close"
            @click="closeInfo(true)"
          >
            <UiIcon name="close" />
          </button>
        </div>
        <p class="profile-card-description">
          {{ infoConfig.description }}
        </p>
        <dl class="profile-facts">
          <div class="profile-fact">
            <dt>Status</dt>
            <dd>{{ profileStatus(infoProfileId, infoConfig) }}</dd>
          </div>
          <div class="profile-fact">
            <dt>Profile ID</dt>
            <dd :title="infoProfileId">{{ infoProfileId }}</dd>
          </div>
          <div class="profile-fact">
            <dt>Model</dt>
            <dd :title="infoConfig.model?.id">{{ infoConfig.model?.id || '—' }}</dd>
          </div>
          <div class="profile-fact">
            <dt>Retrieval</dt>
            <dd :title="retrievalLabel(infoConfig)">
              {{ retrievalLabel(infoConfig) }}
            </dd>
          </div>
        </dl>
      </section>
    </Teleport>

    <DeleteConversationDialog
      v-if="pendingDelete"
      :title="pendingDelete.row.title"
      :profile-title="pendingDelete.profileTitle"
      :deleting="deletingKeys.has(pendingDelete.row.key)"
      :error="deleteError"
      @cancel="pendingDelete = null"
      @confirm="confirmDelete"
    />

    <Teleport to="body">
      <div
        class="toast"
        :class="{ show: toastMessage }"
        role="status"
        aria-live="polite"
      >
        {{ toastMessage }}
      </div>
    </Teleport>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  width: var(--sidebar-width);
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid var(--line);
  background: var(--sidebar-bg);
  opacity: 1;
  transform: translateX(0);
  transition:
    opacity 130ms ease,
    transform 180ms ease;
}

.sidebar.is-collapsed {
  opacity: 0;
  pointer-events: none;
  transform: translateX(-100%);
}

.sidebar-top {
  display: flex;
  min-height: 64px;
  align-items: center;
  gap: 10px;
  padding: 12px 14px 10px 16px;
}

.app-mark {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: 0 1px 2px rgba(30, 30, 27, 0.06);
}

.app-mark :deep(svg) {
  width: 17px;
  height: 17px;
}

.app-identity {
  min-width: 0;
  flex: 1;
}

.app-name {
  overflow: hidden;
  font-size: 14px;
  font-weight: 650;
  letter-spacing: -0.01em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-subtitle {
  margin-top: 1px;
  color: var(--text-muted);
  font-size: 11px;
}

.profiles {
  flex: 1;
  min-height: 0;
  padding: 2px 8px 20px;
  overflow-y: auto;
  scrollbar-color: #cacac4 transparent;
  scrollbar-width: thin;
}

.profile-group {
  position: relative;
  margin-bottom: 10px;
}

.profile-row {
  display: flex;
  min-height: 42px;
  align-items: center;
  gap: 4px;
  border-radius: 9px;
  transition: background 120ms ease;
}

.profile-group.current .profile-row {
  background: color-mix(in srgb, var(--surface-active) 72%, transparent);
}

.profile-row:hover {
  background: var(--surface-hover);
}

.profile-toggle {
  display: flex;
  height: 42px;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 8px;
  padding: 0 4px 0 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.chevron {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  color: var(--text-muted);
  transition: transform 130ms ease;
}

.profile-group.collapsed .chevron {
  transform: rotate(-90deg);
}

.folder-icon {
  width: 19px;
  height: 19px;
  flex: 0 0 auto;
  color: #4f4f4b;
  transform: translateY(-0.5px);
}

.profile-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 7px;
}

.profile-title {
  overflow: hidden;
  font-weight: 590;
  letter-spacing: -0.005em;
  line-height: 19px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-badge {
  flex: 0 0 auto;
  padding: 2px 6px;
  border: 1px solid #d8d8d2;
  border-radius: 999px;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 600;
  line-height: 1.25;
}

.profile-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 1px;
  padding-right: 5px;
  opacity: 0;
  transition: opacity 100ms ease;
}

.profile-row:hover .profile-actions,
.profile-row:focus-within .profile-actions,
.profile-group.current .profile-actions {
  opacity: 1;
}

.session-list {
  margin: 2px 0 0;
  padding: 0;
  list-style: none;
}

.profile-group.collapsed .session-list {
  display: none;
}

.session-item {
  position: relative;
  display: flex;
  min-height: 29px;
  align-items: center;
  gap: 2px;
  margin: 1px 0;
  padding-right: 5px;
  border-radius: 9px;
}

.session-item:hover {
  background: var(--surface-hover);
}

.session-item.active {
  background: var(--surface-active);
}

.session-main {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 8px;
  padding: 4px 4px 4px 56px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.session-title {
  overflow: hidden;
  flex: 1;
  color: #3b3b38;
  font-size: 13.5px;
  font-weight: 440;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-item.active .session-title {
  color: var(--text);
  font-weight: 560;
}

.session-state {
  width: 9px;
  height: 9px;
  flex: 0 0 auto;
  border: 1.5px solid var(--text-muted);
  border-radius: 50%;
}

.session-state.done {
  border: 0;
  background: var(--success);
  box-shadow: 0 0 0 2px
    color-mix(in srgb, var(--success) 17%, transparent);
}

.session-state.running {
  width: 13px;
  height: 13px;
  border: 2px solid #c5c5bf;
  border-top-color: var(--text-secondary);
  animation: spin 900ms linear infinite;
}

.session-state.attention {
  border: 0;
  background: var(--warning);
}

.session-delete {
  width: 28px;
  height: 28px;
  color: var(--text-muted);
  opacity: 0;
  pointer-events: none;
}

.session-item:hover .session-delete,
.session-item:focus-within .session-delete,
.session-item.active .session-delete,
.session-delete:focus-visible {
  opacity: 1;
  pointer-events: auto;
}

.session-delete:hover:not(:disabled) {
  background: var(--danger-soft);
  color: var(--danger);
}

.session-item:hover .session-delete:disabled,
.session-item.active .session-delete:disabled {
  opacity: 0.28;
}

.empty-profile {
  margin: 1px 10px 4px 56px;
  padding: 7px 0;
  color: var(--text-muted);
  font-size: 12px;
}

.profile-group.unavailable .folder-icon,
.profile-group.unavailable .profile-title {
  color: var(--text-muted);
}

.sidebar-footer {
  display: flex;
  min-height: 42px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-top: 1px solid var(--line-soft);
  padding: 10px 14px;
  color: var(--text-muted);
  font-size: 11px;
}

.footer-status {
  display: flex;
  align-items: center;
  gap: 6px;
}

.footer-status::before {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success);
  content: '';
}

.floating-card {
  position: fixed;
  inset: auto;
  z-index: 30;
  margin: 0;
  border: 1px solid var(--line);
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: var(--shadow);
  backdrop-filter: blur(18px);
}

.profile-card {
  width: 306px;
  padding: 13px;
}

.profile-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.profile-card-title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
  font-size: 15px;
  font-weight: 630;
}

.profile-card-title > :deep(svg) {
  width: 19px;
  height: 19px;
  flex: 0 0 auto;
}

.profile-card-description {
  margin: 11px 1px 13px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.55;
}

.profile-facts {
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--line-soft);
  border-radius: 9px;
}

.profile-fact {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 8px;
  padding: 8px 10px;
  font-size: 11.5px;
}

.profile-fact + .profile-fact {
  border-top: 1px solid var(--line-soft);
}

.profile-fact dt {
  color: var(--text-muted);
}

.profile-fact dd {
  overflow: hidden;
  margin: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toast {
  position: fixed;
  z-index: 70;
  right: 24px;
  bottom: 24px;
  max-width: 340px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 13px;
  background: var(--surface);
  box-shadow: var(--shadow);
  color: var(--text-secondary);
  font-size: 12px;
  opacity: 0;
  pointer-events: none;
  transform: translateY(8px);
  transition:
    opacity 140ms ease,
    transform 140ms ease;
}

.toast.show {
  opacity: 1;
  transform: translateY(0);
}

@media (hover: none) {
  .profile-actions,
  .session-delete {
    opacity: 1;
    pointer-events: auto;
  }
}

@media (max-width: 800px) {
  .sidebar {
    width: min(85vw, 360px);
  }

  .icon-button {
    min-width: 44px;
    min-height: 44px;
  }

  .profile-actions .icon-button,
  .session-delete {
    width: 44px;
    height: 44px;
  }

  .session-item,
  .session-main {
    min-height: 44px;
  }

  .session-item {
    margin-block: 0;
  }

  .session-main {
    padding-block: 12px;
  }
}

@media (hover: none) and (pointer: coarse) {
  .session-item,
  .session-main {
    min-height: 44px;
  }

  .session-item {
    margin-block: 0;
  }

  .session-main {
    padding-block: 12px;
  }

  .session-delete {
    width: 44px;
    height: 44px;
  }
}
</style>
