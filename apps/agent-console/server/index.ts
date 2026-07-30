import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AcpBridge, type BridgeProfile } from "./bridge.js";
import {
  getMissingRequiredEnvironment,
  loadProfileCatalog,
  toPublicAgent,
} from "./profile.js";
import { serveStaticFile } from "./static-files.js";
import {
  deleteOpenCodeSession,
  isOpenCodeSessionId,
  SessionDeleteError,
} from "./session-delete.js";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultProfilesRoot = path.resolve(appRoot, "../../ontology-rag-demo/profiles");
const profilesRoot = path.resolve(process.env.AGENT_PROFILES_DIR ?? defaultProfilesRoot);
const staticRoot = path.resolve(process.env.AGENT_CONSOLE_STATIC_DIR ?? path.join(appRoot, "dist-web"));
const host = process.env.AGENT_CONSOLE_HOST ?? "127.0.0.1";
if (!isLoopbackHost(host)) {
  throw new Error("Agent Console v1 only permits a loopback listen address");
}
const port = parsePort(process.env.AGENT_CONSOLE_PORT ?? "4310");
const allowedOrigins = parseAllowedOrigins(
  process.env.AGENT_CONSOLE_ALLOWED_ORIGINS,
  port,
);

const profiles = await loadProfileCatalog(profilesRoot);
const bridge = new AcpBridge(profiles as BridgeProfile[]);
const activeDeletions = new Set<Promise<void>>();

const server = createServer(async (request, response) => {
  try {
    await handleHttpRequest(request, response);
  } catch (error) {
    console.error("Agent Console request failed", error instanceof Error ? error.message : String(error));
    sendJson(response, 500, { error: "internal_error" });
  }
});

server.on("upgrade", (request, socket, head) => {
  if (shuttingDown) {
    socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const origin = request.headers.origin;
  if (!origin || !allowedOrigins.has(origin)) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const match = /^\/agents\/([a-z0-9-]+)\/acp$/.exec(url.pathname);
  if (!match) {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  bridge.handleUpgrade(request, socket, head, match[1]);
});

server.listen(port, host, () => {
  console.log(`Ontology Agent Console listening on http://${host}:${port}`);
  console.log(`Loaded ${profiles.length} Agent Profile(s) from ${profilesRoot}`);
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await bridge.close();
  await Promise.allSettled([...activeDeletions]);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function isLoopbackHost(value: string): boolean {
  return value === "127.0.0.1" || value === "::1" || value === "localhost";
}

process.once("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  applySecurityHeaders(response);
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "DELETE") {
    await handleDeleteSession(request, response, url);
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD, DELETE");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  if (url.pathname === "/health") {
    sendJson(response, 200, {
      status: "ok",
      profiles: profiles.map((profile) => ({
        id: profile.id,
        ...bridge.profileStatus(profile.id),
      })),
    });
    return;
  }

  if (url.pathname === "/agents") {
    sendJson(response, 200, {
      agents: profiles.map((profile) => {
        const status =
          getMissingRequiredEnvironment(profile).length > 0
            ? "unavailable"
            : bridge.profileStatus(profile.id).active
              ? "active"
              : "stopped";
        return toPublicAgent(profile, status);
      }),
    });
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

async function handleDeleteSession(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const origin = request.headers.origin;
  if (origin && !allowedOrigins.has(origin)) {
    sendJson(response, 403, { error: "origin_not_allowed" });
    return;
  }
  if (
    request.headers["transfer-encoding"] !== undefined ||
    request.headers["content-length"] !== undefined &&
    request.headers["content-length"] !== "0"
  ) {
    sendJson(response, 400, { error: "request_body_not_allowed" });
    return;
  }

  const match =
    /^\/agents\/([a-z0-9-]+)\/sessions\/([^/]+)$/.exec(url.pathname);
  if (!match) {
    sendJson(response, 404, { error: "not_found" });
    return;
  }
  const profile = profiles.find((candidate) => candidate.id === match[1]);
  if (!profile) {
    sendJson(response, 404, { error: "profile_not_found" });
    return;
  }

  let sessionId: string;
  try {
    sessionId = decodeURIComponent(match[2]);
  } catch {
    sendJson(response, 400, { error: "invalid_session_id" });
    return;
  }
  if (!isOpenCodeSessionId(sessionId)) {
    sendJson(response, 400, { error: "invalid_session_id" });
    return;
  }
  if (!bridge.beginProfileMaintenance(profile.id)) {
    sendJson(response, 409, {
      error: "profile_busy",
      message:
        "This Profile is running or already undergoing maintenance and cannot delete a conversation",
    });
    return;
  }

  const deletion = (async () => {
    // OpenCode keeps loaded Sessions in process memory. Closing the idle
    // Profile runtime before invoking the CLI prevents that process from
    // re-publishing a just-deleted Session.
    await bridge.closeProfile(profile.id);
    await deleteOpenCodeSession(profile, sessionId);
  })();
  activeDeletions.add(deletion);
  try {
    await deletion;
    response.statusCode = 204;
    response.end();
  } catch (cause) {
    if (cause instanceof SessionDeleteError) {
      const statusCode =
        cause.kind === "unsupported"
          ? 501
          : cause.kind === "timeout"
            ? 504
            : 502;
      sendJson(response, statusCode, {
        error:
          cause.kind === "unsupported"
            ? "session_delete_unsupported"
            : cause.kind === "timeout"
              ? "session_delete_timeout"
              : "session_delete_failed",
        message: cause.message,
      });
      return;
    }
    throw cause;
  } finally {
    activeDeletions.delete(deletion);
    bridge.endProfileMaintenance(profile.id);
  }
}

function applySecurityHeaders(response: ServerResponse): void {
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; " +
      "style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; " +
      "base-uri 'self'; frame-ancestors 'none'",
  );
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("X-Frame-Options", "DENY");
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(body);
}

function parsePort(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("AGENT_CONSOLE_PORT must be an integer between 1 and 65535");
  }
  return parsed;
}

function parseAllowedOrigins(raw: string | undefined, listenPort: number): Set<string> {
  if (raw) {
    return new Set(
      raw
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    );
  }
  return new Set([
    `http://127.0.0.1:${listenPort}`,
    `http://localhost:${listenPort}`,
    "http://127.0.0.1:5173",
    "http://localhost:5173",
  ]);
}
