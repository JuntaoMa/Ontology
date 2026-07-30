// The Console ships only as a browser client for the same-origin ACP Bridge.
import type { RuntimeProject } from '../types';
import type { AcpTransport } from './types';
import { WebSocketTransport } from './websocket';

/**
 * Create the sole supported transport for a server-published Runtime Project.
 */
export async function createTransport(
  runtimeId: string,
  project: RuntimeProject,
): Promise<AcpTransport> {
  if (!project.url) {
    throw new Error(
      `Runtime Project '${runtimeId}' is missing its Bridge WebSocket URL`,
    );
  }
  return WebSocketTransport.connect({ url: project.url });
}

export type { AcpTransport, Unsubscribe } from './types';
export { WebSocketTransport } from './websocket';
