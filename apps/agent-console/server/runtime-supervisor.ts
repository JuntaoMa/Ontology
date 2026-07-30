import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  buildChildEnvironment,
  buildRuntimeVariables,
} from "./opencode-runtime.js";
import { expandRuntimeArguments } from "./profile.js";
import type { LoadedRuntime } from "./runtime-manifest.js";
import { writeFileAtomic } from "./safe-files.js";

const MAX_PROCESS_LOG_BYTES = 512 * 1024;
const TERMINATE_GRACE_MS = 2_000;
const FORCE_SETTLE_MS = 1_000;
const PROCESS_POLL_MS = 25;

type SpawnChild = typeof spawn;

interface ProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
}

interface ManagedProcess {
  child: ChildProcessWithoutNullStreams;
  exited: Promise<ProcessExit>;
  finished: boolean;
}

export class RuntimeProcessError extends Error {
  readonly code:
    | "initializer_spawn_failed"
    | "initializer_failed"
    | "initializer_timeout"
    | "initializer_cancelled"
    | "process_stop_failed";

  constructor(code: RuntimeProcessError["code"], options?: ErrorOptions) {
    super(code.replaceAll("_", " "), options);
    this.name = "RuntimeProcessError";
    this.code = code;
  }
}

/**
 * Tracks finite Initializers. A handle remains registered until the child
 * (and, on POSIX, its complete process group) is confirmed gone, so a failed
 * stop can be safely retried.
 */
export class RuntimeSupervisor {
  private readonly initializer = new Map<string, ManagedProcess>();
  private readonly cancelledInitializers = new Set<string>();
  private readonly spawnChild: SpawnChild;

  constructor(options: { spawnChild?: SpawnChild } = {}) {
    this.spawnChild = options.spawnChild ?? spawn;
  }

  hasInitializer(runtimeId: string): boolean {
    return this.initializer.has(runtimeId);
  }

  async runInitializer(
    runtime: LoadedRuntime,
    sourceEnvironment: NodeJS.ProcessEnv = process.env,
  ): Promise<void> {
    const declaration = runtime.profile.initializer;
    if (!declaration) return;
    const runtimeId = runtime.manifest.id;
    if (this.initializer.has(runtimeId)) {
      throw new RuntimeProcessError("initializer_spawn_failed");
    }

    await mkdir(runtime.paths.logs, { recursive: true, mode: 0o700 });
    const environment = buildChildEnvironment(runtime, sourceEnvironment);
    const args = expandRuntimeArguments(
      declaration.args,
      buildRuntimeVariables(runtime),
    );
    let managed: ManagedProcess;
    try {
      managed = createManagedProcess(
        this.spawnChild(
          declaration.command,
          args,
          childOptions(runtime.paths.workspace, environment),
        ),
      );
    } catch (error) {
      throw new RuntimeProcessError("initializer_spawn_failed", { cause: error });
    }
    this.initializer.set(runtimeId, managed);

    const output = new BoundedOutput(environment);
    managed.child.stdin.on("error", () => undefined);
    managed.child.stdout.on("data", (chunk: Buffer | string) =>
      output.add("stdout", chunk),
    );
    managed.child.stderr.on("data", (chunk: Buffer | string) =>
      output.add("stderr", chunk),
    );
    managed.child.stdin.end();

    let timer: NodeJS.Timeout | undefined;
    let timedOut = false;
    try {
      const result = await Promise.race([
        managed.exited,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject(new RuntimeProcessError("initializer_timeout"));
          }, declaration.timeoutMs);
          timer.unref();
        }),
      ]);
      if (result.error) {
        throw new RuntimeProcessError("initializer_spawn_failed", {
          cause: result.error,
        });
      }
      if (result.code !== 0) {
        throw new RuntimeProcessError("initializer_failed");
      }
      // A finite Initializer may not daemonize descendants and then exit.
      if (!(await isManagedStopped(managed))) {
        await terminateManaged(managed);
        throw new RuntimeProcessError("initializer_failed");
      }
    } catch (error) {
      try {
        await terminateManaged(managed);
      } catch (stopError) {
        throw stopError;
      }
      if (this.cancelledInitializers.has(runtimeId)) {
        throw new RuntimeProcessError("initializer_cancelled", { cause: error });
      }
      if (
        timedOut ||
        error instanceof RuntimeProcessError &&
          error.code === "initializer_timeout"
      ) {
        throw new RuntimeProcessError("initializer_timeout", { cause: error });
      }
      throw error instanceof RuntimeProcessError
        ? error
        : new RuntimeProcessError("initializer_failed", { cause: error });
    } finally {
      if (timer) clearTimeout(timer);
      if (
        this.initializer.get(runtimeId) === managed &&
        await isManagedStopped(managed)
      ) {
        this.initializer.delete(runtimeId);
        this.cancelledInitializers.delete(runtimeId);
      }
      await writeFileAtomic(
        path.join(runtime.paths.logs, "initializer.log"),
        output.toString(),
      ).catch(() => undefined);
    }
  }

  async stopInitializer(runtimeId: string): Promise<void> {
    const managed = this.initializer.get(runtimeId);
    if (!managed) return;
    this.cancelledInitializers.add(runtimeId);
    await terminateManaged(managed);
    if (this.initializer.get(runtimeId) === managed) {
      this.initializer.delete(runtimeId);
    }
    this.cancelledInitializers.delete(runtimeId);
  }

  async close(): Promise<void> {
    const ids = [...this.initializer.keys()];
    const results = await Promise.allSettled(
      ids.map(async (id) => {
        await this.stopInitializer(id);
      }),
    );
    if (results.some((result) => result.status === "rejected")) {
      throw new RuntimeProcessError("process_stop_failed");
    }
  }

}

function childOptions(
  cwd: string,
  environment: NodeJS.ProcessEnv,
): {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdio: ["pipe", "pipe", "pipe"];
  detached: boolean;
  windowsHide: true;
} {
  return {
    cwd,
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  };
}

function createManagedProcess(
  child: ChildProcessWithoutNullStreams,
): ManagedProcess {
  const managed: ManagedProcess = {
    child,
    exited: Promise.resolve({ code: null, signal: null }),
    finished: false,
  };
  managed.exited = new Promise<ProcessExit>((resolve) => {
    let settled = false;
    const finish = (result: ProcessExit): void => {
      if (settled) return;
      settled = true;
      managed.finished = true;
      resolve(result);
    };
    child.once("error", (error) =>
      finish({ code: null, signal: null, error }),
    );
    child.once("exit", (code, signal) => finish({ code, signal }));
  });
  return managed;
}

async function terminateManaged(managed: ManagedProcess): Promise<void> {
  if (await isManagedStopped(managed)) return;
  await terminateProcessTree(managed.child);
}

export async function terminateProcessTree(
  child: ChildProcessWithoutNullStreams,
  options: {
    terminateGraceMs?: number;
    forceSettleMs?: number;
  } = {},
): Promise<void> {
  if (process.platform === "win32") {
    throw new RuntimeProcessError("process_stop_failed", {
      cause: new Error(
        "Native Windows process-tree cleanup is unsupported; use WSL",
      ),
    });
  }
  if (isChildTreeStopped(child)) return;
  // A ChildProcess without a pid never crossed the spawn boundary, so it
  // cannot own a process group that needs deletion-time supervision.
  if (child.pid === undefined) {
    if (!child.stdin.writableEnded) child.stdin.end();
    return;
  }
  if (!child.stdin.writableEnded) child.stdin.end();
  signalChildTree(child, "SIGTERM");
  if (
    await waitUntilChildTreeStopped(
      child,
      options.terminateGraceMs ?? TERMINATE_GRACE_MS,
    )
  ) {
    return;
  }
  signalChildTree(child, "SIGKILL");
  if (
    !(await waitUntilChildTreeStopped(
      child,
      options.forceSettleMs ?? FORCE_SETTLE_MS,
    ))
  ) {
    throw new RuntimeProcessError("process_stop_failed");
  }
}

async function waitUntilChildTreeStopped(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isChildTreeStopped(child)) return true;
    await delay(Math.min(PROCESS_POLL_MS, Math.max(1, deadline - Date.now())));
  }
  return isChildTreeStopped(child);
}

async function isManagedStopped(managed: ManagedProcess): Promise<boolean> {
  return managed.finished && managed.child.pid === undefined ||
    isChildTreeStopped(managed.child);
}

function isChildTreeStopped(
  child: ChildProcessWithoutNullStreams,
): boolean {
  const pid = child.pid;
  if (process.platform !== "win32" && pid !== undefined) {
    return !processGroupExists(pid);
  }
  return child.exitCode !== null || child.signalCode !== null;
}

function processGroupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return !(isNodeError(error) && error.code === "ESRCH");
  }
}

function signalChildTree(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
): void {
  if (process.platform !== "win32" && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall through for test doubles and already-exited process groups.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // The bounded process/group check decides whether deletion may proceed.
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref();
  });
}

class BoundedOutput {
  private stdout = "";
  private stderr = "";
  private bytes = 0;
  private truncated = false;

  constructor(private readonly environment: NodeJS.ProcessEnv) {}

  add(channel: "stdout" | "stderr", chunk: Buffer | string): void {
    if (this.truncated) return;
    const remaining = MAX_PROCESS_LOG_BYTES - this.bytes;
    if (remaining <= 0) {
      this.truncated = true;
      return;
    }
    const buffer = Buffer.from(chunk);
    const accepted = buffer.subarray(0, remaining);
    const text = accepted.toString();
    if (channel === "stdout") this.stdout += text;
    else this.stderr += text;
    this.bytes += accepted.length;
    if (accepted.length < buffer.length) this.truncated = true;
  }

  toString(): string {
    const stdout = redactSecrets(this.stdout, this.environment);
    const stderr = redactSecrets(this.stderr, this.environment);
    return (
      `${stdout ? `[stdout]\n${stdout}` : ""}` +
      `${stderr ? `\n[stderr]\n${stderr}` : ""}` +
      `${this.truncated ? "\n[log truncated]\n" : ""}`
    );
  }
}

function redactSecrets(
  text: string,
  environment: NodeJS.ProcessEnv,
): string {
  let result = text;
  for (const [name, value] of Object.entries(environment)) {
    if (
      value &&
      value.length >= 4 &&
      /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|CREDENTIAL)/i.test(name)
    ) {
      result = result.split(value).join("[REDACTED]");
    }
  }
  return result;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
