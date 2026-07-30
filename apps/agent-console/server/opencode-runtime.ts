import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import type { LoadedProfile } from "./profile.js";

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

/**
 * OpenCode bootstraps dependencies inside OPENCODE_CONFIG_DIR. These entries
 * are runtime-owned and must survive Profile overlay refreshes.
 */
const OPENCODE_BOOTSTRAP_ENTRIES = new Set([
  ".gitignore",
  "bun.lock",
  "bun.lockb",
  "node_modules",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

export function buildChildEnvironment(
  profile: LoadedProfile,
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

/**
 * Refresh the Profile-owned overlay exactly while preserving only OpenCode's
 * dependency bootstrap entries. This prevents a removed prompt or config
 * sidecar from silently remaining active on the next launch.
 */
export function prepareRuntimeConfigOverlay(
  profile: Pick<LoadedProfile, "configPath" | "configAssets">,
  runtimeConfigDir: string,
): void {
  const root = path.resolve(runtimeConfigDir);
  ensureRuntimeDirectory(root);

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (OPENCODE_BOOTSTRAP_ENTRIES.has(entry.name)) {
      if (entry.isSymbolicLink()) {
        throw new Error(`OpenCode bootstrap entry must not be a symbolic link: ${entry.name}`);
      }
      continue;
    }
    rmSync(entryPath, { recursive: true, force: true });
  }

  copyFileSync(profile.configPath, path.join(root, "opencode.jsonc"));
  for (const asset of profile.configAssets) {
    const destination = resolveRuntimeAssetDestination(
      root,
      asset.relativePath,
    );
    mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    copyFileSync(asset.path, destination);
  }
}

function ensureRuntimeDirectory(directory: string): void {
  if (existsSync(directory)) {
    const directoryStats = lstatSync(directory);
    if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
      throw new Error("OpenCode runtime config path must be a non-symlink directory");
    }
    return;
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const directoryStats = lstatSync(directory);
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
    throw new Error("OpenCode runtime config path must be a non-symlink directory");
  }
}

function resolveRuntimeAssetDestination(
  runtimeConfigDir: string,
  relativePath: string,
): string {
  const root = path.resolve(runtimeConfigDir);
  const destination = path.resolve(root, relativePath);
  const relative = path.relative(root, destination);
  const [topLevelEntry] = relative.split(path.sep);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    normalizedPathKey(relative) === normalizedPathKey("opencode.jsonc") ||
    (topLevelEntry !== undefined &&
      OPENCODE_BOOTSTRAP_ENTRIES.has(topLevelEntry))
  ) {
    throw new Error("Invalid OpenCode runtime asset destination");
  }
  return destination;
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

function normalizedPathKey(value: string): string {
  return process.platform === "win32" ? value.toLocaleLowerCase() : value;
}
