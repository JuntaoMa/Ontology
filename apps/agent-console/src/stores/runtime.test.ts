import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { RuntimeProject } from '../lib/types';

const apiMocks = vi.hoisted(() => ({
  getRuntimeProjects: vi.fn<() => Promise<RuntimeProject[]>>(),
  createRuntimeProject: vi.fn<(profileId: string, datasetId: string) => Promise<void>>(),
  deleteRuntimeProject: vi.fn<(runtimeId: string) => Promise<void>>(),
}));

vi.mock('../lib/runtime-api', () => apiMocks);

import { useRuntimeStore } from './runtime';

function project(
  overrides: Partial<RuntimeProject> = {},
): RuntimeProject {
  return {
    id: 'direct--sample',
    displayName: 'Direct · Sample',
    status: 'ready',
    profile: { id: 'direct', revision: 'v1' },
    dataset: { id: 'sample', ontologySha256: 'a'.repeat(64) },
    stale: false,
    url: 'ws://127.0.0.1/runtimes/direct--sample/acp',
    cwd: '.',
    ...overrides,
  };
}

describe('Runtime store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    apiMocks.getRuntimeProjects.mockReset();
    apiMocks.createRuntimeProject.mockReset();
    apiMocks.deleteRuntimeProject.mockReset();
    apiMocks.getRuntimeProjects.mockResolvedValue([]);
    apiMocks.createRuntimeProject.mockResolvedValue();
    apiMocks.deleteRuntimeProject.mockResolvedValue();
  });

  it('distinguishes runnable and stale read-only Runtime Projects', () => {
    const store = useRuntimeStore();
    store.updateFromEvent([
      project(),
      project({ id: 'stale--sample', stale: true }),
      project({ id: 'failed--sample', status: 'initialization_failed' }),
    ]);

    expect(store.isRunnable('direct--sample')).toBe(true);
    expect(store.canReadSessions('direct--sample')).toBe(true);
    expect(store.isRunnable('stale--sample')).toBe(false);
    expect(store.canReadSessions('stale--sample')).toBe(true);
    expect(store.canReadSessions('failed--sample')).toBe(false);
  });

  it('creates through the fixed Profile/Dataset contract and refreshes', async () => {
    const created = project({ status: 'initializing' });
    apiMocks.getRuntimeProjects.mockResolvedValue([created]);
    const store = useRuntimeStore();

    await store.createProject('direct', 'sample');

    expect(apiMocks.createRuntimeProject).toHaveBeenCalledWith(
      'direct',
      'sample',
    );
    expect(store.projects).toEqual([created]);
    expect(store.creating).toBe(false);
    store.stopPolling();
  });

  it('deletes by Runtime ID and removes the local project', async () => {
    const store = useRuntimeStore();
    store.updateFromEvent([project()]);
    apiMocks.getRuntimeProjects.mockResolvedValue([]);

    await store.deleteProject('direct--sample');

    expect(apiMocks.deleteRuntimeProject).toHaveBeenCalledWith(
      'direct--sample',
    );
    expect(store.projects).toEqual([]);
    expect(store.deletingIds.size).toBe(0);
  });
});
