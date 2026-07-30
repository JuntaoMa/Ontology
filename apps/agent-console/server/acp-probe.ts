import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import {
  PROTOCOL_VERSION,
  type AgentCapabilities,
} from "@agentclientprotocol/sdk";
import { buildRuntimeVariables } from "./opencode-runtime.js";
import { expandRuntimeArguments } from "./profile.js";
import type { LoadedRuntime } from "./runtime-manifest.js";
import { terminateProcessTree } from "./runtime-supervisor.js";

const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_CAPTURED_STDERR_BYTES = 256 * 1024;
const MAX_STDERR_CHARS = 8_000;
const SHUTDOWN_GRACE_MS = 750;

type JsonObject = Record<string, unknown>;
type ProbePhase =
  | "spawn"
  | "initialize"
  | "session-list"
  | "protocol"
  | "timeout"
  | "cleanup";

export interface AcpSmokeResult {
  protocolVersion: unknown;
  agentInfo?: {
    name?: string;
    version?: string;
  };
  agentCapabilities: AgentCapabilities | JsonObject;
  sessions: {
    count: number;
    hasMore: boolean;
  };
}

export class AcpProbeError extends Error {
  readonly phase: ProbePhase;
  readonly rpcCode?: number;
  readonly stderr?: string;

  constructor(
    message: string,
    details: {
      phase: ProbePhase;
      rpcCode?: number;
      stderr?: string;
      cause?: unknown;
    },
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "AcpProbeError";
    this.phase = details.phase;
    this.rpcCode = details.rpcCode;
    this.stderr = details.stderr;
  }
}

interface PendingRequest {
  phase: ProbePhase;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout;
}

class ProbeFailure extends Error {
  readonly phase: ProbePhase;
  readonly rpcCode?: number;

  constructor(message: string, phase: ProbePhase, rpcCode?: number) {
    super(message);
    this.name = "ProbeFailure";
    this.phase = phase;
    this.rpcCode = rpcCode;
  }
}

/**
 * Smoke-test exactly one validated Profile. This command never creates,
 * resumes, loads, prompts, or mutates a Session.
 */
export async function smokeAcpRuntime(
  runtime: LoadedRuntime,
  environment: NodeJS.ProcessEnv,
): Promise<AcpSmokeResult> {
  const secretValues = collectSecretValues(environment);
  let peer: SmokePeer | undefined;
  let result: AcpSmokeResult | undefined;
  let failure: unknown;

  try {
    peer = new SmokePeer(runtime, environment);
    const initialized = asObject(
      await peer.request(
        "initialize",
        {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {},
          clientInfo: {
            name: "ontology-agent-console-profile-smoke",
            version: "0.1.0",
          },
        },
        "initialize",
      ),
      "initialize response",
    );

    const listed = asObject(
      await peer.request(
        "session/list",
        { cwd: runtime.paths.workspace },
        "session-list",
      ),
      "session/list response",
    );
    if (!Array.isArray(listed.sessions)) {
      throw new ProbeFailure(
        "ACP session/list response did not contain a sessions array",
        "protocol",
      );
    }

    const agentInfoRecord = asOptionalObject(initialized.agentInfo);
    const agentInfo = agentInfoRecord
      ? {
          ...(typeof agentInfoRecord.name === "string"
            ? { name: limitText(agentInfoRecord.name) }
            : {}),
          ...(typeof agentInfoRecord.version === "string"
            ? { version: limitText(agentInfoRecord.version) }
            : {}),
        }
      : undefined;
    result = {
      protocolVersion: initialized.protocolVersion ?? null,
      ...(agentInfo && Object.keys(agentInfo).length > 0 ? { agentInfo } : {}),
      agentCapabilities:
        (asOptionalObject(initialized.agentCapabilities) as AgentCapabilities | undefined) ??
        {},
      sessions: {
        count: listed.sessions.length,
        hasMore:
          typeof listed.nextCursor === "string" && listed.nextCursor.length > 0,
      },
    };
  } catch (error) {
    failure = error;
  } finally {
    if (peer) {
      try {
        await peer.shutdown();
      } catch (error) {
        if (failure === undefined) failure = error;
      }
    }
  }

  if (failure !== undefined) {
    const known = failure instanceof ProbeFailure ? failure : undefined;
    const stderr = sanitizeDiagnostic(
      peer?.stderrText() ?? "",
      secretValues,
      MAX_STDERR_CHARS,
    );
    const rawMessage =
      failure instanceof Error ? failure.message : "ACP Profile smoke test failed";
    throw new AcpProbeError(
      sanitizeDiagnostic(rawMessage, secretValues, 1_000) ||
        "ACP Profile smoke test failed",
      {
        phase: known?.phase ?? "protocol",
        rpcCode: known?.rpcCode,
        ...(stderr ? { stderr } : {}),
        cause: failure,
      },
    );
  }

  if (!result) {
    throw new AcpProbeError("ACP Profile smoke test produced no result", {
      phase: "protocol",
    });
  }
  return result;
}

class SmokePeer {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly timeoutMs: number;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly exitPromise: Promise<void>;
  private stdoutBuffer = Buffer.alloc(0);
  private stderrBuffer = Buffer.alloc(0);
  private stderrTruncated = false;
  private nextRequestId = 1;
  private fatalError: ProbeFailure | undefined;
  private shuttingDown = false;

  constructor(runtime: LoadedRuntime, environment: NodeJS.ProcessEnv) {
    this.timeoutMs = runtime.profile.agent.startupTimeoutMs;
    const spawnOptions: SpawnOptionsWithoutStdio = {
      cwd: runtime.paths.workspace,
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    };
    this.child = spawn(
      runtime.profile.agent.command,
      expandRuntimeArguments(
        runtime.profile.agent.args,
        buildRuntimeVariables(runtime),
      ),
      spawnOptions,
    ) as ChildProcessWithoutNullStreams;
    this.exitPromise = new Promise((resolve) => {
      this.child.once("close", () => resolve());
    });

    this.child.once("error", (error) => {
      this.fail(
        new ProbeFailure(
          `Unable to start ACP subprocess: ${safeSystemError(error)}`,
          "spawn",
        ),
      );
    });
    this.child.stdin.on("error", (error) => {
      if (this.shuttingDown) return;
      this.fail(
        new ProbeFailure(
          `ACP subprocess stdin failed: ${safeSystemError(error)}`,
          "protocol",
        ),
      );
    });
    this.child.stdout.on("data", (chunk: Buffer) => {
      this.consumeStdout(chunk);
    });
    this.child.stdout.on("error", (error) => {
      this.fail(
        new ProbeFailure(
          `ACP subprocess stdout failed: ${safeSystemError(error)}`,
          "protocol",
        ),
      );
    });
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.captureStderr(chunk);
    });
    this.child.once("exit", (code, signal) => {
      if (this.shuttingDown || this.pending.size === 0) return;
      this.fail(
        new ProbeFailure(
          `ACP subprocess exited before completing the smoke test (${formatExit(
            code,
            signal,
          )})`,
          "protocol",
        ),
      );
    });
  }

  async request(
    method: "initialize" | "session/list",
    params: JsonObject,
    phase: ProbePhase,
  ): Promise<unknown> {
    if (this.fatalError) throw this.fatalError;
    const id = this.nextRequestId++;
    let resolveRequest!: (value: unknown) => void;
    let rejectRequest!: (error: unknown) => void;
    const response = new Promise<unknown>((resolve, reject) => {
      resolveRequest = resolve;
      rejectRequest = reject;
    });
    const timer = setTimeout(() => {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      pending.reject(
        new ProbeFailure(`ACP ${method} request timed out`, "timeout"),
      );
    }, this.timeoutMs);
    timer.unref();
    this.pending.set(id, {
      phase,
      resolve: resolveRequest,
      reject: rejectRequest,
      timer,
    });

    try {
      await this.writeFrame({
        jsonrpc: "2.0",
        id,
        method,
        params,
      });
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
      }
      throw error;
    }
    return response;
  }

  stderrText(): string {
    const text = this.stderrBuffer.toString("utf8");
    return this.stderrTruncated ? `${text}\n[stderr truncated]` : text;
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.rejectPending(
      new ProbeFailure("ACP subprocess is shutting down", "cleanup"),
    );

    if (!hasExited(this.child)) {
      try {
        this.child.stdin.end();
      } catch {
        // Continue to the process-group cleanup path.
      }
      await this.waitForExit(SHUTDOWN_GRACE_MS);
    }
    try {
      await terminateProcessTree(this.child, {
        terminateGraceMs: Math.max(250, SHUTDOWN_GRACE_MS / 2),
        forceSettleMs: Math.max(250, SHUTDOWN_GRACE_MS / 2),
      });
    } catch (error) {
      throw new ProbeFailure(
        `ACP subprocess did not terminate: ${safeSystemError(error)}`,
        "cleanup",
      );
    }
  }

  private consumeStdout(chunk: Buffer): void {
    if (this.fatalError) return;
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);

    while (true) {
      const newline = this.stdoutBuffer.indexOf(0x0a);
      if (newline < 0) {
        if (this.stdoutBuffer.length > MAX_FRAME_BYTES) {
          this.fail(
            new ProbeFailure(
              "ACP stdout frame exceeded the configured size limit",
              "protocol",
            ),
          );
        }
        return;
      }
      let line = this.stdoutBuffer.subarray(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.subarray(newline + 1);
      if (line.at(-1) === 0x0d) line = line.subarray(0, -1);
      if (line.length === 0) continue;
      if (line.length > MAX_FRAME_BYTES) {
        this.fail(
          new ProbeFailure(
            "ACP stdout frame exceeded the configured size limit",
            "protocol",
          ),
        );
        return;
      }
      this.handleFrame(line);
      if (this.fatalError) return;
    }
  }

  private handleFrame(line: Buffer): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line.toString("utf8"));
    } catch {
      this.fail(
        new ProbeFailure("ACP stdout contained invalid NDJSON", "protocol"),
      );
      return;
    }
    const frame = asOptionalObject(parsed);
    if (!frame) {
      this.fail(
        new ProbeFailure("ACP stdout contained a non-object frame", "protocol"),
      );
      return;
    }

    if (
      typeof frame.id === "number" &&
      typeof frame.method !== "string"
    ) {
      const pending = this.pending.get(frame.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(frame.id);
      const remoteError = asOptionalObject(frame.error);
      if (remoteError) {
        const message =
          typeof remoteError.message === "string"
            ? limitText(remoteError.message, 1_000)
            : "ACP request failed";
        pending.reject(
          new ProbeFailure(
            message,
            pending.phase,
            typeof remoteError.code === "number"
              ? remoteError.code
              : undefined,
          ),
        );
      } else {
        pending.resolve(frame.result);
      }
      return;
    }

    if (
      (typeof frame.id === "number" || typeof frame.id === "string") &&
      typeof frame.method === "string"
    ) {
      // The smoke client never grants permissions or implements tools.
      void this.writeFrame({
        jsonrpc: "2.0",
        id: frame.id,
        error: {
          code: -32601,
          message: "Profile smoke test does not implement client requests",
        },
      }).catch(() => undefined);
    }
  }

  private captureStderr(chunk: Buffer): void {
    if (this.stderrTruncated) return;
    const remaining = MAX_CAPTURED_STDERR_BYTES - this.stderrBuffer.length;
    if (remaining <= 0) {
      this.stderrTruncated = true;
      return;
    }
    this.stderrBuffer = Buffer.concat([
      this.stderrBuffer,
      chunk.subarray(0, remaining),
    ]);
    if (chunk.length > remaining) this.stderrTruncated = true;
  }

  private async writeFrame(frame: JsonObject): Promise<void> {
    if (this.fatalError) throw this.fatalError;
    if (hasExited(this.child) || !this.child.stdin.writable) {
      throw new ProbeFailure("ACP subprocess stdin is not writable", "protocol");
    }
    const encoded = `${JSON.stringify(frame)}\n`;
    await new Promise<void>((resolve, reject) => {
      this.child.stdin.write(encoded, "utf8", (error) => {
        if (error) {
          reject(
            new ProbeFailure(
              `Failed to write ACP request: ${safeSystemError(error)}`,
              "protocol",
            ),
          );
          return;
        }
        resolve();
      });
    });
  }

  private fail(error: ProbeFailure): void {
    if (this.fatalError) return;
    this.fatalError = error;
    this.rejectPending(error);
  }

  private rejectPending(error: ProbeFailure): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  private async waitForExit(timeoutMs: number): Promise<boolean> {
    if (hasExited(this.child)) return true;
    return Promise.race([
      this.exitPromise.then(() => true),
      delay(timeoutMs).then(() => false),
    ]);
  }

}

export function sanitizeDiagnostic(
  text: string,
  secretValues: readonly string[] = [],
  maxChars = MAX_STDERR_CHARS,
): string {
  if (maxChars <= 0) return "";
  let safe = text.replace(
    // ANSI CSI and OSC sequences.
    // eslint-disable-next-line no-control-regex
    /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g,
    "",
  );

  for (const secret of [...secretValues].sort(
    (left, right) => right.length - left.length,
  )) {
    if (secret.length >= 4) safe = safe.split(secret).join("[REDACTED]");
  }

  safe = safe
    .replace(
      /^(\s*(?:authorization|proxy-authorization|cookie|set-cookie)\s*:\s*).*$/gim,
      "$1[REDACTED]",
    )
    .replace(
      /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,
      "$1 [REDACTED]",
    )
    .replace(
      /(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|authorization|cookie|credential)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&]+)/gi,
      "$1[REDACTED]",
    )
    .replace(
      /([?&](?:api[_-]?key|access[_-]?token|token|secret|password)=)[^&\s]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /(https?:\/\/[^:\s/@]+:)[^@\s/]+@/gi,
      "$1[REDACTED]@",
    )
    .trim();

  if (safe.length <= maxChars) return safe;
  return `${safe.slice(0, Math.max(0, maxChars - 22))}\n[diagnostic truncated]`;
}

function collectSecretValues(environment: NodeJS.ProcessEnv): string[] {
  const values = new Set<string>();
  const sensitiveName =
    /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|COOKIE|CREDENTIAL)/i;
  for (const [name, value] of Object.entries(environment)) {
    if (value && value.length >= 4 && sensitiveName.test(name)) {
      values.add(value);
    }
  }
  return [...values];
}

function asObject(value: unknown, label: string): JsonObject {
  const record = asOptionalObject(value);
  if (!record) {
    throw new ProbeFailure(`ACP ${label} was not an object`, "protocol");
  }
  return record;
}

function asOptionalObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function limitText(value: string, maximum = 512): string {
  return value.length <= maximum ? value : value.slice(0, maximum);
}

function safeSystemError(error: unknown): string {
  const record = asOptionalObject(error);
  if (record && typeof record.code === "string") return record.code;
  return error instanceof Error ? error.name : "unknown error";
}

function formatExit(
  code: number | null,
  signal: NodeJS.Signals | null,
): string {
  if (signal) return `signal ${signal}`;
  if (code !== null) return `code ${code}`;
  return "unknown status";
}

function hasExited(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
