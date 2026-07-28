import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_FRAME_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_STDERR_CHARS = 8_000;
const DEFAULT_SHUTDOWN_GRACE_MS = 750;
const MAX_CAPTURED_STDERR_BYTES = 256 * 1024;
const MAX_UPDATE_TYPES = 256;

type JsonObject = Record<string, unknown>;
type ProbePhase =
  | "spawn"
  | "initialize"
  | "session-list"
  | "session-load"
  | "protocol"
  | "timeout"
  | "cleanup";

export interface AcpProbeOptions {
  /** Executable to launch. Defaults to `opencode`. */
  command?: string;
  /** Executable arguments. Defaults to `["acp"]`. */
  args?: readonly string[];
  /** Child working directory and ACP session-list/load cwd. */
  cwd?: string;
  /** Environment overrides. `undefined` removes an inherited variable. */
  env?: Readonly<Record<string, string | undefined>>;
  /**
   * Whether to inherit the probe host environment before applying `env`.
   * Defaults to true for compatibility with the explicit command mode.
   * Profile mode disables inheritance and supplies its validated runtime
   * environment explicitly.
   */
  inheritEnvironment?: boolean;
  /** Optional existing session to load read-only and inspect by event type. */
  loadSessionId?: string;
  /** Total request timeout for each ACP operation. */
  timeoutMs?: number;
  /** Maximum accepted NDJSON frame size. */
  maxFrameBytes?: number;
  /** Maximum sanitized stderr characters attached to an error. */
  maxStderrChars?: number;
  /** Time allowed for a clean stdin-EOF shutdown before signals are sent. */
  shutdownGraceMs?: number;
}

export interface AcpProbeResult {
  protocolVersion: unknown;
  agentInfo?: {
    name?: string;
    version?: string;
  };
  agentCapabilities: JsonObject;
  sessions: {
    count: number;
    hasMore: boolean;
  };
  replay?: {
    sessionId: string;
    totalUpdates: number;
    updateCounts: Record<string, number>;
    configOptionIds: string[];
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
 * Probe an ACP subprocess without creating sessions or prompting the agent.
 *
 * The only agent methods emitted are `initialize`, `session/list`, and, when
 * explicitly requested, `session/load` for an existing session. Loaded message
 * and tool bodies are discarded immediately; only `session/update` type counts
 * are retained.
 */
export async function probeAcpCapabilities(
  options: AcpProbeOptions = {},
): Promise<AcpProbeResult> {
  const command = requireNonEmpty(options.command ?? "opencode", "command");
  const args = [...(options.args ?? ["acp"])];
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const timeoutMs = boundedInteger(
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    "timeoutMs",
    10,
    300_000,
  );
  const maxFrameBytes = boundedInteger(
    options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES,
    "maxFrameBytes",
    1_024,
    64 * 1024 * 1024,
  );
  const maxStderrChars = boundedInteger(
    options.maxStderrChars ?? DEFAULT_MAX_STDERR_CHARS,
    "maxStderrChars",
    0,
    64_000,
  );
  const shutdownGraceMs = boundedInteger(
    options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS,
    "shutdownGraceMs",
    10,
    10_000,
  );
  const environment = mergeEnvironment(
    options.inheritEnvironment === false ? {} : process.env,
    options.env,
  );
  const secretValues = collectSecretValues(environment, args);

  let peer: AcpPeer | undefined;
  let result: AcpProbeResult | undefined;
  let failure: unknown;

  try {
    peer = new AcpPeer({
      command,
      args,
      cwd,
      environment,
      timeoutMs,
      maxFrameBytes,
    });

    const initialized = asObject(
      await peer.request(
        "initialize",
        {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: {
            name: "ontology-agent-console-acp-probe",
            version: "0.1.0",
          },
        },
        "initialize",
      ),
      "initialize response",
    );

    const agentCapabilities =
      asOptionalObject(initialized.agentCapabilities) ?? {};
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

    const listed = asObject(
      await peer.request("session/list", { cwd }, "session-list"),
      "session/list response",
    );
    if (!Array.isArray(listed.sessions)) {
      throw new ProbeFailure(
        "ACP session/list response did not contain a sessions array",
        "protocol",
      );
    }

    result = {
      protocolVersion: initialized.protocolVersion ?? null,
      ...(agentInfo && Object.keys(agentInfo).length > 0 ? { agentInfo } : {}),
      agentCapabilities,
      sessions: {
        count: listed.sessions.length,
        hasMore:
          typeof listed.nextCursor === "string" && listed.nextCursor.length > 0,
      },
    };

    if (options.loadSessionId !== undefined) {
      const sessionId = requireNonEmpty(
        options.loadSessionId,
        "loadSessionId",
      );
      peer.startReplayCount(sessionId);
      let loaded: JsonObject;
      try {
        loaded = asObject(
          await peer.request(
            "session/load",
            {
              cwd,
              sessionId,
              mcpServers: [],
            },
            "session-load",
          ),
          "session/load response",
        );
        // OpenCode currently emits replay updates before the response. A short
        // drain accommodates agents that flush already-enqueued notifications
        // immediately after resolving session/load.
        await delay(Math.min(50, timeoutMs));
      } finally {
        peer.stopReplayCount();
      }

      const configOptionIds = Array.isArray(loaded.configOptions)
        ? loaded.configOptions.flatMap((entry): string[] => {
            const record = asOptionalObject(entry);
            return record && typeof record.id === "string"
              ? [limitText(record.id)]
              : [];
          })
        : [];
      const replay = peer.replaySummary(sessionId);
      result.replay = {
        ...replay,
        configOptionIds,
      };
    }
  } catch (error) {
    failure = error;
  } finally {
    if (peer) {
      try {
        await peer.shutdown(shutdownGraceMs);
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
      maxStderrChars,
    );
    const rawMessage =
      failure instanceof Error ? failure.message : "ACP capability probe failed";
    throw new AcpProbeError(
      sanitizeDiagnostic(rawMessage, secretValues, 1_000) ||
        "ACP capability probe failed",
      {
        phase: known?.phase ?? "protocol",
        rpcCode: known?.rpcCode,
        ...(stderr ? { stderr } : {}),
        cause: failure,
      },
    );
  }

  if (!result) {
    throw new AcpProbeError("ACP capability probe produced no result", {
      phase: "protocol",
    });
  }
  return result;
}

class AcpPeer {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly timeoutMs: number;
  private readonly maxFrameBytes: number;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly exitPromise: Promise<void>;
  private stdoutBuffer = Buffer.alloc(0);
  private stderrBuffer = Buffer.alloc(0);
  private stderrTruncated = false;
  private nextRequestId = 1;
  private replaySessionId: string | undefined;
  private replayCounts = new Map<string, number>();
  private replayTotal = 0;
  private fatalError: ProbeFailure | undefined;
  private shuttingDown = false;

  constructor(input: {
    command: string;
    args: string[];
    cwd: string;
    environment: NodeJS.ProcessEnv;
    timeoutMs: number;
    maxFrameBytes: number;
  }) {
    this.timeoutMs = input.timeoutMs;
    this.maxFrameBytes = input.maxFrameBytes;
    const spawnOptions: SpawnOptionsWithoutStdio = {
      cwd: input.cwd,
      env: input.environment,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    };
    this.child = spawn(
      input.command,
      input.args,
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
          `ACP subprocess exited before completing the probe (${formatExit(
            code,
            signal,
          )})`,
          "protocol",
        ),
      );
    });
  }

  async request(
    method: string,
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

  startReplayCount(sessionId: string): void {
    this.replaySessionId = sessionId;
    this.replayCounts.clear();
    this.replayTotal = 0;
  }

  stopReplayCount(): void {
    this.replaySessionId = undefined;
  }

  replaySummary(sessionId: string): {
    sessionId: string;
    totalUpdates: number;
    updateCounts: Record<string, number>;
  } {
    return {
      sessionId,
      totalUpdates: this.replayTotal,
      updateCounts: Object.fromEntries(
        [...this.replayCounts.entries()].sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
    };
  }

  stderrText(): string {
    const text = this.stderrBuffer.toString("utf8");
    return this.stderrTruncated ? `${text}\n[stderr truncated]` : text;
  }

  async shutdown(graceMs: number): Promise<void> {
    this.shuttingDown = true;
    this.rejectPending(
      new ProbeFailure("ACP subprocess is shutting down", "cleanup"),
    );

    if (hasExited(this.child)) return;
    try {
      this.child.stdin.end();
    } catch {
      // Continue to the signal-based cleanup path.
    }
    if (await this.waitForExit(graceMs)) return;

    this.signal("SIGTERM");
    if (await this.waitForExit(Math.max(250, Math.floor(graceMs / 2)))) return;

    this.signal("SIGKILL");
    if (await this.waitForExit(Math.max(250, Math.floor(graceMs / 2)))) return;

    throw new ProbeFailure("ACP subprocess did not terminate", "cleanup");
  }

  private consumeStdout(chunk: Buffer): void {
    if (this.fatalError) return;
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);

    while (true) {
      const newline = this.stdoutBuffer.indexOf(0x0a);
      if (newline < 0) {
        if (this.stdoutBuffer.length > this.maxFrameBytes) {
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
      if (line.length > this.maxFrameBytes) {
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
      (typeof frame.id === "number" || typeof frame.id === "string") &&
      typeof frame.method !== "string"
    ) {
      if (typeof frame.id !== "number") return;
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
      // The probe never grants permissions or implements client-side tools.
      // Explicitly reject unexpected server requests so the agent cannot hang.
      void this.writeFrame({
        jsonrpc: "2.0",
        id: frame.id,
        error: {
          code: -32601,
          message: "Capability probe does not implement client requests",
        },
      }).catch(() => undefined);
      return;
    }

    if (typeof frame.method === "string") {
      this.handleNotification(frame.method, frame.params);
    }
  }

  private handleNotification(method: string, params: unknown): void {
    if (method !== "session/update" || !this.replaySessionId) return;
    const payload = asOptionalObject(params);
    if (!payload || payload.sessionId !== this.replaySessionId) return;
    const update = asOptionalObject(payload.update);
    if (!update || typeof update.sessionUpdate !== "string") return;
    const type = limitText(update.sessionUpdate, 128);
    this.replayTotal += 1;
    if (
      this.replayCounts.has(type) ||
      this.replayCounts.size < MAX_UPDATE_TYPES
    ) {
      this.replayCounts.set(type, (this.replayCounts.get(type) ?? 0) + 1);
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

  private signal(signal: NodeJS.Signals): void {
    if (hasExited(this.child)) return;
    try {
      if (process.platform !== "win32" && this.child.pid) {
        process.kill(-this.child.pid, signal);
      } else {
        this.child.kill(signal);
      }
    } catch (error) {
      const code = asOptionalObject(error)?.code;
      if (code !== "ESRCH") throw error;
    }
  }
}

export function sanitizeDiagnostic(
  text: string,
  secretValues: readonly string[] = [],
  maxChars = DEFAULT_MAX_STDERR_CHARS,
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

function mergeEnvironment(
  inherited: NodeJS.ProcessEnv,
  overrides: AcpProbeOptions["env"],
): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...inherited };
  for (const [name, value] of Object.entries(overrides ?? {})) {
    if (value === undefined) delete merged[name];
    else merged[name] = value;
  }
  return merged;
}

function collectSecretValues(
  environment: NodeJS.ProcessEnv,
  args: readonly string[],
): string[] {
  const values = new Set<string>();
  const sensitiveName =
    /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|COOKIE|CREDENTIAL)/i;
  for (const [name, value] of Object.entries(environment)) {
    if (value && value.length >= 4 && sensitiveName.test(name)) {
      values.add(value);
    }
  }

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? "";
    const assignment = /^--?([^=]+)=(.*)$/.exec(argument);
    if (assignment && sensitiveName.test(assignment[1] ?? "")) {
      if ((assignment[2] ?? "").length >= 4) values.add(assignment[2] ?? "");
      continue;
    }
    if (sensitiveName.test(argument)) {
      const next = args[index + 1];
      if (next && next.length >= 4) values.add(next);
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

function boundedInteger(
  value: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new AcpProbeError(
      `${name} must be an integer between ${minimum} and ${maximum}`,
      { phase: "protocol" },
    );
  }
  return value;
}

function requireNonEmpty(value: string, name: string): string {
  if (value.trim().length === 0) {
    throw new AcpProbeError(`${name} must not be empty`, {
      phase: "protocol",
    });
  }
  return value;
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
