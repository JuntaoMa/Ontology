import type {
  AuthenticateRequest,
  AuthenticateResponse,
  InitializeRequest,
  InitializeResponse,
  ListSessionsRequest,
  ListSessionsResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from '@agentclientprotocol/sdk';
import { ref, type Ref } from 'vue';
import type {
  RuntimeProject,
  PermissionRequest as LocalPermissionRequest,
} from './types';
import { createToolCallInfo } from './tool-call';
import { createTransport } from './transport';
import type { AcpTransport, Unsubscribe } from './transport/types';

const JSONRPC_METHOD_NOT_FOUND = -32601;
const INITIALIZE_TIMEOUT_MS = 130_000;

interface PendingRequest {
  method: string;
  resolve: (response: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

type PermissionResolver = (response: RequestPermissionResponse) => void;

export class AcpRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'AcpRpcError';
  }
}

/**
 * Small browser-side ACP JSON-RPC client.
 *
 * The SDK's public connection currently does not reject all outstanding
 * requests when its stream closes, while a Prompt intentionally has no short
 * timeout. This bridge keeps that lifecycle explicit and never logs raw frames.
 */
export class AcpClientBridge {
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private nextRequestId = 0;
  private unlistenMessage: Unsubscribe | null;
  private unlistenClose: Unsubscribe | null;
  private permissionResolver: PermissionResolver | null = null;
  private disconnected = false;

  readonly pendingPermissionRequest: Ref<LocalPermissionRequest | null> =
    ref(null);
  onSessionUpdate: ((notification: SessionNotification) => void) | null = null;
  onTransportClose: ((reason?: string) => void) | null = null;

  constructor(private readonly transport: AcpTransport) {
    this.unlistenMessage = transport.onMessage((message) => {
      this.handleMessage(message);
    });
    this.unlistenClose = transport.onClose((reason) => {
      this.handleTransportClose(reason);
    });
  }

  async disconnect(): Promise<void> {
    if (this.disconnected) return;
    this.disconnected = true;
    this.unlistenMessage?.();
    this.unlistenMessage = null;
    this.unlistenClose?.();
    this.unlistenClose = null;
    this.rejectPendingRequests(
      new Error('transport closed: client disconnected'),
    );
    this.cancelPendingPermission();
    await this.transport.close();
  }

  private handleTransportClose(reason?: string): void {
    if (this.disconnected) return;
    this.disconnected = true;
    this.unlistenMessage = null;
    this.unlistenClose = null;
    this.rejectPendingRequests(
      new Error(`transport closed: ${reason ?? 'unknown reason'}`),
    );
    this.cancelPendingPermission();
    this.onTransportClose?.(reason);
  }

  private rejectPendingRequests(error: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      this.pendingRequests.delete(id);
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
  }

  private handleMessage(message: string): void {
    try {
      const parsed = JSON.parse(message) as unknown;
      if (!isJsonRpcObject(parsed)) {
        throw new Error('ACP frame must be an object');
      }

      if ('id' in parsed && parsed.id !== undefined && !('method' in parsed)) {
        this.handleResponse(parsed);
        return;
      }
      if ('id' in parsed && parsed.id !== undefined && 'method' in parsed) {
        if (typeof parsed.method !== 'string') {
          throw new Error('ACP method must be a string');
        }
        void this.handleRequest(
          parsed.id as number | string,
          parsed.method,
          parsed.params,
        ).catch(() => {
          // The socket can close while an interactive request is pending.
        });
        return;
      }
      if (!('id' in parsed) && typeof parsed.method === 'string') {
        this.handleNotification(parsed.method, parsed.params);
      }
    } catch {
      // Frames may contain prompts, tool output and internal paths.
      console.error('Failed to parse an ACP message');
    }
  }

  private handleResponse(response: Record<string, unknown>): void {
    if (typeof response.id !== 'number') return;
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;
    this.pendingRequests.delete(response.id);
    if (pending.timer) clearTimeout(pending.timer);

    if (
      typeof response.error === 'object' &&
      response.error !== null
    ) {
      const error = response.error as Record<string, unknown>;
      pending.reject(
        new AcpRpcError(
          typeof error.code === 'number' ? error.code : -32603,
          typeof error.message === 'string' ? error.message : 'Unknown error',
          error.data,
        ),
      );
      return;
    }
    pending.resolve(response.result);
  }

  private async handleRequest(
    id: number | string,
    method: string,
    params: unknown,
  ): Promise<void> {
    let result: unknown;
    let error: { code: number; message: string } | undefined;
    try {
      if (method === 'session/request_permission') {
        result = await this.requestPermission(
          params as RequestPermissionRequest,
        );
      } else {
        error = {
          code: JSONRPC_METHOD_NOT_FOUND,
          message: `Method not found: ${method}`,
        };
      }
    } catch (cause) {
      error = {
        code: -32603,
        message: cause instanceof Error ? cause.message : String(cause),
      };
    }

    const response = error
      ? { jsonrpc: '2.0', id, error }
      : { jsonrpc: '2.0', id, result };
    await this.transport.send(JSON.stringify(response));
  }

  private handleNotification(method: string, params: unknown): void {
    if (method === 'session/update') {
      this.onSessionUpdate?.(params as SessionNotification);
    }
  }

  private sendRequest<T>(
    method: string,
    params?: unknown,
    timeoutMs: number | null = 60_000,
  ): Promise<T> {
    if (this.disconnected) {
      return Promise.reject(new Error('transport closed'));
    }

    const id = this.nextRequestId++;
    const request = {
      jsonrpc: '2.0',
      id,
      method,
      params: params ?? {},
    };

    return new Promise<T>((resolve, reject) => {
      const pending: PendingRequest = {
        method,
        resolve: (response) => resolve(response as T),
        reject,
        timer: null,
      };
      if (timeoutMs !== null) {
        pending.timer = setTimeout(() => {
          if (this.pendingRequests.get(id) !== pending) return;
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${pending.method}`));
        }, timeoutMs);
      }
      this.pendingRequests.set(id, pending);

      void this.transport.send(JSON.stringify(request)).catch((cause) => {
        if (this.pendingRequests.get(id) !== pending) return;
        this.pendingRequests.delete(id);
        if (pending.timer) clearTimeout(pending.timer);
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      });
    });
  }

  private async sendNotification(
    method: string,
    params?: unknown,
  ): Promise<void> {
    if (this.disconnected) throw new Error('transport closed');
    await this.transport.send(
      JSON.stringify({
        jsonrpc: '2.0',
        method,
        params: params ?? {},
      }),
    );
  }

  initialize(params: InitializeRequest): Promise<InitializeResponse> {
    // Runtime startup is bounded at 120 seconds by the Bridge. Keep the
    // browser deadline slightly longer so the server owns startup failure.
    return this.sendRequest('initialize', params, INITIALIZE_TIMEOUT_MS);
  }

  newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    return this.sendRequest('session/new', params);
  }

  loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    return this.sendRequest('session/load', params, 300_000);
  }

  unstable_listSessions(
    params: ListSessionsRequest,
  ): Promise<ListSessionsResponse> {
    return this.sendRequest('session/list', params, 30_000);
  }

  prompt(params: PromptRequest): Promise<PromptResponse> {
    return this.sendRequest('session/prompt', params, null);
  }

  cancel(params: { sessionId: string }): Promise<void> {
    return this.sendNotification('session/cancel', params);
  }

  authenticate(
    params: AuthenticateRequest,
  ): Promise<AuthenticateResponse> {
    return this.sendRequest('authenticate', params);
  }

  private requestPermission(
    params: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    if (this.permissionResolver) {
      return Promise.resolve({ outcome: { outcome: 'cancelled' } });
    }
    return new Promise((resolve) => {
      this.pendingPermissionRequest.value = {
        sessionId: params.sessionId,
        toolCall: createToolCallInfo(params.toolCall),
        options: params.options.map((option) => ({
          kind: option.kind,
          name: option.name,
          optionId: option.optionId,
        })),
      };
      this.permissionResolver = resolve;
    });
  }

  resolvePermission(optionId: string): void {
    const resolve = this.permissionResolver;
    if (!resolve) return;
    this.permissionResolver = null;
    this.pendingPermissionRequest.value = null;
    resolve({ outcome: { outcome: 'selected', optionId } });
  }

  cancelPermission(): void {
    this.cancelPendingPermission();
  }

  private cancelPendingPermission(): void {
    const resolve = this.permissionResolver;
    if (!resolve) return;
    this.permissionResolver = null;
    this.pendingPermissionRequest.value = null;
    resolve({ outcome: { outcome: 'cancelled' } });
  }
}

export async function createAcpClient(
  runtime: { runtimeId: string; project: RuntimeProject },
): Promise<AcpClientBridge> {
  const transport = await createTransport(runtime.runtimeId, runtime.project);
  return new AcpClientBridge(transport);
}

function isJsonRpcObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
