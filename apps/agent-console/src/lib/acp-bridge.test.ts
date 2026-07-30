import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcpClientBridge, AcpRpcError } from './acp-bridge';
import type { AcpTransport, Unsubscribe } from './transport/types';

class FakeTransport implements AcpTransport {
  readonly sent: string[] = [];
  private readonly messages = new Set<(message: string) => void>();
  private readonly closes = new Set<(reason?: string) => void>();

  async send(message: string): Promise<void> {
    this.sent.push(message);
  }

  onMessage(callback: (message: string) => void): Unsubscribe {
    this.messages.add(callback);
    return () => this.messages.delete(callback);
  }

  onClose(callback: (reason?: string) => void): Unsubscribe {
    this.closes.add(callback);
    return () => this.closes.delete(callback);
  }

  async close(): Promise<void> {}

  emitMessage(message: unknown): void {
    const frame = typeof message === 'string' ? message : JSON.stringify(message);
    for (const callback of [...this.messages]) callback(frame);
  }

  emitClose(reason = 'test close'): void {
    for (const callback of [...this.closes]) callback(reason);
  }

  requestAt(index = this.sent.length - 1): Record<string, unknown> {
    return JSON.parse(this.sent[index]) as Record<string, unknown>;
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AcpClientBridge', () => {
  it('resolves successful responses and preserves ACP error codes', async () => {
    const transport = new FakeTransport();
    const client = new AcpClientBridge(transport);

    const initialized = client.initialize({
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    const initializeRequest = transport.requestAt();
    transport.emitMessage({
      jsonrpc: '2.0',
      id: initializeRequest.id,
      result: { protocolVersion: 1, agentCapabilities: {} },
    });
    await expect(initialized).resolves.toMatchObject({ protocolVersion: 1 });

    const authentication = client.authenticate({ methodId: 'missing' });
    const authRequest = transport.requestAt();
    transport.emitMessage({
      jsonrpc: '2.0',
      id: authRequest.id,
      error: { code: -32000, message: 'Authentication required' },
    });
    await expect(authentication).rejects.toBeInstanceOf(AcpRpcError);
    await expect(authentication).rejects.toMatchObject({
      code: -32000,
      message: 'Authentication required',
    });
  });

  it('rejects an unbounded Prompt when the transport closes', async () => {
    const transport = new FakeTransport();
    const client = new AcpClientBridge(transport);

    const prompt = client.prompt({
      sessionId: 'session-1',
      prompt: [{ type: 'text', text: 'hello' }],
    });
    transport.emitClose('socket lost');

    await expect(prompt).rejects.toThrow(
      'transport closed: socket lost',
    );
  });

  it('cleans up and rejects a timed request', async () => {
    vi.useFakeTimers();
    const transport = new FakeTransport();
    const client = new AcpClientBridge(transport);

    const initialized = client.initialize({
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    const timedOut = expect(initialized).rejects.toThrow(
      'Request timeout: initialize',
    );
    await vi.advanceTimersByTimeAsync(130_000);

    await timedOut;
    transport.emitClose();
  });

  it('settles an interactive permission as cancelled on disconnect', async () => {
    const transport = new FakeTransport();
    const client = new AcpClientBridge(transport);

    transport.emitMessage({
      jsonrpc: '2.0',
      id: 7,
      method: 'session/request_permission',
      params: {
        sessionId: 'session-1',
        toolCall: {
          toolCallId: 'tool-1',
          title: 'Run command',
          kind: 'execute',
          status: 'pending',
        },
        options: [
          {
            optionId: 'allow',
            name: 'Allow',
            kind: 'allow_once',
          },
        ],
      },
    });
    expect(client.pendingPermissionRequest.value?.sessionId).toBe('session-1');

    transport.emitClose();
    await vi.waitFor(() => {
      expect(client.pendingPermissionRequest.value).toBeNull();
      expect(
        transport.sent.some((frame) => {
          const response = JSON.parse(frame) as {
            id?: number;
            result?: { outcome?: { outcome?: string } };
          };
          return (
            response.id === 7 &&
            response.result?.outcome?.outcome === 'cancelled'
          );
        }),
      ).toBe(true);
    });
  });

  it('never includes a malformed raw frame in console output', () => {
    const transport = new FakeTransport();
    new AcpClientBridge(transport);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    transport.emitMessage('secret malformed frame');

    expect(error).toHaveBeenCalledWith('Failed to parse an ACP message');
    expect(error).not.toHaveBeenCalledWith(
      expect.stringContaining('secret malformed frame'),
    );
  });
});
