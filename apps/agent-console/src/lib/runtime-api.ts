import type {
  DatasetCatalogEntry,
  ProfileCatalogEntry,
  RuntimeProject,
  RuntimeStatus,
} from './types';

const RUNTIME_STATUSES = new Set<RuntimeStatus>([
  'initializing',
  'ready',
  'active',
  'initialization_failed',
  'deleting',
  'delete_failed',
]);

interface RuntimeProfilePayload {
  id: string;
  revision: string;
  title: string;
  description?: string;
}

interface RuntimeDatasetPayload {
  id: string;
  title: string;
  description?: string;
  ontology_sha256: string;
}

interface RuntimePayload {
  id: string;
  display_name: string;
  created_at?: string;
  status: RuntimeStatus;
  profile: RuntimeProfilePayload;
  dataset: RuntimeDatasetPayload;
  ws_url: string;
  stale?: boolean;
  last_error?: unknown;
}

export class RuntimeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'RuntimeApiError';
  }
}

export async function getProfileCatalog(): Promise<ProfileCatalogEntry[]> {
  const payload = await getJson('/profiles', 'Profile catalog');
  if (!isRecord(payload) || !Array.isArray(payload.profiles)) {
    throw new Error('Profile catalog returned an invalid response');
  }
  return payload.profiles.map((value, index) => {
    if (!isRecord(value)) {
      throw new Error(`Profile catalog entry ${index + 1} is invalid`);
    }
    const { id, revision, title, description } = value;
    if (!(
      isSafeId(id) &&
      typeof revision === 'string' &&
      typeof title === 'string' &&
      typeof description === 'string'
    )) {
      throw new Error(`Profile catalog entry ${index + 1} is invalid`);
    }
    return { id, revision, title, description };
  });
}

export async function getDatasetCatalog(): Promise<DatasetCatalogEntry[]> {
  const payload = await getJson('/datasets', 'Dataset catalog');
  if (!isRecord(payload) || !Array.isArray(payload.datasets)) {
    throw new Error('Dataset catalog returned an invalid response');
  }
  return payload.datasets.map((value, index) => {
    if (!isRecord(value)) {
      throw new Error(`Dataset catalog entry ${index + 1} is invalid`);
    }
    const { id, title, description, ontology_sha256: ontologySha256 } = value;
    if (!(
      isSafeId(id) &&
      typeof title === 'string' &&
      typeof description === 'string' &&
      isSha256(ontologySha256)
    )) {
      throw new Error(`Dataset catalog entry ${index + 1} is invalid`);
    }
    return { id, title, description, ontologySha256 };
  });
}

export async function getRuntimeProjects(): Promise<RuntimeProject[]> {
  const payload = await getJson('/runtimes', 'Runtime catalog');
  if (!isRecord(payload) || !Array.isArray(payload.runtimes)) {
    throw new Error('Runtime catalog returned an invalid response');
  }
  return payload.runtimes.map((value, index) => {
    if (!isRuntimePayload(value)) {
      throw new Error(`Runtime catalog entry ${index + 1} is invalid`);
    }
    return {
      id: value.id,
      displayName: value.display_name,
      ...(typeof value.created_at === 'string'
        ? { createdAt: value.created_at }
        : {}),
      status: value.status,
      profile: { ...value.profile },
      dataset: {
        id: value.dataset.id,
        title: value.dataset.title,
        ...(value.dataset.description
          ? { description: value.dataset.description }
          : {}),
        ontologySha256: value.dataset.ontology_sha256,
      },
      stale: value.stale === true,
      lastError: normalizeRuntimeError(value.last_error),
      url: toWebSocketUrl(value.ws_url),
      cwd: '.' as const,
    };
  });
}

export async function createRuntimeProject(
  profileId: string,
  datasetId: string,
): Promise<void> {
  const response = await fetch('/runtimes', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    credentials: 'same-origin',
    body: JSON.stringify({
      profile_id: profileId,
      dataset_id: datasetId,
    }),
  });
  if (response.status === 202) return;
  throw await runtimeApiError(response, 'Runtime creation failed');
}

export async function deleteRuntimeProject(runtimeId: string): Promise<void> {
  const response = await fetch(`/runtimes/${encodeURIComponent(runtimeId)}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  });
  if (response.ok) return;
  throw await runtimeApiError(response, 'Runtime deletion failed');
}

export async function deleteRuntimeSession(
  runtimeId: string,
  sessionId: string,
): Promise<void> {
  const response = await fetch(
    `/runtimes/${encodeURIComponent(runtimeId)}/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    },
  );
  if (response.ok) return;
  throw await runtimeApiError(response, 'Conversation deletion failed');
}

export function getAppVersion(): string {
  const version = (import.meta.env as Record<string, string | undefined>)
    .VITE_APP_VERSION;
  return version ?? '0.0.0-web';
}

async function getJson(path: string, label: string): Promise<unknown> {
  const response = await fetch(path, {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  });
  if (!response.ok) throw await runtimeApiError(response, `${label} request failed`);
  return response.json();
}

async function runtimeApiError(
  response: Response,
  fallback: string,
): Promise<RuntimeApiError> {
  let code: string | undefined;
  let message = `${fallback} (${response.status})`;
  try {
    const payload: unknown = await response.json();
    if (isRecord(payload)) {
      if (typeof payload.error === 'string') code = payload.error;
      if (typeof payload.message === 'string' && payload.message.trim()) {
        message = payload.message;
      }
    }
  } catch {
    // Preserve the status-based fallback for an empty or malformed body.
  }
  return new RuntimeApiError(message, response.status, code);
}

function toWebSocketUrl(relativeUrl: string): string {
  const url = new URL(relativeUrl, window.location.href);
  url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function isRuntimePayload(value: unknown): value is RuntimePayload {
  if (!isRecord(value)) return false;
  const profile = value.profile;
  const dataset = value.dataset;
  return (
    isSafeId(value.id) &&
    typeof value.display_name === 'string' &&
    value.display_name.trim().length > 0 &&
    (value.created_at === undefined || typeof value.created_at === 'string') &&
    typeof value.status === 'string' &&
    RUNTIME_STATUSES.has(value.status as RuntimeStatus) &&
    isRecord(profile) &&
    isSafeId(profile.id) &&
    typeof profile.revision === 'string' &&
    typeof profile.title === 'string' &&
    profile.title.trim().length > 0 &&
    isOptionalText(profile.description) &&
    isRecord(dataset) &&
    isSafeId(dataset.id) &&
    typeof dataset.title === 'string' &&
    dataset.title.trim().length > 0 &&
    isOptionalText(dataset.description) &&
    isSha256(dataset.ontology_sha256) &&
    typeof value.ws_url === 'string' &&
    value.ws_url.startsWith('/runtimes/')
  );
}

function isOptionalText(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*(?:--[a-z0-9]+(?:-[a-z0-9]+)*)?$/.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function normalizeRuntimeError(
  value: unknown,
): RuntimeProject['lastError'] {
  if (typeof value === 'string' && value.trim()) {
    return { message: value.trim().slice(0, 1_000) };
  }
  if (!isRecord(value)) return undefined;
  const message =
    typeof value.message === 'string' && value.message.trim()
      ? value.message.trim().slice(0, 1_000)
      : undefined;
  const code =
    typeof value.code === 'string' && value.code.trim()
      ? value.code.trim().slice(0, 120)
      : undefined;
  if (message) return { message, code };
  return code
    ? {
        code,
        message: 'The Runtime operation failed. Inspect Bridge logs for details.',
      }
    : undefined;
}
