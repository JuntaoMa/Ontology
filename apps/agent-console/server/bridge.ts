import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import {
  buildChildEnvironment,
  buildRuntimeVariables,
  prepareRuntimeConfigOverlay,
} from "./opencode-runtime.js";
import {
  expandRuntimeArguments,
  getMissingRequiredEnvironment,
} from "./profile.js";
import { RuntimeCatalog } from "./runtime-catalog.js";
import type { LoadedRuntime } from "./runtime-manifest.js";
import { terminateProcessTree } from "./runtime-supervisor.js";

const MAX_STDOUT_BUFFER_BYTES = 16 * 1024 * 1024;
const MAX_STDERR_BUFFER_BYTES = 64 * 1024;
const MAX_STDERR_LINE_LENGTH = 4_000;
const CLOSE_INTERNAL_ERROR = 1011;
const CLOSE_UNSUPPORTED_DATA = 1003;
const CLOSE_POLICY_VIOLATION = 1008;
const CLOSE_MESSAGE_TOO_BIG = 1009;
const MAX_QUEUED_FRAME_BYTES = 16 * 1024 * 1024;

export interface RuntimeConnectionStatus {
  active: boolean;
  startedAt?: string;
}

interface ActiveConnection {
  child: ChildProcessWithoutNullStreams;
  socket: WebSocket;
  startedAt: string;
  pendingRequests: Map<string, string>;
  close: (reason: "socket" | "child" | "protocol") => Promise<void>;
}

interface PendingAttachment {
  socket: WebSocket;
  completion: Promise<void>;
}

type SpawnChild = typeof spawn;

/**
 * Thin ACP stdio/WebSocket adapter. Runtime discovery, initialization and
 * deletion remain outside the Bridge.
 */
export class AcpBridge {
  readonly webSocketServer: WebSocketServer;
  private readonly active = new Map<string, ActiveConnection>();
  private readonly attaching = new Map<string, PendingAttachment>();
  private readonly reserved = new Set<string>();
  private readonly spawnChild: SpawnChild;

  constructor(
    private readonly catalog: RuntimeCatalog,
    options: { spawnChild?: SpawnChild } = {},
  ) {
    this.spawnChild = options.spawnChild ?? spawn;
    this.webSocketServer = new WebSocketServer({
      noServer: true,
      maxPayload: 16 * 1024 * 1024,
      clientTracking: false,
    });
  }

  runtimeStatus(runtimeId: string): RuntimeConnectionStatus {
    const active = this.active.get(runtimeId);
    return active
      ? { active: true, startedAt: active.startedAt }
      : { active: false };
  }

  isRuntimeBusy(runtimeId: string): boolean {
    const connection = this.active.get(runtimeId);
    return connection !== undefined && connection.pendingRequests.size > 0;
  }

  async closeRuntime(runtimeId: string): Promise<void> {
    const pending = this.attaching.get(runtimeId);
    if (pending) {
      closeSocket(pending.socket, 1000, "Runtime disconnected");
      await pending.completion;
    }
    const connection = this.active.get(runtimeId);
    if (!connection) {
      this.reserved.delete(runtimeId);
      return;
    }
    closeSocket(connection.socket, 1000, "Runtime disconnected");
    await connection.close("socket");
  }

  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    runtimeId: string,
  ): void {
    const runtime = this.catalog.getLoaded(runtimeId);
    const status = runtime?.manifest.status;
    if (
      !runtime ||
      runtime.location !== "projects" ||
      status !== "ready" && status !== "active"
    ) {
      rejectUpgrade(socket, 404, "Runtime is not ready");
      return;
    }
    if (
      this.active.has(runtimeId) ||
      this.reserved.has(runtimeId) ||
      this.catalog.isLocked(runtimeId)
    ) {
      rejectUpgrade(socket, 409, "Runtime already has an active client");
      return;
    }
    const missing = getMissingRequiredEnvironment(runtime.profile);
    if (missing.length > 0) {
      rejectUpgrade(
        socket,
        503,
        `Runtime is missing ${missing.length} environment variable(s)`,
      );
      return;
    }

    this.reserved.add(runtimeId);
    try {
      this.webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        const completion = this.attach(runtime, webSocket)
          .catch((error) => {
            this.reserved.delete(runtimeId);
            console.error(
              `[${runtimeId}] ACP attachment failed`,
              safeError(error),
            );
            closeSocket(
              webSocket,
              CLOSE_INTERNAL_ERROR,
              "Agent Runtime could not start",
            );
          })
          .finally(() => {
            if (
              this.attaching.get(runtimeId)?.completion === completion
            ) {
              this.attaching.delete(runtimeId);
            }
          });
        this.attaching.set(runtimeId, { socket: webSocket, completion });
      });
    } catch (error) {
      this.reserved.delete(runtimeId);
      throw error;
    }
  }

  async close(): Promise<void> {
    const ids = new Set([
      ...this.active.keys(),
      ...this.attaching.keys(),
    ]);
    this.reserved.clear();
    for (const id of ids) await this.closeRuntime(id);
    this.active.clear();
    this.attaching.clear();
    this.webSocketServer.close();
  }

  private async attach(
    candidate: LoadedRuntime,
    socket: WebSocket,
  ): Promise<void> {
    const runtimeId = candidate.manifest.id;
    const queuedFrames: Array<{ data: RawData; isBinary: boolean }> = [];
    let queuedFrameBytes = 0;
    let socketClosed = false;
    const noteEarlyClose = (): void => {
      socketClosed = true;
    };
    const noteEarlyError = (): void => {
      socketClosed = true;
    };
    const queueFrame = (data: RawData, isBinary: boolean): void => {
      if (socketClosed) return;
      queuedFrameBytes += rawDataByteLength(data);
      if (queuedFrameBytes > MAX_QUEUED_FRAME_BYTES) {
        socketClosed = true;
        closeSocket(
          socket,
          CLOSE_MESSAGE_TOO_BIG,
          "Queued ACP input exceeded the startup limit",
        );
        return;
      }
      queuedFrames.push({ data, isBinary });
    };
    socket.on("message", queueFrame);
    socket.once("close", noteEarlyClose);
    socket.on("error", noteEarlyError);

    let runtime: LoadedRuntime;
    try {
      runtime = await this.catalog.revalidateLoaded(runtimeId);
      if (
        runtime.location !== "projects" ||
        runtime.manifest.status !== "ready" &&
          runtime.manifest.status !== "active"
      ) {
        throw new Error("Runtime is not executable");
      }
      if (getMissingRequiredEnvironment(runtime.profile).length > 0) {
        throw new Error("Runtime environment is incomplete");
      }
      prepareRuntimeConfigOverlay(
        runtime.profile,
        runtime.paths.opencodeConfig,
      );
      if (
        this.catalog.isLocked(runtimeId) ||
        socketClosed ||
        socket.readyState !== WebSocket.OPEN
      ) {
        throw new Error("Runtime became unavailable during ACP startup");
      }
    } catch (error) {
      socket.off("message", queueFrame);
      socket.off("close", noteEarlyClose);
      socket.off("error", noteEarlyError);
      this.reserved.delete(runtimeId);
      throw error;
    }

    const environment = buildChildEnvironment(runtime, process.env);
    const agentArgs = expandRuntimeArguments(
      runtime.profile.agent.args,
      buildRuntimeVariables(runtime),
    );
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnChild(runtime.profile.agent.command, agentArgs, {
        cwd: runtime.paths.workspace,
        env: environment,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
      });
    } catch (error) {
      socket.off("message", queueFrame);
      socket.off("close", noteEarlyClose);
      socket.off("error", noteEarlyError);
      this.reserved.delete(runtimeId);
      throw error;
    }

    const startedAt = new Date().toISOString();
    const connection: ActiveConnection = {
      child,
      socket,
      startedAt,
      pendingRequests: new Map(),
      close: async () => undefined,
    };
    this.active.set(runtimeId, connection);
    this.reserved.delete(runtimeId);
    const activeStatusUpdate = this.catalog
      .updateStatus(runtimeId, "active", null, ["ready", "active"])
      .then(
        () => true,
        (error) => {
          console.error(
            `[${runtimeId}] failed to persist active status`,
            safeError(error),
          );
          return false;
        },
      );

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let cleanupPromise: Promise<void> | null = null;
    let startupTimer: NodeJS.Timeout | null = null;

    const cleanup = (reason: "socket" | "child" | "protocol"): Promise<void> => {
      if (cleanupPromise) return cleanupPromise;
      const attempt = (async () => {
        if (startupTimer) clearTimeout(startupTimer);
        if (reason !== "socket") {
          closeSocket(socket, CLOSE_INTERNAL_ERROR, "Agent connection closed");
        }
        await activeStatusUpdate;
        await terminateChild(child);
        if (this.active.get(runtimeId)?.child === child) {
          this.active.delete(runtimeId);
        }
        this.reserved.delete(runtimeId);
        const record = this.catalog.get(runtimeId);
        if (
          record?.manifest.status === "active" &&
          !this.catalog.isLocked(runtimeId)
        ) {
          await this.catalog
            .updateStatus(runtimeId, "ready", null, ["active"])
            .catch(() => undefined);
        }
      })();
      cleanupPromise = attempt;
      void attempt.catch((error) => {
        if (cleanupPromise === attempt) cleanupPromise = null;
        console.error(
          `[${runtimeId}] ACP cleanup could not confirm process exit`,
          safeError(error),
        );
      });
      return attempt;
    };
    connection.close = cleanup;
    void activeStatusUpdate.then((persisted) => {
      if (!persisted) void cleanup("protocol").catch(() => undefined);
    });

    startupTimer = setTimeout(() => {
      console.error(
        `[${runtimeId}] ACP agent did not respond before startup timeout`,
      );
      void cleanup("protocol").catch(() => undefined);
    }, runtime.profile.agent.startupTimeoutMs);
    startupTimer.unref();

    child.on("error", (error) => {
      console.error(`[${runtimeId}] failed to spawn ACP agent`, safeError(error));
      void cleanup("child").catch(() => undefined);
    });
    child.on("exit", (code, signal) => {
      if (!cleanupPromise) {
        console.error(
          `[${runtimeId}] ACP agent exited`,
          JSON.stringify({ code, signal: signal ?? undefined }),
        );
        void cleanup("child").catch(() => undefined);
      }
    });
    child.stdin.on("error", () => {
      void cleanup("child").catch(() => undefined);
    });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      if (Buffer.byteLength(stdoutBuffer, "utf8") > MAX_STDOUT_BUFFER_BYTES) {
        void cleanup("protocol").catch(() => undefined);
        return;
      }
      const split = splitNdjson(stdoutBuffer);
      stdoutBuffer = split.remainder;
      for (const line of split.lines) {
        if (!parseJsonObject(line)) {
          console.error(`[${runtimeId}] ACP stdout contained invalid JSON`);
          void cleanup("protocol").catch(() => undefined);
          return;
        }
        const projected = projectAgentMessage(
          line,
          runtime.paths.workspace,
          connection.pendingRequests,
        );
        if (projected === undefined) continue;
        if (startupTimer) {
          clearTimeout(startupTimer);
          startupTimer = null;
        }
        this.trackAgentResponse(runtimeId, line);
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(projected, (error) => {
            if (error) void cleanup("socket").catch(() => undefined);
          });
        }
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderrBuffer += chunk;
      if (Buffer.byteLength(stderrBuffer, "utf8") > MAX_STDERR_BUFFER_BYTES) {
        const safeLine = redactRuntimeSecrets(
          stderrBuffer,
          environment,
        ).slice(0, MAX_STDERR_LINE_LENGTH);
        if (safeLine) console.error(`[${runtimeId}] ${safeLine}…`);
        stderrBuffer = "";
        return;
      }
      const split = splitNdjson(stderrBuffer);
      stderrBuffer = split.remainder;
      for (const line of split.lines) {
        const safeLine = redactRuntimeSecrets(line, environment).slice(
          0,
          MAX_STDERR_LINE_LENGTH,
        );
        if (safeLine) console.error(`[${runtimeId}] ${safeLine}`);
      }
    });

    const handleFrame = (data: RawData, isBinary: boolean): void => {
      if (this.catalog.isLocked(runtimeId)) {
        closeSocket(socket, CLOSE_POLICY_VIOLATION, "Runtime is under maintenance");
        void cleanup("protocol").catch(() => undefined);
        return;
      }
      if (isBinary) {
        closeSocket(
          socket,
          CLOSE_UNSUPPORTED_DATA,
          "ACP requires text JSON-RPC frames",
        );
        void cleanup("protocol").catch(() => undefined);
        return;
      }
      const lines = data
        .toString()
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const rewritten: string[] = [];
      for (const line of lines) {
        const result = rewriteClientMessage(
          line,
          runtime.paths.workspace,
          !this.catalog.isRuntimeStale(runtimeId),
        );
        if (result === undefined) {
          closeSocket(socket, CLOSE_POLICY_VIOLATION, "Invalid ACP request");
          void cleanup("protocol").catch(() => undefined);
          return;
        }
        rewritten.push(result);
      }
      if (rewritten.length === 0) {
        closeSocket(socket, CLOSE_POLICY_VIOLATION, "Invalid ACP request");
        void cleanup("protocol").catch(() => undefined);
        return;
      }
      for (const line of rewritten) {
        if (child.stdin.destroyed || child.stdin.writableEnded) {
          void cleanup("child").catch(() => undefined);
          return;
        }
        this.trackClientRequest(runtimeId, line);
        child.stdin.write(`${line}\n`);
      }
    };

    socket.off("message", queueFrame);
    socket.off("close", noteEarlyClose);
    socket.off("error", noteEarlyError);
    socket.on("message", handleFrame);
    socket.on("close", () => {
      void cleanup("socket").catch(() => undefined);
    });
    socket.on("error", () => {
      void cleanup("socket").catch(() => undefined);
    });
    for (const frame of queuedFrames) handleFrame(frame.data, frame.isBinary);
  }

  private trackClientRequest(runtimeId: string, line: string): void {
    const connection = this.active.get(runtimeId);
    if (!connection) return;
    const message = JSON.parse(line) as { id?: unknown; method?: unknown };
    if (
      (typeof message.id === "string" || typeof message.id === "number") &&
      typeof message.method === "string"
    ) {
      connection.pendingRequests.set(
        jsonRpcIdKey(message.id),
        message.method,
      );
    }
  }

  private trackAgentResponse(runtimeId: string, line: string): void {
    const connection = this.active.get(runtimeId);
    if (!connection) return;
    const message = JSON.parse(line) as { id?: unknown; method?: unknown };
    if (
      typeof message.method !== "string" &&
      (typeof message.id === "string" || typeof message.id === "number")
    ) {
      connection.pendingRequests.delete(jsonRpcIdKey(message.id));
    }
  }
}

export function rewriteClientMessage(
  line: string,
  workspace: string,
  allowSessionNew = true,
): string | undefined {
  const parsed = parseJsonObject(line);
  if (!parsed) return undefined;
  const method = parsed.method;
  if (
    method === "session/set_model" ||
    method === "session/set_mode" ||
    method === "session/set_config_option"
  ) {
    return undefined;
  }
  if (method === "session/new" && !allowSessionNew) return undefined;
  if (
    method !== "session/new" &&
    method !== "session/load" &&
    method !== "session/list" &&
    method !== "session/resume" &&
    method !== "session/fork"
  ) {
    return containsCwdKey(parsed) ? undefined : JSON.stringify(parsed);
  }
  const params = asObject(parsed.params);
  if (!params || params.cwd !== ".") return undefined;
  if (
    (method === "session/new" || method === "session/load") &&
    (!Array.isArray(params.mcpServers) || params.mcpServers.length !== 0)
  ) {
    return undefined;
  }
  if (
    method !== "session/list" &&
    method !== "session/new" &&
    method !== "session/load" &&
    params.mcpServers !== undefined &&
    (!Array.isArray(params.mcpServers) || params.mcpServers.length !== 0)
  ) {
    return undefined;
  }
  return JSON.stringify({
    ...parsed,
    params: {
      ...params,
      cwd: workspace,
    },
  });
}

export function isAllowedClientMessage(
  line: string,
  logicalCwd = ".",
  allowSessionNew = true,
): boolean {
  if (logicalCwd !== ".") return false;
  return rewriteClientMessage(line, "/managed/runtime/workspace", allowSessionNew)
    !== undefined;
}

/**
 * Project Runtime-local absolute cwd values back to the browser's logical `.`
 * and suppress Sessions belonging to another OpenCode workspace.
 */
export function projectAgentMessage(
  line: string,
  workspace: string,
  pendingRequests: ReadonlyMap<string, string> = new Map(),
): string | undefined {
  const parsed = parseJsonObject(line);
  if (!parsed) return undefined;
  const id = parsed.id;
  const requestMethod =
    typeof id === "string" || typeof id === "number"
      ? pendingRequests.get(jsonRpcIdKey(id))
      : undefined;

  let projected: unknown = parsed;
  if (requestMethod === "session/list") {
    const result = asObject(parsed.result);
    if (result && Array.isArray(result.sessions)) {
      projected = {
        ...parsed,
        result: {
          ...result,
          sessions: result.sessions.filter((session) => {
            const record = asObject(session);
            return record?.cwd === workspace || record?.cwd === ".";
          }),
        },
      };
    }
  }
  const rewrite = rewriteCwdValues(projected, workspace);
  if (!rewrite.valid) {
    if (
      requestMethod &&
      (typeof id === "string" || typeof id === "number")
    ) {
      return JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32603,
          message: "Runtime workspace mismatch",
        },
      });
    }
    return undefined;
  }
  return JSON.stringify(rewrite.value);
}

export function splitNdjson(buffer: string): {
  lines: string[];
  remainder: string;
} {
  const parts = buffer.split(/\r?\n/);
  const remainder = parts.pop() ?? "";
  return {
    lines: parts.map((line) => line.trim()).filter(Boolean),
    remainder,
  };
}

export function redactRuntimeSecrets(
  text: string,
  environment: NodeJS.ProcessEnv,
): string {
  let redacted = text;
  for (const [name, value] of Object.entries(environment)) {
    if (
      !value ||
      value.length < 4 ||
      !/(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|CREDENTIAL)/i.test(name)
    ) {
      continue;
    }
    redacted = redacted.split(value).join("[REDACTED]");
  }
  return redacted;
}

function rewriteCwdValues(
  value: unknown,
  workspace: string,
): { valid: boolean; value: unknown } {
  if (Array.isArray(value)) {
    const values: unknown[] = [];
    for (const item of value) {
      const rewritten = rewriteCwdValues(item, workspace);
      if (!rewritten.valid) return { valid: false, value: null };
      values.push(rewritten.value);
    }
    return { valid: true, value: values };
  }
  const object = asObject(value);
  if (!object) return { valid: true, value };
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(object)) {
    if (key === "cwd") {
      if (child !== workspace && child !== ".") {
        return { valid: false, value: null };
      }
      result[key] = ".";
      continue;
    }
    const rewritten = rewriteCwdValues(child, workspace);
    if (!rewritten.valid) return { valid: false, value: null };
    result[key] = rewritten.value;
  }
  return { valid: true, value: result };
}

function containsCwdKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsCwdKey);
  const object = asObject(value);
  if (!object) return false;
  return Object.entries(object).some(
    ([key, child]) => key === "cwd" || containsCwdKey(child),
  );
}

function parseJsonObject(line: string): Record<string, unknown> | undefined {
  try {
    return asObject(JSON.parse(line));
  } catch {
    return undefined;
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function jsonRpcIdKey(value: string | number): string {
  return `${typeof value}:${String(value)}`;
}

function rawDataByteLength(data: RawData): number {
  if (Array.isArray(data)) {
    return data.reduce((bytes, chunk) => bytes + chunk.byteLength, 0);
  }
  return data.byteLength;
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  const body = `${message}\n`;
  socket.write(
    `HTTP/1.1 ${status} ${message}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      "\r\n" +
      body,
  );
  socket.destroy();
}

function closeSocket(socket: WebSocket, code: number, reason: string): void {
  if (
    socket.readyState === WebSocket.OPEN ||
    socket.readyState === WebSocket.CONNECTING
  ) {
    socket.close(code, reason.slice(0, 123));
  }
}

const childTerminationPromises = new WeakMap<
  ChildProcessWithoutNullStreams,
  Promise<void>
>();

async function terminateChild(
  child: ChildProcessWithoutNullStreams,
): Promise<void> {
  const existing = childTerminationPromises.get(child);
  if (existing) return existing;
  const termination = terminateProcessTree(child).finally(() => {
    childTerminationPromises.delete(child);
  });
  childTerminationPromises.set(child, termination);
  return termination;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
