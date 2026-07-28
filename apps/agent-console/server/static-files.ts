import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import path from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export async function serveStaticFile(
  staticRoot: string,
  requestPath: string,
  response: ServerResponse,
): Promise<boolean> {
  const decoded = safeDecodeURIComponent(requestPath);
  if (decoded === null) return false;

  const relativePath = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  let candidate = resolveInside(staticRoot, relativePath);
  if (!candidate) return false;

  if (!(await isRegularFile(candidate))) {
    candidate = resolveInside(staticRoot, "index.html");
    if (!candidate || !(await isRegularFile(candidate))) return false;
  }

  const extension = path.extname(candidate).toLowerCase();
  response.statusCode = 200;
  response.setHeader("Content-Type", CONTENT_TYPES[extension] ?? "application/octet-stream");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (extension === ".html") {
    response.setHeader("Cache-Control", "no-store");
  } else {
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  }
  createReadStream(candidate).pipe(response);
  return true;
}

export function resolveInside(root: string, relativePath: string): string | null {
  const absoluteRoot = path.resolve(root);
  const candidate = path.resolve(absoluteRoot, relativePath);
  if (candidate === absoluteRoot || candidate.startsWith(`${absoluteRoot}${path.sep}`)) {
    return candidate;
  }
  return null;
}

async function isRegularFile(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
