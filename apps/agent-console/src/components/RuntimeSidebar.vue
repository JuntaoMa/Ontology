<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  reactive,
  ref,
  watch,
} from 'vue';
import { useCatalogStore } from '../stores/catalog';
import { useRuntimeStore } from '../stores/runtime';
import {
  useSessionStore,
  type OpenConversationStatus,
  type OpenConversationSummary,
} from '../stores/session';
import type { RuntimeProject, SavedSession } from '../lib/types';
import CreateRuntimeDialog from './CreateRuntimeDialog.vue';
import DeleteConversationDialog from './DeleteConversationDialog.vue';
import DeleteRuntimeDialog from './DeleteRuntimeDialog.vue';
import RuntimeInfoCard from './RuntimeInfoCard.vue';
import UiIcon from './UiIcon.vue';

defineProps<{
  collapsed: boolean;
  drawer: boolean;
}>();

const emit = defineEmits<{
  collapse: [];
  'conversation-selected': [];
}>();

interface SidebarSession {
  key: string;
  runtimeId: string;
  sessionId: string;
  title: string;
  lastUpdated: number;
  status: OpenConversationStatus | 'saved';
  statusLabel: string;
  isActive: boolean;
  open?: OpenConversationSummary;
  saved?: SavedSession;
}

interface PendingSessionDelete {
  row: SidebarSession;
  projectTitle: string;
}

const catalogStore = useCatalogStore();
const runtimeStore = useRuntimeStore();
const sessionStore = useSessionStore();
const collapsedProjects = reactive(new Set<string>());
const creatingSessions = reactive(new Set<string>());
const deletingSessionKeys = reactive(new Set<string>());
const discoveredRuntimes = new Set<string>();
const pendingSessionDelete = ref<PendingSessionDelete | null>(null);
const pendingRuntimeDelete = ref<RuntimeProject | null>(null);
const sessionDeleteError = ref('');
const runtimeDeleteError = ref('');
const showCreateDialog = ref(false);
const createError = ref('');
const toastMessage = ref('');
const infoRuntimeId = ref<string | null>(null);
const infoAnchor = ref<HTMLElement | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

const groups = computed(() =>
  runtimeStore.projects.map((project) => {
    const sessions = sessionsForRuntime(project.id);
    return {
      project,
      sessions,
      title: projectTitle(project),
      datasetTitle: datasetTitle(project),
      isCurrent: sessionStore.currentSession?.runtimeId === project.id,
      sessionError: sessionStore.runtimeErrorFor(project.id),
      activeCount: sessions.filter((row) =>
        ['running', 'connecting', 'reconnecting', 'needs_attention'].includes(
          row.status,
        ),
      ).length,
    };
  }),
);

const infoProject = computed(() =>
  infoRuntimeId.value
    ? runtimeStore.getProject(infoRuntimeId.value)
    : undefined,
);
const existingRuntimeIds = computed(() =>
  runtimeStore.projects.map((project) => project.id),
);

function sessionsForRuntime(runtimeId: string): SidebarSession[] {
  const merged = new Map<string, SidebarSession>();
  for (const saved of sessionStore.resumableSessions) {
    if (saved.runtimeId !== runtimeId) continue;
    merged.set(saved.id, {
      key: saved.id,
      runtimeId,
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
    if (open.runtimeId !== runtimeId) continue;
    merged.set(open.key, {
      key: open.key,
      runtimeId,
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

function projectTitle(project: RuntimeProject): string {
  return (
    project.profile.title?.trim() ||
    project.displayName ||
    project.profile.id
  );
}

function datasetTitle(project: RuntimeProject): string {
  return project.dataset.title?.trim() || project.dataset.id;
}

function isExpanded(runtimeId: string): boolean {
  return !collapsedProjects.has(runtimeId);
}

function toggleProject(runtimeId: string): void {
  if (collapsedProjects.has(runtimeId)) {
    collapsedProjects.delete(runtimeId);
  } else {
    collapsedProjects.add(runtimeId);
  }
}

function statusLabel(project: RuntimeProject): string {
  if (project.stale) return 'Stale';
  if (project.status === 'initializing') return 'Initializing';
  if (project.status === 'initialization_failed') return 'Build failed';
  if (project.status === 'deleting') return 'Deleting';
  if (project.status === 'delete_failed') return 'Delete failed';
  if (sessionStore.isRuntimeConnecting(project.id)) return 'Connecting';
  if (sessionStore.isRuntimeConnected(project.id)) {
    return sessionStore.isRuntimeBusy(project.id)
      ? 'Connected · running'
      : 'Connected';
  }
  return project.status === 'active' ? 'Active' : 'Ready';
}

function projectStateClass(project: RuntimeProject): string {
  if (
    project.status === 'initialization_failed' ||
    project.status === 'delete_failed'
  ) {
    return 'failed';
  }
  if (project.stale) return 'stale';
  if (project.status === 'initializing' || project.status === 'deleting') {
    return 'working';
  }
  return '';
}

function sessionStateClass(row: SidebarSession): string {
  if (row.status === 'running') return 'running';
  if (row.status === 'needs_attention' || row.status === 'error') {
    return 'attention';
  }
  if (row.status === 'connected') return 'done';
  return '';
}

function cannotDeleteSession(row: SidebarSession): boolean {
  return (
    deletingSessionKeys.has(row.key) ||
    sessionStore.isRuntimeBusy(row.runtimeId) ||
    row.status === 'running' ||
    row.status === 'connecting' ||
    row.status === 'reconnecting' ||
    row.status === 'needs_attention'
  );
}

async function activateSession(row: SidebarSession, notify = true): Promise<void> {
  try {
    if (row.open && sessionStore.isRuntimeConnected(row.runtimeId)) {
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

async function createConversation(project: RuntimeProject): Promise<void> {
  if (
    creatingSessions.has(project.id) ||
    !runtimeStore.isRunnable(project.id) ||
    sessionStore.isRuntimeConnecting(project.id) ||
    sessionStore.isRuntimeBusy(project.id)
  ) {
    return;
  }
  const activeBefore = sessionStore.activeConversationKey;
  collapsedProjects.delete(project.id);
  creatingSessions.add(project.id);
  try {
    const key = await sessionStore.createSession(project.id, project.cwd, {
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
    creatingSessions.delete(project.id);
  }
}

function requestSessionDelete(
  event: MouseEvent,
  row: SidebarSession,
  title: string,
): void {
  if (cannotDeleteSession(row)) return;
  sessionDeleteError.value = '';
  pendingSessionDelete.value = { row, projectTitle: title };
  (event.currentTarget as HTMLElement | null)?.focus();
}

function sessionFallback(row: SidebarSession): SidebarSession | undefined {
  const projectRows = sessionsForRuntime(row.runtimeId);
  const index = projectRows.findIndex((candidate) => candidate.key === row.key);
  const adjacent = projectRows[index + 1] ?? projectRows[index - 1];
  return (
    adjacent ??
    groups.value
      .flatMap((group) => group.sessions)
      .find((candidate) => candidate.key !== row.key)
  );
}

function focusSession(key: string): void {
  const item = Array.from(
    document.querySelectorAll<HTMLElement>('[data-session-key]'),
  ).find((candidate) => candidate.dataset.sessionKey === key);
  item?.querySelector<HTMLButtonElement>('.session-main')?.focus();
}

async function confirmSessionDelete(): Promise<void> {
  const target = pendingSessionDelete.value;
  if (!target || deletingSessionKeys.has(target.row.key)) return;
  const fallback = target.row.isActive
    ? sessionFallback(target.row)
    : undefined;
  deletingSessionKeys.add(target.row.key);
  sessionDeleteError.value = '';
  try {
    await sessionStore.deleteConversation(
      target.row.runtimeId,
      target.row.sessionId,
    );
    pendingSessionDelete.value = null;
    if (fallback) {
      collapsedProjects.delete(fallback.runtimeId);
      await activateSession(fallback, false);
    }
    showToast(`Deleted “${target.row.title}”`);
    void sessionStore.refreshSessions(target.row.runtimeId);
  } catch (cause) {
    sessionDeleteError.value =
      cause instanceof Error ? cause.message : String(cause);
  } finally {
    deletingSessionKeys.delete(target.row.key);
  }
}

async function openCreateDialog(): Promise<void> {
  catalogStore.clearError();
  runtimeStore.clearError();
  createError.value = '';
  showCreateDialog.value = true;
  await catalogStore.loadCatalogs();
  await runtimeStore.refreshProjects();
  createError.value = catalogStore.error || runtimeStore.error || '';
}

async function createProject(profileId: string, datasetId: string): Promise<void> {
  createError.value = '';
  try {
    await runtimeStore.createProject(profileId, datasetId);
    showCreateDialog.value = false;
    showToast('Runtime Project creation started');
  } catch (cause) {
    createError.value = cause instanceof Error ? cause.message : String(cause);
  }
}

function requestRuntimeDelete(project: RuntimeProject): void {
  runtimeDeleteError.value = '';
  pendingRuntimeDelete.value = project;
  closeInfo();
}

async function confirmRuntimeDelete(): Promise<void> {
  const project = pendingRuntimeDelete.value;
  if (!project) return;
  runtimeDeleteError.value = '';
  try {
    await runtimeStore.deleteProject(project.id);
    await sessionStore.removeRuntime(project.id);
    pendingRuntimeDelete.value = null;
    discoveredRuntimes.delete(project.id);
    showToast(`Deleted “${projectTitle(project)}”`);
  } catch (cause) {
    runtimeDeleteError.value =
      cause instanceof Error ? cause.message : String(cause);
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

async function toggleInfo(
  event: MouseEvent,
  runtimeId: string,
): Promise<void> {
  const anchor = event.currentTarget as HTMLElement;
  if (infoRuntimeId.value === runtimeId) {
    closeInfo(true);
    return;
  }
  infoRuntimeId.value = runtimeId;
  infoAnchor.value = anchor;
  await nextTick();
}

function closeInfo(restoreFocus = false): void {
  const anchor = infoAnchor.value;
  infoRuntimeId.value = null;
  infoAnchor.value = null;
  if (restoreFocus) void nextTick(() => anchor?.focus());
}

async function discoverRuntimeSessions(runtimeId: string): Promise<void> {
  if (discoveredRuntimes.has(runtimeId)) return;
  discoveredRuntimes.add(runtimeId);
  await sessionStore.refreshSessions(runtimeId);
  if (sessionStore.runtimeErrorFor(runtimeId)) {
    discoveredRuntimes.delete(runtimeId);
  }
}

function retryRuntimeSessions(runtimeId: string): void {
  discoveredRuntimes.delete(runtimeId);
  void discoverRuntimeSessions(runtimeId);
}

watch(
  () =>
    runtimeStore.projects.map((project) => ({
      id: project.id,
      status: project.status,
      stale: project.stale,
    })),
  (projects) => {
    const currentIds = new Set(projects.map((project) => project.id));
    for (const runtimeId of [...discoveredRuntimes]) {
      if (!currentIds.has(runtimeId)) discoveredRuntimes.delete(runtimeId);
    }
    for (const project of projects) {
      if (!runtimeStore.canReadSessions(project.id)) continue;
      void discoverRuntimeSessions(project.id);
    }
  },
  { immediate: true, deep: true },
);

onBeforeUnmount(() => {
  if (toastTimer) clearTimeout(toastTimer);
});
</script>

<template>
  <aside
    id="runtime-sidebar"
    class="sidebar"
    :class="{ 'is-collapsed': collapsed, 'is-drawer': drawer }"
    aria-label="Runtime Projects and conversations"
    :aria-hidden="collapsed"
    :inert="collapsed"
  >
    <header class="sidebar-top">
      <div class="app-mark" aria-hidden="true">
        <UiIcon name="logo" />
      </div>
      <div class="app-identity">
        <div class="app-name">Ontology Agent Console</div>
        <div class="app-subtitle">Runtime Projects</div>
      </div>
      <button
        class="icon-button"
        type="button"
        aria-label="Collapse sidebar"
        aria-controls="runtime-sidebar"
        :aria-expanded="!collapsed"
        title="Collapse sidebar"
        @click="emit('collapse')"
      >
        <UiIcon name="panel-left" />
      </button>
    </header>

    <div class="create-project-wrap">
      <button
        class="create-project"
        type="button"
        :disabled="catalogStore.loading || runtimeStore.creating"
        @click="openCreateDialog"
      >
        <UiIcon name="compose" />
        <span>Create Project</span>
      </button>
    </div>

    <nav class="projects" aria-label="Runtime Projects">
      <section
        v-for="group in groups"
        :key="group.project.id"
        class="project-group"
        :class="{
          current: group.isCurrent,
          collapsed: !isExpanded(group.project.id),
          unavailable: !runtimeStore.canReadSessions(group.project.id),
        }"
        :data-runtime-id="group.project.id"
      >
        <div class="project-row">
          <button
            class="project-toggle"
            type="button"
            :aria-expanded="isExpanded(group.project.id)"
            :aria-controls="`${group.project.id}-sessions`"
            :aria-label="`Toggle ${group.title} conversations`"
            @click="toggleProject(group.project.id)"
          >
            <UiIcon class="chevron" name="chevron" />
            <UiIcon class="folder-icon" name="folder" />
            <span class="project-copy">
              <span class="project-title" :title="group.title">
                {{ group.title }}
              </span>
              <span class="dataset-tag" :title="group.datasetTitle">
                {{ group.datasetTitle }}
              </span>
            </span>
          </button>
          <div class="project-actions">
            <button
              class="icon-button project-info"
              type="button"
              :aria-label="`${group.title} information`"
              aria-controls="runtime-info-card"
              :aria-expanded="infoRuntimeId === group.project.id"
              title="Project information"
              @click="toggleInfo($event, group.project.id)"
            >
              <UiIcon name="info" />
            </button>
            <button
              class="icon-button new-conversation"
              type="button"
              :aria-label="`New ${group.title} conversation`"
              title="New conversation"
              :disabled="
                !runtimeStore.isRunnable(group.project.id) ||
                creatingSessions.has(group.project.id) ||
                sessionStore.isRuntimeConnecting(group.project.id) ||
                sessionStore.isRuntimeBusy(group.project.id)
              "
              @click="createConversation(group.project)"
            >
              <UiIcon name="compose" />
            </button>
          </div>
        </div>

        <div class="project-meta">
          <span
            class="project-state"
            :class="projectStateClass(group.project)"
          >
            <span
              v-if="
                group.project.status === 'initializing' ||
                group.project.status === 'deleting'
              "
              class="mini-spinner"
              aria-hidden="true"
            />
            {{ statusLabel(group.project) }}
          </span>
          <span v-if="group.activeCount">{{ group.activeCount }} active</span>
        </div>

        <p v-if="group.project.stale" class="project-notice">
          Source changed. Existing Sessions remain available; delete and
          recreate this Project before starting a new one.
        </p>
        <p
          v-else-if="group.project.status === 'initialization_failed'"
          class="project-notice failed"
        >
          Build failed. Open Project information to inspect the error, then
          delete and recreate it.
        </p>

        <ul :id="`${group.project.id}-sessions`" class="session-list">
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
                cannotDeleteSession(row)
                  ? 'Wait for this Runtime to finish'
                  : 'Delete conversation'
              "
              :disabled="cannotDeleteSession(row)"
              @click="requestSessionDelete($event, row, group.title)"
            >
              <UiIcon name="trash" />
            </button>
          </li>
          <li
            v-if="group.sessionError"
            class="session-discovery-error"
            role="status"
          >
            <span :title="group.sessionError">{{ group.sessionError }}</span>
            <button
              type="button"
              :disabled="sessionStore.isRefreshingRuntime(group.project.id)"
              @click="retryRuntimeSessions(group.project.id)"
            >
              Retry
            </button>
          </li>
          <li
            v-else-if="
              runtimeStore.canReadSessions(group.project.id) &&
              group.sessions.length === 0
            "
            class="empty-project"
          >
            {{
              sessionStore.isRefreshingRuntime(group.project.id)
                ? 'Loading conversations…'
                : 'No conversations yet'
            }}
          </li>
        </ul>
      </section>

      <p
        v-if="!runtimeStore.loading && groups.length === 0"
        class="empty-runtime-list"
      >
        Create a Runtime Project to start testing.
      </p>
    </nav>

    <footer class="sidebar-footer">
      <span>{{ groups.length }} Projects</span>
      <span class="footer-status">ACP bridge</span>
    </footer>

    <RuntimeInfoCard
      v-if="infoProject && infoAnchor"
      :key="infoProject.id"
      :project="infoProject"
      :profile-title="projectTitle(infoProject)"
      :profile-description="
        infoProject.profile.description || ''
      "
      :dataset-title="datasetTitle(infoProject)"
      :status-label="statusLabel(infoProject)"
      :anchor="infoAnchor"
      @close="closeInfo()"
      @delete="requestRuntimeDelete(infoProject)"
    />

    <CreateRuntimeDialog
      v-if="showCreateDialog"
      :profiles="catalogStore.profiles"
      :datasets="catalogStore.datasets"
      :existing-runtime-ids="existingRuntimeIds"
      :creating="
        runtimeStore.creating ||
        runtimeStore.loading ||
        catalogStore.loading
      "
      :error="createError"
      @cancel="showCreateDialog = false"
      @create="createProject"
    />

    <DeleteConversationDialog
      v-if="pendingSessionDelete"
      :title="pendingSessionDelete.row.title"
      :runtime-title="pendingSessionDelete.projectTitle"
      :deleting="deletingSessionKeys.has(pendingSessionDelete.row.key)"
      :error="sessionDeleteError"
      @cancel="pendingSessionDelete = null"
      @confirm="confirmSessionDelete"
    />

    <DeleteRuntimeDialog
      v-if="pendingRuntimeDelete"
      :title="projectTitle(pendingRuntimeDelete)"
      :dataset-title="datasetTitle(pendingRuntimeDelete)"
      :deleting="runtimeStore.deletingIds.has(pendingRuntimeDelete.id)"
      :error="runtimeDeleteError"
      @cancel="pendingRuntimeDelete = null"
      @confirm="confirmRuntimeDelete"
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

.create-project-wrap {
  padding: 2px 12px 10px;
}

.create-project {
  display: flex;
  width: 100%;
  min-height: 36px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--surface);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(30, 30, 27, 0.04);
}

.create-project:hover:not(:disabled) {
  border-color: #cecec8;
  background: var(--surface-hover);
  color: var(--text);
}

.create-project:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.create-project :deep(svg) {
  width: 15px;
  height: 15px;
}

.projects {
  flex: 1;
  min-height: 0;
  padding: 0 8px 20px;
  overflow-y: auto;
  scrollbar-color: #cacac4 transparent;
  scrollbar-width: thin;
}

.project-group {
  position: relative;
  margin-bottom: 9px;
}

.project-row {
  display: flex;
  min-height: 40px;
  align-items: center;
  gap: 4px;
  border-radius: 9px;
  transition: background 120ms ease;
}

.project-group.current .project-row {
  background: color-mix(in srgb, var(--surface-active) 72%, transparent);
}

.project-row:hover {
  background: var(--surface-hover);
}

.project-toggle {
  display: flex;
  min-width: 0;
  min-height: 40px;
  flex: 1;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 8px;
  padding: 3px 4px 3px 8px;
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

.project-group.collapsed .chevron {
  transform: rotate(-90deg);
}

.folder-icon {
  width: 19px;
  height: 19px;
  flex: 0 0 auto;
  align-self: center;
  color: #4f4f4b;
}

.project-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 6px;
}

.project-title {
  overflow: hidden;
  min-width: 0;
  flex: 1 1 auto;
  font-weight: 590;
  letter-spacing: -0.005em;
  line-height: 19px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dataset-tag {
  overflow: hidden;
  max-width: 70px;
  flex: 0 1 70px;
  border: 1px solid #d8d8d2;
  border-radius: 999px;
  padding: 1px 6px;
  color: var(--text-muted);
  font-size: 9.5px;
  font-weight: 600;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 1px;
  padding-right: 5px;
  opacity: 0;
  transition: opacity 100ms ease;
}

.project-row:hover .project-actions,
.project-row:focus-within .project-actions,
.project-group.current .project-actions {
  opacity: 1;
}

.project-meta {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: -1px 7px 2px 56px;
  color: var(--text-muted);
  font-size: 9.5px;
}

.project-state {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.project-state.failed,
.project-state.stale {
  color: var(--danger);
}

.project-state.working {
  color: var(--warning);
}

.mini-spinner {
  width: 8px;
  height: 8px;
  border: 1.5px solid #d5d5cf;
  border-top-color: currentColor;
  border-radius: 50%;
  animation: spin 900ms linear infinite;
}

.project-notice {
  margin: 5px 8px 5px 56px;
  border-radius: 7px;
  padding: 6px 8px;
  background: #fff9ee;
  color: var(--text-secondary);
  font-size: 10.5px;
  line-height: 1.4;
}

.project-notice.failed {
  background: var(--danger-soft);
  color: var(--danger);
}

.session-list {
  margin: 1px 0 0;
  padding: 0;
  list-style: none;
}

.project-group.collapsed .project-meta,
.project-group.collapsed .project-notice,
.project-group.collapsed .session-list {
  display: none;
}

.session-item {
  position: relative;
  display: flex;
  min-height: 27px;
  align-items: center;
  gap: 2px;
  margin: 0;
  padding-right: 5px;
  border-radius: 8px;
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
  min-height: 27px;
  flex: 1;
  align-items: center;
  gap: 7px;
  border: 0;
  border-radius: 8px;
  padding: 2px 4px 2px 56px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.session-title {
  overflow: hidden;
  flex: 1;
  color: #3b3b38;
  font-size: 13px;
  font-weight: 440;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-item.active .session-title {
  color: var(--text);
  font-weight: 560;
}

.session-state {
  width: 8px;
  height: 8px;
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
  width: 12px;
  height: 12px;
  border: 2px solid #c5c5bf;
  border-top-color: var(--text-secondary);
  animation: spin 900ms linear infinite;
}

.session-state.attention {
  border: 0;
  background: var(--warning);
}

.session-delete {
  width: 26px;
  height: 26px;
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

.empty-project,
.empty-runtime-list {
  margin: 1px 10px 4px 56px;
  padding: 5px 0;
  color: var(--text-muted);
  font-size: 11.5px;
}

.session-discovery-error {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  margin: 2px 8px 5px 56px;
  color: var(--danger);
  font-size: 10.5px;
}

.session-discovery-error span {
  overflow: hidden;
  min-width: 0;
  flex: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-discovery-error button {
  flex: 0 0 auto;
  border: 1px solid color-mix(in srgb, var(--danger) 28%, var(--line));
  border-radius: 6px;
  padding: 3px 7px;
  background: var(--surface);
  color: var(--danger);
  cursor: pointer;
  font: inherit;
  font-weight: 620;
}

.session-discovery-error button:hover:not(:disabled) {
  background: var(--danger-soft);
}

.session-discovery-error button:disabled {
  cursor: wait;
  opacity: 0.5;
}

.empty-runtime-list {
  margin: 14px 10px;
  text-align: center;
}

.project-group.unavailable .folder-icon,
.project-group.unavailable .project-title {
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

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (hover: none) {
  .project-actions,
  .session-delete {
    opacity: 1;
    pointer-events: auto;
  }
}

@media (max-width: 800px) {
  .sidebar {
    width: min(85vw, 360px);
  }

  .icon-button,
  .project-actions .icon-button,
  .session-delete {
    min-width: 44px;
    min-height: 44px;
  }

  .session-item,
  .session-main {
    min-height: 44px;
  }

  .session-main {
    padding-block: 12px;
  }
}
</style>
