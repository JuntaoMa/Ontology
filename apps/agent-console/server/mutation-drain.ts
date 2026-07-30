export class MutationRejectedError extends Error {
  constructor() {
    super("Server is shutting down");
    this.name = "MutationRejectedError";
  }
}

/**
 * Prevents shutdown from closing process managers while an accepted HTTP
 * mutation is still waiting on request input or manager work.
 */
export class MutationDrain {
  private accepting = true;
  private readonly active = new Set<Promise<unknown>>();

  run<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.accepting) {
      return Promise.reject(new MutationRejectedError());
    }
    const result = Promise.resolve().then(operation);
    this.active.add(result);
    void result.finally(() => this.active.delete(result)).catch(() => undefined);
    return result;
  }

  async stopAcceptingAndDrain(): Promise<void> {
    this.accepting = false;
    await Promise.allSettled([...this.active]);
  }
}
