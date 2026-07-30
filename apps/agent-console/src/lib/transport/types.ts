// Narrow byte-stream boundary between the loopback WebSocket and ACP JSON-RPC.

/** Unsubscribe function returned by `onMessage` / `onClose`. */
export type Unsubscribe = () => void;

export interface AcpTransport {
  /** Send a single JSON-RPC frame (already JSON-encoded). */
  send(json: string): Promise<void>;

  /**
   * Register a listener for inbound JSON-RPC frames. Each frame is delivered
   * as a complete JSON string (no partial chunks).
   */
  onMessage(cb: (json: string) => void): Unsubscribe;

  /**
   * Register a listener that fires once when the transport closes — either
   * because the remote peer hung up or `close()` was called. The optional
   * reason describes why.
   */
  onClose(cb: (reason?: string) => void): Unsubscribe;

  /** Tear down the transport and release all resources. Idempotent. */
  close(): Promise<void>;
}

/**
 * Lightweight emitter used by the one WebSocket transport. Pulling in an
 * EventEmitter dependency would be more code than this boundary.
 */
export class TransportListeners<T> {
  private callbacks = new Set<(value: T) => void>();

  add(cb: (value: T) => void): Unsubscribe {
    this.callbacks.add(cb);
    return () => {
      this.callbacks.delete(cb);
    };
  }

  emit(value: T): void {
    // Snapshot to avoid mutation during iteration if a callback unsubscribes.
    for (const cb of [...this.callbacks]) {
      try {
        cb(value);
      } catch {
        // Listener errors may embed an ACP payload; do not duplicate them into
        // the browser console.
        console.error('Transport listener failed');
      }
    }
  }

  clear(): void {
    this.callbacks.clear();
  }
}
