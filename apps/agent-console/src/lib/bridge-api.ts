import type { AgentConfig, AgentsConfig } from './types';

interface PublicAgentProfile {
  id: string;
  revision: string;
  title: string;
  description: string;
  status: string;
  ws_url: string;
  cwd: string;
  model: {
    id: string;
    source: 'opencode' | 'profile';
  };
  retrieval?: {
    vector_top_k: number;
    graph_algorithm: string;
  };
  ontology: {
    id: string;
  };
}

export async function getProfiles(): Promise<AgentsConfig> {
  const response = await fetch('/agents', {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  });
  if (!response.ok) {
    throw new Error(`Agent Profile catalog request failed (${response.status})`);
  }

  const payload = (await response.json()) as { agents?: unknown };
  if (!Array.isArray(payload.agents)) {
    throw new Error('Agent Profile catalog returned an invalid response');
  }

  const agents: Record<string, AgentConfig> = {};
  for (const candidate of payload.agents) {
    if (!isPublicAgentProfile(candidate)) continue;
    agents[candidate.id] = {
      id: candidate.id,
      revision: candidate.revision,
      title: candidate.title,
      description: candidate.description,
      status: candidate.status,
      cwd: candidate.cwd,
      url: toWebSocketUrl(candidate.ws_url),
      model: candidate.model,
      retrieval: candidate.retrieval
        ? {
            vectorTopK: candidate.retrieval.vector_top_k,
            graphAlgorithm: candidate.retrieval.graph_algorithm,
          }
        : undefined,
      ontology: candidate.ontology,
    };
  }
  return { agents };
}

export async function deleteProfileSession(
  profileId: string,
  sessionId: string,
): Promise<void> {
  const response = await fetch(
    `/agents/${encodeURIComponent(profileId)}/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    },
  );
  if (response.ok) return;

  let message = `Conversation deletion failed (${response.status})`;
  try {
    const payload = (await response.json()) as {
      error?: unknown;
      message?: unknown;
    };
    if (typeof payload.message === 'string' && payload.message.trim()) {
      message = payload.message;
    } else if (payload.error === 'session_busy') {
      message = 'This conversation is still running and cannot be deleted';
    }
  } catch {
    // Keep the status-based fallback for malformed or empty responses.
  }
  throw new Error(message);
}

export function getAppVersion(): string {
  const version = (import.meta.env as Record<string, string | undefined>)
    .VITE_APP_VERSION;
  return version ?? '0.0.0-web';
}

function toWebSocketUrl(relativeUrl: string): string {
  const url = new URL(relativeUrl, window.location.href);
  url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function isPublicAgentProfile(value: unknown): value is PublicAgentProfile {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<PublicAgentProfile>;
  return (
    typeof candidate.id === 'string' &&
    /^[a-z0-9-]+$/.test(candidate.id) &&
    typeof candidate.revision === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.description === 'string' &&
    typeof candidate.status === 'string' &&
    typeof candidate.ws_url === 'string' &&
    candidate.ws_url.startsWith('/agents/') &&
    typeof candidate.cwd === 'string' &&
    isPublicModel(candidate.model) &&
    (candidate.retrieval === undefined ||
      isPublicRetrieval(candidate.retrieval)) &&
    typeof candidate.ontology === 'object' &&
    candidate.ontology !== null &&
    typeof candidate.ontology.id === 'string'
  );
}

function isPublicModel(value: unknown): value is PublicAgentProfile['model'] {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<PublicAgentProfile['model']>;
  return (
    typeof candidate.id === 'string' &&
    (candidate.source === 'opencode' || candidate.source === 'profile')
  );
}

function isPublicRetrieval(
  value: unknown,
): value is NonNullable<PublicAgentProfile['retrieval']> {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<
    NonNullable<PublicAgentProfile['retrieval']>
  >;
  return (
    typeof candidate.vector_top_k === 'number' &&
    Number.isInteger(candidate.vector_top_k) &&
    candidate.vector_top_k > 0 &&
    typeof candidate.graph_algorithm === 'string'
  );
}
