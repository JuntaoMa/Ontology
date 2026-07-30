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
import type { LoadedRuntime } from "./runtime-manifest.js";

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

const SAFE_PROFILE_TUNING_ENVIRONMENT = [
  "EMBEDDING_BACKEND",
  "EMBEDDING_MODEL",
  "EMBEDDING_DEVICE",
  "EMBEDDING_BATCH_SIZE",
  "EMBEDDING_MAX_LENGTH",
  "EMBEDDING_NORMALIZE",
  "HF_HUB_DISABLE_XET",
  "TOKENIZERS_PARALLELISM",
] as const;

/**
 * OpenCode bootstraps dependencies inside OPENCODE_CONFIG_DIR. These entries
 * are Runtime-owned and must survive snapshot overlay refreshes.
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

export function buildRuntimeVariables(
  runtime: LoadedRuntime,
): Readonly<Record<string, string>> {
  return {
    ONTOLOGY_DEMO_ROOT: runtime.profile.demoRoot,
    ONTOLOGY_RUNTIME_ID: runtime.manifest.id,
    ONTOLOGY_RUNTIME_ROOT: runtime.paths.root,
    ONTOLOGY_WORKSPACE_DIR: runtime.paths.workspace,
    ONTOLOGY_PROFILE_DIR: runtime.paths.profile,
    ONTOLOGY_DATASET_DIR: runtime.paths.dataset,
    ONTOLOGY_GENERATED_DIR: runtime.paths.generated,
    ONTOLOGY_RUNTIME_STATE_DIR: runtime.paths.state,
    ONTOLOGY_PATH: runtime.dataset.ontologyPath,
    ONTOLOGY_ID: runtime.dataset.id,
    ONTOLOGY_EXPECTED_SHA256: runtime.dataset.ontologySha256,
    OPENCODE_DB: runtime.paths.opencodeDb,
    OPENCODE_CONFIG_DIR: runtime.paths.opencodeConfig,
  };
}

/**
 * Build a small, deterministic subprocess environment. Profile-referenced
 * secrets keep their original environment names; no browser value is merged.
 */
export function buildChildEnvironment(
  runtime: LoadedRuntime,
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of SAFE_INHERITED_ENVIRONMENT) {
    const value = source[name];
    if (value !== undefined) environment[name] = value;
  }
  for (const name of runtime.profile.requiredEnv) {
    const value = source[name];
    if (value !== undefined) environment[name] = value;
  }
  for (const name of SAFE_PROFILE_TUNING_ENVIRONMENT) {
    const value = source[name];
    if (value !== undefined) environment[name] = value;
  }
  Object.assign(environment, buildRuntimeVariables(runtime));
  // Keep both source and Runtime-local Profile packages free of incidental
  // Python bytecode so their declarative contents stay portable.
  environment.PYTHONDONTWRITEBYTECODE = "1";
  environment.ONTOLOGY_MODEL_ID = runtime.profile.model.id;
  if (runtime.profile.skillsRoot) {
    environment.ONTOLOGY_SKILLS_ROOT = runtime.profile.skillsRoot;
  }
  if (runtime.profile.retrieval) {
    environment.ONTOLOGY_VECTOR_TOP_K = String(
      runtime.profile.retrieval.vectorTopK,
    );
    environment.ONTOLOGY_GRAPH_ALGORITHM =
      runtime.profile.retrieval.graphAlgorithm;
  }
  return environment;
}

/**
 * Refresh the Profile-owned overlay exactly while preserving only OpenCode's
 * dependency bootstrap entries. Removed Profile assets cannot remain active.
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
        throw new Error(
          `OpenCode bootstrap entry must not be a symbolic link: ${entry.name}`,
        );
      }
      continue;
    }
    rmSync(entryPath, { recursive: true, force: true });
  }

  copyFileSync(profile.configPath, path.join(root, "opencode.jsonc"));
  for (const asset of profile.configAssets) {
    const destination = resolveRuntimeAssetDestination(root, asset.relativePath);
    mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    copyFileSync(asset.path, destination);
  }
}

function ensureRuntimeDirectory(directory: string): void {
  if (existsSync(directory)) {
    const directoryStats = lstatSync(directory);
    if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
      throw new Error(
        "OpenCode Runtime config path must be a non-symlink directory",
      );
    }
    return;
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const directoryStats = lstatSync(directory);
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
    throw new Error(
      "OpenCode Runtime config path must be a non-symlink directory",
    );
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
    throw new Error("Invalid OpenCode Runtime asset destination");
  }
  return destination;
}

function normalizedPathKey(value: string): string {
  return process.platform === "win32" ? value.toLocaleLowerCase() : value;
}
