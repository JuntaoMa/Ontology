import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AcpBridge } from "./bridge.js";
import {
  loadDatasetCatalog,
  toPublicDataset,
  type LoadedDataset,
} from "./dataset.js";
import {
  loadProfileCatalog,
  toPublicProfile,
  type LoadedProfile,
} from "./profile.js";
import {
  MutationDrain,
  MutationRejectedError,
} from "./mutation-drain.js";
import { RuntimeCatalog } from "./runtime-catalog.js";
import {
  RuntimeCreateError,
  RuntimeInitializer,
} from "./runtime-initializer.js";
import {
  RuntimeDeleteError,
  RuntimeDeleteService,
} from "./runtime-delete.js";
import { RuntimeSupervisor } from "./runtime-supervisor.js";
import {
  isOpenCodeSessionId,
  SessionDeleteError,
  SessionDeleteManager,
} from "./session-delete.js";
import { serveStaticFile } from "./static-files.js";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demoRoot = path.resolve(
  process.env.ONTOLOGY_DEMO_ROOT ??
    path.resolve(appRoot, "../../ontology-rag-demo"),
);
const profilesRoot = path.join(demoRoot, "profiles");
const datasetsRoot = path.join(demoRoot, "datasets");
const staticRoot = path.resolve(
  process.env.AGENT_CONSOLE_STATIC_DIR ?? path.join(appRoot, "dist-web"),
);
const host = process.env.AGENT_CONSOLE_HOST ?? "127.0.0.1";
if (!isLoopbackHost(host)) {
  throw new Error("Agent Console only permits a loopback listen address");
}
const port = parsePort(process.env.AGENT_CONSOLE_PORT ?? "4310");
const allowedOrigins = parseAllowedOrigins(
  process.env.AGENT_CONSOLE_ALLOWED_ORIGINS,
  port,
);
if (process.platform === "win32") {
  throw new Error(
    "Native Windows is not supported; run Agent Console in WSL so POSIX " +
      "process-group cleanup can be enforced",
  );
}

const [profiles, datasets] = await Promise.all([
  loadProfileCatalog(profilesRoot),
  loadDatasetCatalog(datasetsRoot),
]);
const catalog = new RuntimeCatalog({ demoRoot, profiles, datasets });
await catalog.initialize();
const supervisor = new RuntimeSupervisor();
const bridge = new AcpBridge(catalog);
const initializer = new RuntimeInitializer(catalog, supervisor);
const sessionDeletes = new SessionDeleteManager();
const deletion = new RuntimeDeleteService(
  catalog,
  initializer,
  bridge,
  sessionDeletes,
);
await deletion.recoverTrash();

let shuttingDown = false;
let shutdownTask: Promise<void> | undefined;
let profileReload: Promise<LoadedProfile[]> | undefined;
let datasetReload: Promise<LoadedDataset[]> | undefined;
const mutationDrain = new MutationDrain();
const server = createServer(async (request, response) => {
  try {
    if (isHttpMutation(request)) {
      await mutationDrain.run(() => handleHttpRequest(request, response));
    } else {
      await handleHttpRequest(request, response);
    }
  } catch (error) {
    if (error instanceof MutationRejectedError) {
      applySecurityHeaders(response);
      sendJson(response, 503, { error: "server_shutting_down" });
      return;
    }
    console.error(
      "Agent Console request failed",
      error instanceof Error ? error.message : String(error),
    );
    if (!response.headersSent) sendJson(response, 500, { error: "internal_error" });
    else response.end();
  }
});

server.on("upgrade", (request, socket, head) => {
  if (shuttingDown) {
    socket.write(
      "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n",
    );
    socket.destroy();
    return;
  }
  const origin = request.headers.origin;
  if (!origin || !allowedOrigins.has(origin)) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const url = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`,
  );
  const match =
    /^\/runtimes\/([a-z0-9-]+--[a-z0-9-]+)\/acp$/.exec(url.pathname);
  if (!match) {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  bridge.handleUpgrade(request, socket, head, match[1]);
});

server.listen(port, host, () => {
  const displayHost = host === "::1" ? `[${host}]` : host;
  console.log(`Ontology Agent Console listening on http://${displayHost}:${port}`);
  console.log(
    `Loaded ${profiles.length} Profile(s), ${datasets.length} Dataset(s), ` +
      `${catalog.list().length} Runtime(s) from ${demoRoot}`,
  );
});

function shutdown(): Promise<void> {
  if (shutdownTask) return shutdownTask;
  shuttingDown = true;
  shutdownTask = (async () => {
    const serverClosed = new Promise<void>((resolve) =>
      server.close(() => resolve()),
    );
    await mutationDrain.stopAcceptingAndDrain();
    await initializer.close();
    await bridge.close();
    await sessionDeletes.close();
    await supervisor.close();
    await deletion.close();
    await serverClosed;
  })();
  return shutdownTask;
}

process.once("SIGINT", () => {
  void finishShutdown();
});
process.once("SIGTERM", () => {
  void finishShutdown();
});

async function finishShutdown(): Promise<void> {
  try {
    await shutdown();
    process.exit(0);
  } catch (error) {
    console.error(
      "Agent Console could not safely stop all subprocesses",
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  }
}

async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  applySecurityHeaders(response);
  const url = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`,
  );

  if (request.method === "POST" && url.pathname === "/runtimes") {
    await handleCreateRuntime(request, response);
    return;
  }
  if (request.method === "DELETE") {
    await handleDelete(request, response, url);
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD, POST, DELETE");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  if (url.pathname === "/health") {
    const health = catalog.health();
    sendJson(response, 200, {
      status: "ok",
      ...health,
      safety_errors:
        health.safety_errors + deletion.getSafetyErrors().length,
    });
    return;
  }
  if (url.pathname === "/profiles") {
    const refreshed = await reloadProfiles();
    sendJson(response, 200, {
      profiles: refreshed.map(toPublicProfile),
    });
    return;
  }
  if (url.pathname === "/datasets") {
    const refreshed = await reloadDatasets();
    sendJson(response, 200, {
      datasets: refreshed.map(toPublicDataset),
    });
    return;
  }
  if (url.pathname === "/runtimes") {
    sendJson(response, 200, { runtimes: catalog.list() });
    return;
  }

  if (request.method === "HEAD") {
    response.statusCode = 200;
    response.end();
    return;
  }
  if (!(await serveStaticFile(staticRoot, url.pathname, response))) {
    sendJson(response, 404, { error: "not_found" });
  }
}

async function handleCreateRuntime(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (!isAllowedMutationOrigin(request)) {
    sendJson(response, 403, { error: "origin_not_allowed" });
    return;
  }
  let body: unknown;
  try {
    body = await readJsonBody(request, 8 * 1024);
  } catch {
    sendJson(response, 400, { error: "invalid_json" });
    return;
  }
  if (
    !isPlainObject(body) ||
    Object.keys(body).sort().join(",") !== "dataset_id,profile_id" ||
    typeof body.profile_id !== "string" ||
    typeof body.dataset_id !== "string"
  ) {
    sendJson(response, 400, { error: "invalid_request" });
    return;
  }
  try {
    const accepted = initializer.start(body.profile_id, body.dataset_id);
    sendJson(response, 202, accepted);
  } catch (error) {
    if (error instanceof RuntimeCreateError) {
      const status =
        error.kind === "not_found"
          ? 404
          : error.kind === "incompatible"
            ? 422
            : 409;
      sendJson(response, status, {
        error:
          error.kind === "not_found"
            ? "catalog_entry_not_found"
            : error.kind === "incompatible"
              ? "runtime_incompatible"
              : "runtime_exists",
      });
      return;
    }
    throw error;
  }
}

async function handleDelete(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  if (!isAllowedMutationOrigin(request)) {
    sendJson(response, 403, { error: "origin_not_allowed" });
    return;
  }
  if (hasRequestBody(request)) {
    sendJson(response, 400, { error: "request_body_not_allowed" });
    return;
  }

  const runtimeMatch =
    /^\/runtimes\/([a-z0-9-]+--[a-z0-9-]+)$/.exec(url.pathname);
  if (runtimeMatch) {
    if (
      sessionDeletes.needsReap(runtimeMatch[1]) &&
      !(await reapInterruptedSessionDelete(runtimeMatch[1]))
    ) {
      sendJson(response, 409, { error: "runtime_busy" });
      return;
    }
    try {
      await deletion.delete(runtimeMatch[1]);
      response.statusCode = 204;
      response.end();
    } catch (error) {
      if (error instanceof RuntimeDeleteError) {
        sendJson(response, error.kind === "not_found" ? 404 : 409, {
          error:
            error.kind === "not_found"
              ? "runtime_not_found"
              : error.kind === "busy"
                ? "runtime_busy"
                : "runtime_delete_failed",
        });
        return;
      }
      throw error;
    }
    return;
  }

  const sessionMatch =
    /^\/runtimes\/([a-z0-9-]+--[a-z0-9-]+)\/sessions\/([^/]+)$/.exec(
      url.pathname,
    );
  if (!sessionMatch) {
    sendJson(response, 404, { error: "not_found" });
    return;
  }
  const runtime = catalog.getLoaded(sessionMatch[1]);
  if (
    !runtime ||
    runtime.location !== "projects" ||
    runtime.manifest.status !== "ready" &&
      runtime.manifest.status !== "active"
  ) {
    sendJson(response, 404, { error: "runtime_not_found" });
    return;
  }
  let sessionId: string;
  try {
    sessionId = decodeURIComponent(sessionMatch[2]);
  } catch {
    sendJson(response, 400, { error: "invalid_session_id" });
    return;
  }
  if (!isOpenCodeSessionId(sessionId)) {
    sendJson(response, 400, { error: "invalid_session_id" });
    return;
  }
  if (
    bridge.isRuntimeBusy(runtime.manifest.id) ||
    (
      sessionDeletes.needsReap(runtime.manifest.id) &&
      !(await reapInterruptedSessionDelete(runtime.manifest.id))
    ) ||
    sessionDeletes.has(runtime.manifest.id) ||
    !catalog.beginSessionMaintenance(runtime.manifest.id)
  ) {
    sendJson(response, 409, { error: "runtime_busy" });
    return;
  }
  let releaseMaintenance = true;
  try {
    await bridge.closeRuntime(runtime.manifest.id);
    const refreshed = await catalog.revalidateLoaded(runtime.manifest.id);
    if (!catalog.ownsOperation(runtime.manifest.id, "session")) {
      sendJson(response, 409, { error: "runtime_busy" });
      return;
    }
    await sessionDeletes.delete(refreshed, sessionId);
    response.statusCode = 204;
    response.end();
  } catch (error) {
    if (error instanceof SessionDeleteError) {
      releaseMaintenance = error.processTreeStopped;
      sendJson(
        response,
        error.kind === "unsupported"
          ? 501
          : error.kind === "timeout"
            ? 504
            : 502,
        {
          error:
            error.kind === "unsupported"
              ? "session_delete_unsupported"
              : error.kind === "timeout"
                ? "session_delete_timeout"
                : "session_delete_failed",
        },
      );
      return;
    }
    throw error;
  } finally {
    if (releaseMaintenance) {
      const record = catalog.get(runtime.manifest.id);
      if (
        record?.manifest.status === "active" &&
        !bridge.runtimeStatus(runtime.manifest.id).active
      ) {
        await catalog
          .updateStatus(runtime.manifest.id, "ready", null, ["active"])
          .catch(() => undefined);
      }
      catalog.endOperation(runtime.manifest.id, "session");
    }
  }
}

async function reapInterruptedSessionDelete(
  runtimeId: string,
): Promise<boolean> {
  try {
    await sessionDeletes.stopRuntime(runtimeId);
    catalog.endOperation(runtimeId, "session");
    return true;
  } catch {
    return false;
  }
}

function reloadProfiles(): Promise<LoadedProfile[]> {
  if (profileReload) return profileReload;
  profileReload = (async () => {
    try {
      return await catalog.reloadProfiles(profilesRoot);
    } finally {
      profileReload = undefined;
    }
  })();
  return profileReload;
}

function reloadDatasets(): Promise<LoadedDataset[]> {
  if (datasetReload) return datasetReload;
  datasetReload = (async () => {
    try {
      return await catalog.reloadDatasets(datasetsRoot);
    } finally {
      datasetReload = undefined;
    }
  })();
  return datasetReload;
}

function isHttpMutation(request: IncomingMessage): boolean {
  return request.method === "POST" || request.method === "DELETE";
}

function applySecurityHeaders(response: ServerResponse): void {
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; " +
      "style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; " +
      "base-uri 'self'; form-action 'none'; frame-ancestors 'none'",
  );
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  response.setHeader("X-Frame-Options", "DENY");
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  value: unknown,
): void {
  const body = JSON.stringify(value);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(body);
}

function isAllowedMutationOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  return origin === undefined || allowedOrigins.has(origin);
}

function hasRequestBody(request: IncomingMessage): boolean {
  return (
    request.headers["transfer-encoding"] !== undefined ||
    request.headers["content-length"] !== undefined &&
      request.headers["content-length"] !== "0"
  );
}

async function readJsonBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<unknown> {
  if (
    request.headers["transfer-encoding"] !== undefined ||
    !request.headers["content-type"]
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    throw new Error("Invalid request framing");
  }
  const declared = Number(request.headers["content-length"]);
  if (!Number.isInteger(declared) || declared < 1 || declared > maxBytes) {
    throw new Error("Invalid Content-Length");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes || bytes > declared) {
      throw new Error("Request body exceeds limit");
    }
    chunks.push(buffer);
  }
  if (bytes !== declared) throw new Error("Incomplete request body");
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLoopbackHost(value: string): boolean {
  return value === "127.0.0.1" || value === "::1" || value === "localhost";
}

function parsePort(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(
      "AGENT_CONSOLE_PORT must be an integer between 1 and 65535",
    );
  }
  return parsed;
}

function parseAllowedOrigins(raw: string | undefined, listenPort: number): Set<string> {
  const defaults = [
    `http://127.0.0.1:${listenPort}`,
    `http://localhost:${listenPort}`,
    `http://[::1]:${listenPort}`,
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://[::1]:5173",
  ];
  const values = raw
    ? raw.split(",").map((value) => value.trim()).filter(Boolean)
    : defaults;
  const result = new Set<string>();
  for (const value of values) {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error(`Invalid allowed origin "${value}"`);
    }
    result.add(parsed.origin);
  }
  return result;
}
