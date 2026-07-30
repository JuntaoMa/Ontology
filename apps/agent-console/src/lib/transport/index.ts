// The Console ships only as a browser client for the same-origin ACP Bridge.
import type { AgentConfig } from '../types';
import type { AcpTransport } from './types';
import { WebSocketTransport } from './websocket';

/**
 * Create the sole supported transport for a server-published Profile.
 */
export async function createTransport(
  agentName: string,
  config: AgentConfig,
): Promise<AcpTransport> {
  if (!config.url) {
    throw new Error(`Agent '${agentName}' is missing its Bridge WebSocket URL`);
  }
  return WebSocketTransport.connect({ url: config.url });
}

export type { AcpTransport, Unsubscribe } from './types';
export { WebSocketTransport } from './websocket';
