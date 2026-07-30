// WebSocket transport for the same-origin loopback ACP Bridge.
//
// Design notes:
// - A text `MessageEvent` may contain one JSON-RPC object or multiple
//   newline-delimited objects. Binary frames are not part of the wire format.
// - `close()` is idempotent; the unhealthy-states (closing/closed) are mapped
//   to no-ops so callers don't have to track them themselves.
// - Reconnection belongs to the Session store because a new socket creates a
//   new OpenCode ACP process and history must be restored explicitly.
import { TransportListeners, type AcpTransport, type Unsubscribe } from './types';

/** Options accepted by `WebSocketTransport.connect`. */
export interface WebSocketTransportOptions {
  /** Full same-origin ws:// or wss:// Profile endpoint. */
  url: string;
  /** Override the connection timeout (ms). Defaults to 15 seconds. */
  connectTimeoutMs?: number;
  /** Inject a constructor for tests. */
  WebSocketCtor?: typeof WebSocket;
}

export class WebSocketTransport implements AcpTransport {
  private readonly messageListeners = new TransportListeners<string>();
  private readonly closeListeners = new TransportListeners<string | undefined>();
  private ws: WebSocket | null = null;
  private closed = false;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (ev) => this.handleMessage(ev));
    ws.addEventListener('close', (ev) =>
      this.handleClose(`websocket closed (code=${ev.code}, reason=${ev.reason || 'unknown'})`)
    );
    ws.addEventListener('error', () => {
      // The `close` event always fires after `error`, so we forward only
      // there to avoid double-emitting close to listeners.
    });
  }

  /**
   * Connect a new WebSocket and resolve once it is OPEN.
   *
   * Rejects on connect timeout, on a `close` event before `open`, or on
   * `error` events that arrive before `open`.
   */
  static async connect(opts: WebSocketTransportOptions): Promise<WebSocketTransport> {
    const Ctor = opts.WebSocketCtor ?? globalThis.WebSocket;
    if (typeof Ctor !== 'function') {
      throw new Error('WebSocket is not available in this environment');
    }
    if (!opts.url) {
      throw new Error('WebSocketTransport requires a url');
    }

    const ws = new Ctor(opts.url);
    const timeoutMs = opts.connectTimeoutMs ?? 15000;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const timer = setTimeout(() => {
        settle(() => {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          reject(new Error(`WebSocket connect timed out after ${timeoutMs}ms`));
        });
      }, timeoutMs);

      ws.addEventListener('open', () => {
        clearTimeout(timer);
        settle(() => resolve());
      });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        settle(() => reject(new Error('WebSocket connect failed')));
      });
      ws.addEventListener('close', (ev) => {
        clearTimeout(timer);
        settle(() =>
          reject(
            new Error(
              `WebSocket closed before open (code=${ev.code}, reason=${ev.reason || 'unknown'})`
            )
          )
        );
      });
    });

    return new WebSocketTransport(ws);
  }

  private handleMessage(ev: MessageEvent): void {
    if (typeof ev.data === 'string') {
      // Frames may carry one or more newline-delimited JSON objects.
      // Stdio↔WS bridges (e.g. @rebornix/stdio-to-ws) forward the agent's
      // stdout chunks verbatim, which can contain multiple NDJSON lines in
      // a single WS message. Split here so each consumer sees exactly one
      // JSON-RPC frame, matching the stdio transport's behaviour.
      const data = ev.data;
      if (data.indexOf('\n') === -1) {
        const trimmed = data.trim();
        if (trimmed.length > 0) this.messageListeners.emit(trimmed);
        return;
      }
      for (const line of data.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length > 0) this.messageListeners.emit(trimmed);
      }
    } else {
      // Binary frames are not part of ACP. Surface a clear error rather than
      // silently dropping them, without logging the possibly-sensitive frame.
      console.error('WebSocketTransport received a non-string frame');
    }
  }

  private handleClose(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.closeListeners.emit(reason);
    this.messageListeners.clear();
    this.closeListeners.clear();
    this.ws = null;
  }

  async send(json: string): Promise<void> {
    if (this.closed || !this.ws) {
      throw new Error('WebSocketTransport is closed');
    }
    if (this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(
        `WebSocketTransport not open (readyState=${this.ws.readyState})`
      );
    }
    // Always terminate frames with '\n'. Native ACP-over-WS servers tolerate
    // trailing whitespace (JSON.parse / NDJSON readers ignore it), and stdio↔WS
    // bridges (e.g. @rebornix/stdio-to-ws) forward the WS payload verbatim to
    // the agent's stdin, which expects newline-delimited JSON. Without this
    // suffix the child blocks on `readline()` and we time out on `initialize`.
    const frame = json.endsWith('\n') ? json : json + '\n';
    this.ws.send(frame);
  }

  onMessage(cb: (json: string) => void): Unsubscribe {
    return this.messageListeners.add(cb);
  }

  onClose(cb: (reason?: string) => void): Unsubscribe {
    return this.closeListeners.add(cb);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    if (this.ws) {
      try {
        this.ws.close(1000, 'client closed');
      } catch (e) {
        console.warn('Error closing WebSocket:', e);
      }
    }
    // The browser will deliver a `close` event on a separate tick. If it
    // does, `handleClose` runs first and sets `this.closed = true`, in
    // which case our microtask below is a no-op. If, however, the close
    // event never fires (e.g. the WS was already in CLOSING/CLOSED state
    // and the browser elides the event), we synthesise a close so
    // listeners aren't left waiting forever.
    queueMicrotask(() => {
      if (!this.closed) {
        this.handleClose('closed by client');
      }
    });
  }
}
