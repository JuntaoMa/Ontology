import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import path from "node:path";
import {
  buildChildEnvironment,
  prepareRuntimeConfigOverlay,
} from "./opencode-runtime.js";
import type { LoadedProfile } from "./profile.js";

const DELETE_TIMEOUT_MS = 15_000;
const DELETE_KILL_GRACE_MS = 500;
const MAX_OUTPUT_BYTES = 64 * 1024;

export interface SessionDeleteOptions {
  timeoutMs?: number;
  killGraceMs?: number;
}

export class SessionDeleteError extends Error {
  readonly kind: "unsupported" | "failed" | "timeout";

  constructor(kind: SessionDeleteError["kind"]) {
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

export function supportsSessionDelete(profile: LoadedProfile): boolean {
  const executable = path.basename(profile.runtime.command).toLowerCase();
  return executable === "opencode" || executable === "opencode.exe";
}

/**
 * Delete one durable OpenCode Session from its owning Profile state.
 *
 * The subprocess never uses a shell. Its environment is rebuilt from the
 * same allow-list as the ACP runtime, including the Profile-isolated
 * OPENCODE_DB path.
 */
export async function deleteOpenCodeSession(
  profile: LoadedProfile,
  sessionId: string,
  sourceEnvironment: NodeJS.ProcessEnv = process.env,
  options: SessionDeleteOptions = {},
): Promise<void> {
  if (!supportsSessionDelete(profile)) {
    throw new SessionDeleteError("unsupported");
  }
  if (!isOpenCodeSessionId(sessionId)) {
    throw new TypeError("Invalid OpenCode Session id");
  }

  const runtimeConfigDir = path.join(profile.runtime.stateDir, "config");
  prepareRuntimeConfigOverlay(profile, runtimeConfigDir);
  const environment = buildChildEnvironment(
    profile,
    runtimeConfigDir,
    sourceEnvironment,
  );

  await runDeleteProcess(
    profile.runtime.command,
    ["session", "delete", sessionId, "--pure"],
    {
      cwd: profile.runtime.cwd,
      environment,
      timeoutMs: options.timeoutMs ?? DELETE_TIMEOUT_MS,
      killGraceMs: options.killGraceMs ?? DELETE_KILL_GRACE_MS,
    },
  );
}

interface DeleteProcessOptions {
  cwd: string;
  environment: NodeJS.ProcessEnv;
  timeoutMs: number;
  killGraceMs: number;
}

function runDeleteProcess(
  command: string,
  args: string[],
  options: DeleteProcessOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
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
      reject(new SessionDeleteError("failed"));
      return;
    }

    child.stdin.end();
    let outputBytes = 0;
    let finished = false;
    let timedOut = false;
    let forceKillTimer: NodeJS.Timeout | null = null;

    const finish = (error?: SessionDeleteError): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (error) reject(error);
      else resolve();
    };

    const terminate = (signal: NodeJS.Signals): void => {
      if (child.pid && process.platform !== "win32") {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // Fall back to the direct child handle below.
        }
      }
      try {
        child.kill(signal);
      } catch {
        // The exit handler or hard deadline still settles the Promise.
      }
    };

    const trackOutput = (chunk: Buffer | string): void => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > MAX_OUTPUT_BYTES && !timedOut) {
        terminate("SIGKILL");
        finish(new SessionDeleteError("failed"));
      }
    };

    child.stdout.on("data", trackOutput);
    child.stderr.on("data", trackOutput);
    child.once("error", () => finish(new SessionDeleteError("failed")));
    child.once("exit", (code) => {
      if (timedOut) {
        finish(new SessionDeleteError("timeout"));
      } else if (code === 0) {
        finish();
      } else {
        finish(new SessionDeleteError("failed"));
      }
    });

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      terminate("SIGTERM");
      forceKillTimer = setTimeout(() => {
        terminate("SIGKILL");
        // SIGKILL cannot be handled on POSIX. Settle independently of the
        // child event so request and shutdown latency remain strictly bounded.
        finish(new SessionDeleteError("timeout"));
      }, Math.max(0, options.killGraceMs));
      forceKillTimer.unref();
    }, Math.max(1, options.timeoutMs));
    timeoutTimer.unref();
  });
}
