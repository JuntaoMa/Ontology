import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import path from "node:path";
import {
  buildChildEnvironment,
  prepareRuntimeConfigOverlay,
} from "./opencode-runtime.js";
import type { LoadedRuntime } from "./runtime-manifest.js";
import { terminateProcessTree } from "./runtime-supervisor.js";

const DELETE_TIMEOUT_MS = 15_000;
const DELETE_KILL_GRACE_MS = 500;
const MAX_OUTPUT_BYTES = 64 * 1024;

export interface SessionDeleteOptions {
  timeoutMs?: number;
  killGraceMs?: number;
}

interface ActiveSessionDelete {
  child: ChildProcessWithoutNullStreams;
  completion: Promise<void>;
  killGraceMs: number;
  stopFailed: boolean;
  termination?: Promise<void>;
}

export class SessionDeleteError extends Error {
  readonly kind: "unsupported" | "failed" | "timeout";

  constructor(
    kind: SessionDeleteError["kind"],
    readonly processTreeStopped = true,
  ) {
    super(
      kind === "unsupported"
        ? "This Agent Profile does not support permanent Session deletion"
        : kind === "timeout"
          ? "OpenCode Session deletion timed out"
          : "OpenCode Session deletion failed",
    );
    this.name = "SessionDeleteError";
    this.kind = kind;
  }
}

export function isOpenCodeSessionId(value: string): boolean {
  return /^ses_[A-Za-z0-9]{1,96}$/.test(value);
}

export function supportsSessionDelete(runtime: LoadedRuntime): boolean {
  if (process.platform === "win32") return false;
  const executable = path.basename(runtime.profile.agent.command).toLowerCase();
  return executable === "opencode";
}

/**
 * Owns all finite OpenCode Session-delete subprocesses so Runtime deletion and
 * server shutdown can reap or retry them before releasing filesystem state.
 */
export class SessionDeleteManager {
  private readonly active = new Map<string, ActiveSessionDelete>();

  has(runtimeId: string): boolean {
    return this.active.has(runtimeId);
  }

  needsReap(runtimeId: string): boolean {
    return this.active.get(runtimeId)?.stopFailed === true;
  }

  /**
   * Delete one durable OpenCode Session from its owning Runtime state.
   *
   * The subprocess never uses a shell. Its environment is rebuilt from the
   * same allow-list as the ACP runtime, including the Profile-isolated
   * OPENCODE_DB path.
   */
  async delete(
    runtime: LoadedRuntime,
    sessionId: string,
    sourceEnvironment: NodeJS.ProcessEnv = process.env,
    options: SessionDeleteOptions = {},
  ): Promise<void> {
    if (!supportsSessionDelete(runtime)) {
      throw new SessionDeleteError("unsupported");
    }
    if (!isOpenCodeSessionId(sessionId)) {
      throw new TypeError("Invalid OpenCode Session id");
    }
    if (this.active.has(runtime.manifest.id)) {
      await this.stopRuntime(runtime.manifest.id);
    }

    prepareRuntimeConfigOverlay(
      runtime.profile,
      runtime.paths.opencodeConfig,
    );
    const environment = buildChildEnvironment(runtime, sourceEnvironment);
    const active = startDeleteProcess(
      runtime.profile.agent.command,
      ["session", "delete", sessionId, "--pure"],
      {
        cwd: runtime.paths.workspace,
        environment,
        timeoutMs: options.timeoutMs ?? DELETE_TIMEOUT_MS,
        killGraceMs: options.killGraceMs ?? DELETE_KILL_GRACE_MS,
      },
    );
    this.active.set(runtime.manifest.id, active);
    try {
      await active.completion;
      this.deleteIfCurrent(runtime.manifest.id, active);
    } catch (error) {
      if (
        !(error instanceof SessionDeleteError) ||
        error.processTreeStopped
      ) {
        this.deleteIfCurrent(runtime.manifest.id, active);
      }
      throw error;
    }
  }

  async stopRuntime(runtimeId: string): Promise<void> {
    const active = this.active.get(runtimeId);
    if (!active) return;
    try {
      await stopActiveProcess(active);
    } catch {
      active.stopFailed = true;
      throw new SessionDeleteError("failed", false);
    }
    active.stopFailed = false;
    await active.completion.catch(() => undefined);
    this.deleteIfCurrent(runtimeId, active);
  }

  async close(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.active.keys()].map((runtimeId) =>
        this.stopRuntime(runtimeId),
      ),
    );
    if (results.some((result) => result.status === "rejected")) {
      throw new SessionDeleteError("failed", false);
    }
  }

  private deleteIfCurrent(
    runtimeId: string,
    active: ActiveSessionDelete,
  ): void {
    if (this.active.get(runtimeId) === active) {
      this.active.delete(runtimeId);
    }
  }
}

interface DeleteProcessOptions {
  cwd: string;
  environment: NodeJS.ProcessEnv;
  timeoutMs: number;
  killGraceMs: number;
}

function startDeleteProcess(
  command: string,
  args: string[],
  options: DeleteProcessOptions,
): ActiveSessionDelete {
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(command, args, {
      cwd: options.cwd,
      env: options.environment,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
  } catch {
    throw new SessionDeleteError("failed");
  }

  const active: ActiveSessionDelete = {
    child,
    completion: Promise.resolve(),
    killGraceMs: options.killGraceMs,
    stopFailed: false,
  };
  active.completion = new Promise((resolve, reject) => {
    let outputBytes = 0;
    let settlement: Promise<void> | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;

    const finishAfterProcessTreeStops = (
      error?: SessionDeleteError,
    ): void => {
      if (settlement) return;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      settlement = (async () => {
        try {
          await stopActiveProcess(active);
        } catch {
          active.stopFailed = true;
          throw new SessionDeleteError(error?.kind ?? "failed", false);
        }
        active.stopFailed = false;
        if (error) throw error;
      })();
      void settlement.then(resolve, reject);
    };

    const trackOutput = (chunk: Buffer | string): void => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > MAX_OUTPUT_BYTES) {
        finishAfterProcessTreeStops(new SessionDeleteError("failed"));
      }
    };

    child.stdout.on("data", trackOutput);
    child.stderr.on("data", trackOutput);
    child.once("error", () => {
      // A spawn error has no pid and therefore no process tree to reap.
      finishAfterProcessTreeStops(new SessionDeleteError("failed"));
    });
    child.once("exit", (code) => {
      finishAfterProcessTreeStops(
        code === 0 ? undefined : new SessionDeleteError("failed"),
      );
    });

    timeoutTimer = setTimeout(() => {
      finishAfterProcessTreeStops(new SessionDeleteError("timeout"));
    }, Math.max(1, options.timeoutMs));
    timeoutTimer.unref();
    child.stdin.on("error", () => undefined);
    child.stdin.end();
  });
  return active;
}

function stopActiveProcess(active: ActiveSessionDelete): Promise<void> {
  if (active.termination) return active.termination;
  const attempt = terminateProcessTree(active.child, {
    terminateGraceMs: Math.max(0, active.killGraceMs),
  }).finally(() => {
    if (active.termination === attempt) active.termination = undefined;
  });
  active.termination = attempt;
  return attempt;
}
