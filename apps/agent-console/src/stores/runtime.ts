import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
  createRuntimeProject,
  deleteRuntimeProject,
  getRuntimeProjects,
} from '../lib/runtime-api';
import type { RuntimeProject } from '../lib/types';

const POLL_INTERVAL_MS = 1_000;
const TRANSIENT_STATUSES = new Set(['initializing', 'deleting']);

export const useRuntimeStore = defineStore('runtime', () => {
  const projects = ref<RuntimeProject[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const creating = ref(false);
  const deletingIds = ref(new Set<string>());
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshPromise: Promise<void> | null = null;

  const hasProjects = computed(() => projects.value.length > 0);
  const hasTransientProjects = computed(() =>
    projects.value.some((project) => TRANSIENT_STATUSES.has(project.status)),
  );

  function getProject(runtimeId: string): RuntimeProject | undefined {
    return projects.value.find((project) => project.id === runtimeId);
  }

  function isRunnable(runtimeId: string): boolean {
    const project = getProject(runtimeId);
    return Boolean(
      project &&
      !project.stale &&
      (project.status === 'ready' || project.status === 'active'),
    );
  }

  function canReadSessions(runtimeId: string): boolean {
    const project = getProject(runtimeId);
    return Boolean(
      project &&
      (project.status === 'ready' || project.status === 'active'),
    );
  }

  function refreshProjects(): Promise<void> {
    if (refreshPromise) return refreshPromise;
    const refresh = performRefresh();
    refreshPromise = refresh;
    void refresh.finally(() => {
      if (refreshPromise === refresh) refreshPromise = null;
    });
    return refresh;
  }

  async function performRefresh(): Promise<void> {
    loading.value = projects.value.length === 0;
    error.value = null;
    try {
      projects.value = await getRuntimeProjects();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading.value = false;
      schedulePoll();
    }
  }

  async function createProject(
    profileId: string,
    datasetId: string,
  ): Promise<void> {
    if (creating.value) return;
    creating.value = true;
    error.value = null;
    try {
      await createRuntimeProject(profileId, datasetId);
      await refreshProjects();
      schedulePoll(true);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    } finally {
      creating.value = false;
    }
  }

  async function deleteProject(runtimeId: string): Promise<void> {
    if (deletingIds.value.has(runtimeId)) return;
    deletingIds.value = new Set([...deletingIds.value, runtimeId]);
    error.value = null;
    try {
      await deleteRuntimeProject(runtimeId);
      projects.value = projects.value.filter(
        (project) => project.id !== runtimeId,
      );
      await refreshProjects();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      await refreshProjects();
      throw cause;
    } finally {
      const next = new Set(deletingIds.value);
      next.delete(runtimeId);
      deletingIds.value = next;
    }
  }

  function schedulePoll(force = false): void {
    if (pollTimer) {
      if (!force) return;
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (!force && !hasTransientProjects.value) return;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      void refreshProjects();
    }, POLL_INTERVAL_MS);
  }

  function stopPolling(): void {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  }

  function clearError(): void {
    error.value = null;
  }

  /** Synchronous replacement keeps ACP and sidebar tests network-free. */
  function updateFromEvent(nextProjects: RuntimeProject[]): void {
    projects.value = nextProjects;
  }

  return {
    projects,
    hasProjects,
    hasTransientProjects,
    loading,
    error,
    creating,
    deletingIds,
    getProject,
    isRunnable,
    canReadSessions,
    refreshProjects,
    createProject,
    deleteProject,
    schedulePoll,
    stopPolling,
    clearError,
    updateFromEvent,
  };
});
