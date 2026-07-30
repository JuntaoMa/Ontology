// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRuntimeProject,
  getRuntimeProjects,
  RuntimeApiError,
} from './runtime-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Runtime HTTP projection', () => {
  it('maps only the redacted Runtime contract and fixes browser cwd to dot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            runtimes: [
              {
                id: 'direct--sample',
                display_name: 'Direct · Sample',
                created_at: '2026-07-30T10:00:00.000Z',
                status: 'ready',
                profile: {
                  id: 'direct',
                  revision: 'v1',
                  title: 'Direct',
                  description: 'Direct context snapshot.',
                },
                dataset: {
                  id: 'sample',
                  title: 'Sample',
                  description: 'Sample Dataset snapshot.',
                  ontology_sha256: 'a'.repeat(64),
                },
                ws_url: '/runtimes/direct--sample/acp',
                stale: false,
                last_error: null,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await expect(getRuntimeProjects()).resolves.toEqual([
      expect.objectContaining({
        id: 'direct--sample',
        cwd: '.',
        createdAt: '2026-07-30T10:00:00.000Z',
        url: 'ws://localhost:3000/runtimes/direct--sample/acp',
        profile: expect.objectContaining({ title: 'Direct' }),
        dataset: expect.objectContaining({ title: 'Sample' }),
      }),
    ]);
  });

  it('rejects the entire catalog instead of hiding an invalid Runtime', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            runtimes: [
              {
                id: 'direct--sample',
                display_name: 'Direct · Sample',
                status: 'ready',
                profile: { id: 'direct', revision: 'v1' },
                dataset: {
                  id: 'sample',
                  ontology_sha256: 'not-a-digest',
                },
                ws_url: '/runtimes/direct--sample/acp',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await expect(getRuntimeProjects()).rejects.toThrow(
      'Runtime catalog entry 1 is invalid',
    );
  });

  it('sends only Profile and Dataset IDs and retains stable API errors', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: 'runtime_exists',
          message: 'This Runtime Project already exists.',
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(createRuntimeProject('direct', 'sample')).rejects.toMatchObject({
      name: 'RuntimeApiError',
      status: 409,
      code: 'runtime_exists',
    } satisfies Partial<RuntimeApiError>);
    expect(fetchMock).toHaveBeenCalledWith(
      '/runtimes',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          profile_id: 'direct',
          dataset_id: 'sample',
        }),
      }),
    );
  });
});
