import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type { LoadedProfile } from "./profile.js";

const MAX_STDOUT_BUFFER_BYTES = 16 * 1024 * 1024;
const MAX_STDERR_BUFFER_BYTES = 64 * 1024;
const MAX_STDERR_LINE_LENGTH = 4_000;
const CLOSE_INTERNAL_ERROR = 1011;
const CLOSE_UNSUPPORTED_DATA = 1003;
const CLOSE_POLICY_VIOLATION = 1008;

export interface BridgeProfile {
  id: string;
  title: string;
  profilePath: string;
  configPath: string;
  runtime: {
    command: string;
    args: string[];
    cwd: string;
    stateDir: string;
    configDir: string;
    startupTimeoutMs: number;
  };
  requiredEnv: string[];
  configAssets: LoadedProfile["configAssets"];
  skillsRoot?: string;
  model: LoadedProfile["model"];
  retrieval?: LoadedProfile["retrieval"];
  ontology: {
    id: string;
    sha256?: string;
  };
}

export interface ProfileConnectionStatus {
  active: boolean;
  startedAt?: string;
}

interface ActiveConnection {
  child: ChildProcessWithoutNullStreams;
  socket: WebSocket;
  startedAt: string;
  pendingRequests: Set<string>;
  pendingSessionRequests: Map<string, string>;
  busySessionCounts: Map<string, number>;
  close: (reason: "socket" | "child" | "protocol") => Promise<void>;
}

type SpawnChild = typeof spawn;

export class AcpBridge {
  readonly webSocketServer: WebSocketServer;
  private readonly profiles: Map<string, BridgeProfile>;
  private readonly active = new Map<string, ActiveConnection>();
  private readonly reserved = new Set<string>();
  private readonly maintenance = new Set<string>();
  private readonly spawnChild: SpawnChild;

  constructor(profiles: BridgeProfile[], options?: { spawnChild?: SpawnChild }) {
    this.profiles = new Map(profiles.map((profile) => [profile.id, profile]));
    this.spawnChild = options?.spawnChild ?? spawn;
    this.webSocketServer = new WebSocketServer({
      noServer: true,
      maxPayload: 16 * 1024 * 1024,
      clientTracking: false,
    });
  }

  profileStatus(profileId: string): ProfileConnectionStatus {
    const active = this.active.get(profileId);
    return active
      ? { active: true, startedAt: active.startedAt }
      : { active: false };
  }

  isSessionBusy(profileId: string, sessionId: string): boolean {
    return (this.active.get(profileId)?.busySessionCounts.get(sessionId) ?? 0) > 0;
  }

  isProfileBusy(profileId: string): boolean {
    const connection = this.active.get(profileId);
    if (!connection) return false;
    return (
      connection.pendingRequests.size > 0 ||
      Array.from(connection.busySessionCounts.values()).some(
        (count) => count > 0,
      )
    );
  }

  /**
   * Reserve a Profile for an operation that needs exclusive access to its
   * durable state. The check and reservation are synchronous so an Upgrade or
   * second maintenance request cannot slip between them.
   */
  beginProfileMaintenance(profileId: string): boolean {
    if (
      !this.profiles.has(profileId) ||
      this.maintenance.has(profileId) ||
      this.reserved.has(profileId) ||
      this.isProfileBusy(profileId)
    ) {
      return false;
    }
    this.maintenance.add(profileId);
    return true;
  }

  endProfileMaintenance(profileId: string): void {
    this.maintenance.delete(profileId);
  }

  async closeProfile(profileId: string): Promise<void> {
    const connection = this.active.get(profileId);
    if (!connection) {
      this.reserved.delete(profileId);
      return;
    }
    closeSocket(connection.socket, 1000, "Agent Profile disconnected");
    await connection.close("socket");
  }

  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    profileId: string,
  ): void {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      rejectUpgrade(socket, 404, "Unknown Agent Profile");
      return;
    }
    if (
      this.active.has(profileId) ||
      this.reserved.has(profileId) ||
      this.maintenance.has(profileId)
    ) {
      rejectUpgrade(socket, 409, "Agent Profile already has an active client");
      return;
    }

    const missing = profile.requiredEnv.filter((name) => !process.env[name]);
    if (missing.length > 0) {
      rejectUpgrade(socket, 503, `Agent Profile is missing ${missing.length} environment variable(s)`);
      return;
    }

    this.reserved.add(profileId);
    try {
      this.webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        void this.attach(profile, webSocket).catch((error) => {
          this.reserved.delete(profile.id);
          console.error(`[${profile.id}] ACP attachment failed`, safeError(error));
          closeSocket(webSocket, CLOSE_INTERNAL_ERROR, "Agent runtime could not start");
        });
      });
    } catch (error) {
      this.reserved.delete(profileId);
      throw error;
    }
  }

  async close(): Promise<void> {
    const profileIds = [...this.active.keys()];
    this.reserved.clear();
    for (const profileId of profileIds) {
      await this.closeProfile(profileId);
    }
    this.active.clear();
    this.maintenance.clear();
    this.webSocketServer.close();
  }

  private async attach(profile: BridgeProfile, socket: WebSocket): Promise<void> {
    let runtimeConfigDir: string;
    try {
      // WebSocket clients commonly send `initialize` immediately after open.
      // Keep startup synchronous until listeners are installed so that no
      // frame or close event can arrive during an awaited filesystem call.
      mkdirSync(profile.runtime.stateDir, { recursive: true, mode: 0o700 });
      runtimeConfigDir = path.join(profile.runtime.stateDir, "config");
      prepareRuntimeConfigOverlay(profile, runtimeConfigDir);
    } catch (error) {
      this.reserved.delete(profile.id);
      console.error(`[${profile.id}] failed to prepare runtime state directory`, safeError(error));
      closeSocket(socket, CLOSE_INTERNAL_ERROR, "Agent runtime could not start");
      return;
    }

    const childEnvironment = buildChildEnvironment(
      profile,
      runtimeConfigDir,
      process.env,
    );

    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnChild(profile.runtime.command, profile.runtime.args, {
        cwd: profile.runtime.cwd,
        env: childEnvironment,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
    } catch (error) {
      this.reserved.delete(profile.id);
      console.error(`[${profile.id}] failed to spawn ACP agent`, safeError(error));
      closeSocket(socket, CLOSE_INTERNAL_ERROR, "Agent runtime could not start");
      return;
    }
    const startedAt = new Date().toISOString();
    const connection: ActiveConnection = {
      child,
      socket,
      startedAt,
      pendingRequests: new Set(),
      pendingSessionRequests: new Map(),
      busySessionCounts: new Map(),
      close: async () => undefined,
    };
    this.active.set(profile.id, connection);
    this.reserved.delete(profile.id);

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let cleanupPromise: Promise<void> | null = null;
    let startupTimer: NodeJS.Timeout | null = null;

    const cleanup = (reason: "socket" | "child" | "protocol"): Promise<void> => {
      if (cleanupPromise) return cleanupPromise;
      cleanupPromise = (async () => {
        if (startupTimer) {
          clearTimeout(startupTimer);
          startupTimer = null;
        }
        if (reason !== "socket") {
          closeSocket(socket, CLOSE_INTERNAL_ERROR, "Agent connection closed");
        }
        await terminateChild(child);
        const current = this.active.get(profile.id);
        if (current?.child === child) {
          this.active.delete(profile.id);
        }
        this.reserved.delete(profile.id);
      })();
      return cleanupPromise;
    };
    connection.close = cleanup;

    startupTimer = setTimeout(() => {
      console.error(`[${profile.id}] ACP agent did not produce a response before startup timeout`);
      void cleanup("protocol");
    }, profile.runtime.startupTimeoutMs);
    startupTimer.unref();

    child.on("error", (error) => {
      console.error(`[${profile.id}] failed to spawn ACP agent`, safeError(error));
      void cleanup("child");
    });

    child.on("exit", (code, signal) => {
      if (!cleanupPromise) {
        console.error(
          `[${profile.id}] ACP agent exited`,
          JSON.stringify({ code, signal: signal ?? undefined }),
        );
        void cleanup("child");
      }
    });
    child.stdin.on("error", () => {
      void cleanup("child");
    });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      if (Buffer.byteLength(stdoutBuffer, "utf8") > MAX_STDOUT_BUFFER_BYTES) {
        console.error(`[${profile.id}] ACP stdout exceeded framing limit`);
        void cleanup("protocol");
        return;
      }

      const split = splitNdjson(stdoutBuffer);
      stdoutBuffer = split.remainder;
      for (const line of split.lines) {
        if (!isJsonObject(line)) {
          console.error(`[${profile.id}] ACP stdout contained a non-JSON line`);
          void cleanup("protocol");
          return;
        }
        if (startupTimer) {
          clearTimeout(startupTimer);
          startupTimer = null;
        }
        this.trackAgentResponse(profile.id, line);
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(line, (error) => {
            if (error) void cleanup("socket");
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
          childEnvironment,
        ).slice(0, MAX_STDERR_LINE_LENGTH);
        console.error(
          `[${profile.id}] ${safeLine}${safeLine ? "… [stderr line truncated]" : ""}`,
        );
        stderrBuffer = "";
        return;
      }
      const split = splitNdjson(stderrBuffer);
      stderrBuffer = split.remainder;
      for (const line of split.lines) {
        const safeLine = redactRuntimeSecrets(line, childEnvironment).slice(
          0,
          MAX_STDERR_LINE_LENGTH,
        );
        if (safeLine) console.error(`[${profile.id}] ${safeLine}`);
      }
    });

    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        closeSocket(socket, CLOSE_UNSUPPORTED_DATA, "ACP requires text JSON-RPC frames");
        void cleanup("protocol");
        return;
      }

      const payload = data.toString("utf8");
      const lines = payload
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (
        lines.length === 0 ||
        lines.some(
          (line) =>
            !isJsonObject(line) ||
            !isAllowedClientMessage(line, profile.runtime.cwd),
        )
      ) {
        closeSocket(socket, CLOSE_POLICY_VIOLATION, "Invalid ACP request for Agent Profile");
        void cleanup("protocol");
        return;
      }

      for (const line of lines) {
        if (child.stdin.destroyed || child.stdin.writableEnded) {
          void cleanup("child");
          return;
        }
        this.trackClientRequest(profile.id, line);
        child.stdin.write(`${line}\n`);
      }
    });

    socket.on("close", () => {
      void cleanup("socket");
    });
    socket.on("error", () => {
      void cleanup("socket");
    });
  }

  private trackClientRequest(profileId: string, line: string): void {
    const connection = this.active.get(profileId);
    if (!connection) return;
    const message = JSON.parse(line) as {
      id?: unknown;
      method?: unknown;
      params?: { sessionId?: unknown };
    };
    if (
      (typeof message.id === "string" || typeof message.id === "number") &&
      typeof message.method === "string"
    ) {
      connection.pendingRequests.add(jsonRpcIdKey(message.id));
    }
    if (
      !(
        message.method === "session/prompt" ||
        message.method === "session/load" ||
        message.method === "session/resume" ||
        message.method === "session/fork"
      ) ||
      (typeof message.id !== "string" && typeof message.id !== "number") ||
      typeof message.params?.sessionId !== "string"
    ) {
      return;
    }
    const requestKey = jsonRpcIdKey(message.id);
    const sessionId = message.params.sessionId;
    connection.pendingSessionRequests.set(requestKey, sessionId);
    connection.busySessionCounts.set(
      sessionId,
      (connection.busySessionCounts.get(sessionId) ?? 0) + 1,
    );
  }

  private trackAgentResponse(profileId: string, line: string): void {
    const connection = this.active.get(profileId);
    if (!connection) return;
    const message = JSON.parse(line) as { id?: unknown; method?: unknown };
    if (
      typeof message.method === "string" ||
      (typeof message.id !== "string" && typeof message.id !== "number")
    ) {
      return;
    }
    const requestKey = jsonRpcIdKey(message.id);
    connection.pendingRequests.delete(requestKey);
    const sessionId = connection.pendingSessionRequests.get(requestKey);
    if (!sessionId) return;
    connection.pendingSessionRequests.delete(requestKey);
    const remaining = (connection.busySessionCounts.get(sessionId) ?? 1) - 1;
    if (remaining > 0) {
      connection.busySessionCounts.set(sessionId, remaining);
    } else {
      connection.busySessionCounts.delete(sessionId);
    }
  }
}

function jsonRpcIdKey(value: string | number): string {
  return `${typeof value}:${String(value)}`;
}

const SAFE_INHERITED_ENVIRONMENT = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
] as const;

export function buildChildEnvironment(
  profile: BridgeProfile,
  runtimeConfigDir: string,
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of SAFE_INHERITED_ENVIRONMENT) {
    const value = source[name];
    if (value !== undefined) environment[name] = value;
  }
  for (const name of profile.requiredEnv) {
    const value = source[name];
    if (value !== undefined) environment[name] = value;
  }

  environment.OPENCODE_DB = path.join(
    profile.runtime.stateDir,
    "opencode.db",
  );
  environment.OPENCODE_CONFIG_DIR = runtimeConfigDir;
  environment.ONTOLOGY_PROFILE_DIR = path.dirname(profile.profilePath);
  if (profile.skillsRoot) {
    environment.ONTOLOGY_SKILLS_ROOT = profile.skillsRoot;
  }
  environment.ONTOLOGY_MODEL_ID = profile.model.id;
  if (profile.model.source === "profile") {
    environment.ONTOLOGY_MODEL_BASE_URL =
      source[profile.model.apiBaseEnv] ?? "";
  }
  if (profile.model.auth.source === "environment") {
    environment.ONTOLOGY_MODEL_API_KEY =
      source[profile.model.auth.apiKeyEnv] ?? "";
  }
  if (profile.retrieval) {
    const retrievalEndpoint =
      source[profile.retrieval.endpointEnv] ?? "";
    environment.ONTOLOGY_RETRIEVAL_ENDPOINT = retrievalEndpoint;
    environment.ONTOLOGY_VECTOR_TOP_K = String(
      profile.retrieval.vectorTopK,
    );
    environment.ONTOLOGY_GRAPH_ALGORITHM =
      profile.retrieval.graphAlgorithm;
    if (isLoopbackHttpUrl(retrievalEndpoint)) {
      // urllib on macOS can consult system proxy settings even when proxy
      // variables are absent. Keep the fixed local OAG path off that proxy
      // without exposing the host's broader NO_PROXY configuration.
      environment.NO_PROXY = "localhost,127.0.0.1,::1";
      environment.no_proxy = "localhost,127.0.0.1,::1";
    }
  }
  environment.ONTOLOGY_ID = profile.ontology.id;
  if (profile.ontology.sha256) {
    environment.ONTOLOGY_EXPECTED_SHA256 = profile.ontology.sha256;
  }
  return environment;
}

function isLoopbackHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1")
    );
  } catch {
    return false;
  }
}

export function prepareRuntimeConfigOverlay(
  profile: Pick<BridgeProfile, "configPath" | "configAssets">,
  runtimeConfigDir: string,
): void {
  mkdirSync(runtimeConfigDir, { recursive: true, mode: 0o700 });
  copyFileSync(
    profile.configPath,
    path.join(runtimeConfigDir, "opencode.jsonc"),
  );
  for (const asset of profile.configAssets) {
    const destination = resolveRuntimeAssetDestination(
      runtimeConfigDir,
      asset.relativePath,
    );
    mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    copyFileSync(asset.path, destination);
  }
}

function resolveRuntimeAssetDestination(
  runtimeConfigDir: string,
  relativePath: string,
): string {
  const root = path.resolve(runtimeConfigDir);
  const destination = path.resolve(root, relativePath);
  const relative = path.relative(root, destination);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    normalizedPathKey(relative) === normalizedPathKey("opencode.jsonc")
  ) {
    throw new Error("Invalid OpenCode runtime asset destination");
  }
  return destination;
}

function normalizedPathKey(value: string): string {
  return process.platform === "win32" ? value.toLocaleLowerCase() : value;
}

export function splitNdjson(buffer: string): { lines: string[]; remainder: string } {
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

function isJsonObject(line: string): boolean {
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

export function isAllowedClientMessage(
  line: string,
  profileCwd: string,
): boolean {
  let parsed: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }
    parsed = value as Record<string, unknown>;
  } catch {
    return false;
  }

  const method = parsed.method;
  if (
    method === "session/set_model" ||
    method === "session/set_mode" ||
    method === "session/set_config_option"
  ) {
    return false;
  }
  if (
    method !== "session/new" &&
    method !== "session/load" &&
    method !== "session/list" &&
    method !== "session/resume" &&
    method !== "session/fork"
  ) {
    return true;
  }
  const params = parsed.params;
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    return false;
  }
  const request = params as Record<string, unknown>;
  if (request.cwd !== profileCwd) return false;
  if (method === "session/list") return true;

  const mcpServers = request.mcpServers;
  if (method === "session/new" || method === "session/load") {
    return Array.isArray(mcpServers) && mcpServers.length === 0;
  }
  return (
    mcpServers === undefined ||
    (Array.isArray(mcpServers) && mcpServers.length === 0)
  );
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
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
    socket.close(code, reason.slice(0, 123));
  }
}

async function terminateChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  const existing = childTerminationPromises.get(child);
  if (existing) return existing;

  const termination = terminateChildOnce(child).finally(() => {
    childTerminationPromises.delete(child);
  });
  childTerminationPromises.set(child, termination);
  return termination;
}

const childTerminationPromises = new WeakMap<
  ChildProcessWithoutNullStreams,
  Promise<void>
>();

async function terminateChildOnce(
  child: ChildProcessWithoutNullStreams,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      clearTimeout(settleTimer);
      child.off("exit", finish);
      resolve();
    };
    const settleTimer = setTimeout(finish, 2_500);
    settleTimer.unref();
    const forceTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        signalChildTree(child, "SIGKILL");
      }
    }, 2_000);
    forceTimer.unref();
    child.once("exit", finish);

    if (!child.stdin.writableEnded) child.stdin.end();
    signalChildTree(child, "SIGTERM");
  });
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
      // The process may have exited between the status check and the signal.
      // Fall through to ChildProcess.kill for non-group-aware test doubles and
      // platforms that rejected process-group signaling.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // Termination is best-effort; the bounded settle timer still releases the
    // Bridge lifecycle if the process has already disappeared.
  }
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
