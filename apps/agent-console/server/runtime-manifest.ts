import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  Ajv2020,
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import { parseDocument, stringify } from "yaml";
import { loadDataset, type LoadedDataset } from "./dataset.js";
import { loadProfile, type LoadedProfile } from "./profile.js";
import { RUNTIME_V1_SCHEMA } from "./runtime-schema.js";
import {
  assertDirectChild,
  assertNoSymlinkSegments,
  writeFileAtomic,
} from "./safe-files.js";

const MAX_RUNTIME_MANIFEST_BYTES = 64 * 1024;
const RUNTIME_ID_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*--[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const RUNTIME_RELATIVE_PATHS = {
  workspace: "workspace",
  profile: "workspace/profile",
  dataset: "workspace/dataset",
  generated: "workspace/generated",
  opencode_db: "opencode/opencode.db",
  opencode_config: "opencode/config",
  state: "state",
} as const;

export type RuntimeStatus =
  | "initializing"
  | "ready"
  | "active"
  | "initialization_failed"
  | "deleting"
  | "delete_failed";

export interface RuntimeManifest {
  schema_version: 1;
  id: string;
  display_name: string;
  status: RuntimeStatus;
  created_at: string;
  profile: {
    id: string;
    title?: string;
    revision: string;
    snapshot_sha256: string;
  };
  dataset: {
    id: string;
    title?: string;
    ontology_file: string;
    snapshot_sha256: string;
    ontology_sha256: string;
  };
  paths: typeof RUNTIME_RELATIVE_PATHS;
  last_error: null | { code: string };
}

export type RuntimeLocation = "projects" | "staging";

export interface RuntimePaths {
  root: string;
  manifest: string;
  workspace: string;
  profile: string;
  dataset: string;
  generated: string;
  opencodeDb: string;
  opencodeConfig: string;
  state: string;
  logs: string;
}

export interface LoadedRuntime {
  manifest: RuntimeManifest;
  location: RuntimeLocation;
  managedParent: string;
  paths: RuntimePaths;
  profile: LoadedProfile;
  dataset: LoadedDataset;
}

export interface RuntimeRecord {
  manifest: RuntimeManifest;
  location: RuntimeLocation;
  root: string;
  loaded?: LoadedRuntime;
}

export interface PublicRuntime {
  id: string;
  display_name: string;
  status: RuntimeStatus;
  created_at: string;
  profile: {
    id: string;
    title: string;
    description?: string;
    revision: string;
  };
  dataset: {
    id: string;
    title: string;
    description?: string;
    ontology_sha256: string;
  };
  ws_url: string;
  stale: boolean;
  last_error: null | { code: string };
}

export class RuntimeManifestError extends Error {
  readonly manifestPath?: string;

  constructor(message: string, manifestPath?: string, options?: ErrorOptions) {
    super(manifestPath ? `${manifestPath}: ${message}` : message, options);
    this.name = "RuntimeManifestError";
    this.manifestPath = manifestPath;
  }
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  allowUnionTypes: false,
});
ajv.addSchema(RUNTIME_V1_SCHEMA);
const validateRuntime = ajv.getSchema(
  RUNTIME_V1_SCHEMA.$id,
) as ValidateFunction;

export function makeRuntimeId(profileId: string, datasetId: string): string {
  const id = `${profileId}--${datasetId}`;
  if (!RUNTIME_ID_PATTERN.test(id)) {
    throw new RuntimeManifestError("Invalid Profile/Dataset Runtime id");
  }
  return id;
}

export function splitRuntimeId(
  runtimeId: string,
): { profileId: string; datasetId: string } {
  if (!RUNTIME_ID_PATTERN.test(runtimeId)) {
    throw new RuntimeManifestError("Invalid Runtime id");
  }
  const separator = runtimeId.indexOf("--");
  return {
    profileId: runtimeId.slice(0, separator),
    datasetId: runtimeId.slice(separator + 2),
  };
}

export function isRuntimeId(value: string): boolean {
  return RUNTIME_ID_PATTERN.test(value);
}

export function buildRuntimePaths(runtimeRoot: string): RuntimePaths {
  const root = path.resolve(runtimeRoot);
  return {
    root,
    manifest: path.join(root, "runtime.yaml"),
    workspace: path.join(root, RUNTIME_RELATIVE_PATHS.workspace),
    profile: path.join(root, RUNTIME_RELATIVE_PATHS.profile),
    dataset: path.join(root, RUNTIME_RELATIVE_PATHS.dataset),
    generated: path.join(root, RUNTIME_RELATIVE_PATHS.generated),
    opencodeDb: path.join(root, RUNTIME_RELATIVE_PATHS.opencode_db),
    opencodeConfig: path.join(root, RUNTIME_RELATIVE_PATHS.opencode_config),
    state: path.join(root, RUNTIME_RELATIVE_PATHS.state),
    logs: path.join(root, "logs"),
  };
}

export function createRuntimeManifest(
  profile: LoadedProfile,
  dataset: LoadedDataset,
  status: RuntimeStatus = "initializing",
  now = new Date(),
): RuntimeManifest {
  return {
    schema_version: 1,
    id: makeRuntimeId(profile.id, dataset.id),
    display_name: `${profile.title} · ${dataset.title}`,
    status,
    created_at: now.toISOString(),
    profile: {
      id: profile.id,
      title: profile.title,
      revision: profile.revision,
      snapshot_sha256: profile.snapshotSha256,
    },
    dataset: {
      id: dataset.id,
      title: dataset.title,
      ontology_file: dataset.ontologyFile,
      snapshot_sha256: dataset.snapshotSha256,
      ontology_sha256: dataset.ontologySha256,
    },
    paths: { ...RUNTIME_RELATIVE_PATHS },
    last_error: null,
  };
}

export async function readRuntimeManifest(
  manifestPath: string,
): Promise<RuntimeManifest> {
  const absolute = path.resolve(manifestPath);
  await assertRegularFileWithoutSymlink(absolute);
  const fileStats = await stat(absolute);
  if (fileStats.size > MAX_RUNTIME_MANIFEST_BYTES) {
    throw new RuntimeManifestError(
      `Runtime manifest exceeds ${MAX_RUNTIME_MANIFEST_BYTES} bytes`,
      absolute,
    );
  }
  const contents = await readFile(absolute);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(contents);
  } catch (error) {
    throw new RuntimeManifestError(
      "Runtime manifest is not valid UTF-8",
      absolute,
      { cause: error },
    );
  }
  const document = parseDocument(text, {
    schema: "core",
    uniqueKeys: true,
    prettyErrors: false,
  });
  if (document.errors.length > 0 || document.warnings.length > 0) {
    throw new RuntimeManifestError(
      `YAML parsing failed: ${[
        ...document.errors,
        ...document.warnings,
      ].map((error) => error.message).join("; ")}`,
      absolute,
    );
  }
  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new RuntimeManifestError(
      "YAML aliases are not allowed in Runtime manifests",
      absolute,
      { cause: error },
    );
  }
  if (!validateRuntime(value)) {
    throw new RuntimeManifestError(
      `Runtime schema validation failed: ${formatAjvErrors(validateRuntime.errors)}`,
      absolute,
    );
  }
  return value as RuntimeManifest;
}

export async function writeRuntimeManifest(
  runtimeRoot: string,
  manifest: RuntimeManifest,
): Promise<void> {
  if (!validateRuntime(manifest)) {
    throw new RuntimeManifestError(
      `Runtime schema validation failed: ${formatAjvErrors(validateRuntime.errors)}`,
    );
  }
  const paths = buildRuntimePaths(runtimeRoot);
  await writeFileAtomic(
    paths.manifest,
    stringify(manifest, { lineWidth: 0, sortMapEntries: false }),
  );
}

export async function loadRuntime(
  runtimeRoot: string,
  managedParent: string,
  location: RuntimeLocation,
  demoRoot: string,
  signal?: AbortSignal,
): Promise<LoadedRuntime> {
  const parent = await canonicalDirectory(managedParent, "Runtime parent");
  const requestedRoot = path.resolve(runtimeRoot);
  assertDirectChild(parent, requestedRoot, "Runtime must be a managed direct child");
  await assertNoSymlinkSegments(parent, requestedRoot);
  const root = await canonicalDirectory(requestedRoot, "Runtime root");
  assertDirectChild(parent, root, "Runtime must be a managed direct child");

  const paths = buildRuntimePaths(root);
  await validateRuntimeLayout(paths);
  const manifest = await readRuntimeManifest(paths.manifest);
  validateRuntimeIdentity(manifest, path.basename(root), location, paths.manifest);

  const profile = await loadProfile(
    path.join(paths.profile, "profile.yaml"),
    paths.workspace,
    { enforceDirectoryId: false, demoRoot, signal },
  );
  const dataset = await loadDataset(
    path.join(paths.dataset, "dataset.yaml"),
    paths.workspace,
    { enforceDirectoryId: false, signal },
  );
  if (
    profile.id !== manifest.profile.id ||
    profile.revision !== manifest.profile.revision
  ) {
    throw new RuntimeManifestError(
      "Runtime Profile snapshot does not match its manifest",
      paths.manifest,
    );
  }
  if (
    dataset.id !== manifest.dataset.id ||
    dataset.ontologyFile !== manifest.dataset.ontology_file ||
    dataset.snapshotSha256 !== manifest.dataset.snapshot_sha256 ||
    dataset.ontologySha256 !== manifest.dataset.ontology_sha256
  ) {
    throw new RuntimeManifestError(
      "Runtime Dataset snapshot does not match its manifest",
      paths.manifest,
    );
  }

  return {
    manifest,
    location,
    managedParent: parent,
    paths,
    profile,
    dataset,
  };
}

/**
 * Cheap reconnect-time validation. Full snapshot digests are verified during
 * creation/startup; reconnects re-check only fixed execution boundaries and
 * the small Runtime manifest so large Dataset/LanceDB trees are not re-read.
 */
export async function revalidateRuntimeExecution(
  runtime: LoadedRuntime,
): Promise<LoadedRuntime> {
  const managedParent = await canonicalDirectory(
    runtime.managedParent,
    "Runtime parent",
  );
  if (managedParent !== path.resolve(runtime.managedParent)) {
    throw new RuntimeManifestError(
      "Runtime parent traverses a symbolic link",
      runtime.paths.manifest,
    );
  }
  assertDirectChild(
    managedParent,
    runtime.paths.root,
    "Runtime must remain a managed direct child",
  );
  await assertNoSymlinkSegments(managedParent, runtime.paths.root);
  const canonicalRoot = await canonicalDirectory(
    runtime.paths.root,
    "Runtime root",
  );
  if (canonicalRoot !== runtime.paths.root) {
    throw new RuntimeManifestError(
      "Runtime root changed after validation",
      runtime.paths.manifest,
    );
  }
  await validateRuntimeLayout(runtime.paths);
  const manifest = await readRuntimeManifest(runtime.paths.manifest);
  validateRuntimeIdentity(
    manifest,
    path.basename(runtime.paths.root),
    runtime.location,
    runtime.paths.manifest,
  );
  if (
    manifest.id !== runtime.manifest.id ||
    manifest.profile.id !== runtime.profile.id ||
    manifest.profile.revision !== runtime.profile.revision ||
    manifest.profile.snapshot_sha256 !==
      runtime.manifest.profile.snapshot_sha256 ||
    manifest.dataset.id !== runtime.dataset.id ||
    manifest.dataset.ontology_file !== runtime.dataset.ontologyFile ||
    manifest.dataset.snapshot_sha256 !==
      runtime.dataset.snapshotSha256 ||
    manifest.dataset.ontology_sha256 !== runtime.dataset.ontologySha256
  ) {
    throw new RuntimeManifestError(
      "Runtime execution identity changed after validation",
      runtime.paths.manifest,
    );
  }
  for (const file of [
    runtime.profile.configPath,
    ...runtime.profile.configAssets.map((asset) => asset.path),
    runtime.dataset.ontologyPath,
  ]) {
    await assertNoSymlinkSegments(runtime.paths.root, file);
    const fileStats = await lstat(file);
    if (fileStats.isSymbolicLink() || !fileStats.isFile()) {
      throw new RuntimeManifestError(
        "Runtime execution file must be a regular non-symlink file",
        runtime.paths.manifest,
      );
    }
  }
  for (const skill of runtime.profile.skills) {
    await assertNoSymlinkSegments(runtime.paths.profile, skill.path);
    const skillStats = await lstat(skill.path);
    if (skillStats.isSymbolicLink() || !skillStats.isDirectory()) {
      throw new RuntimeManifestError(
        "Runtime Skill must be a non-symlink directory",
        runtime.paths.manifest,
      );
    }
  }
  return { ...runtime, manifest };
}

async function validateRuntimeLayout(paths: RuntimePaths): Promise<void> {
  for (const [label, directory] of [
    ["workspace", paths.workspace],
    ["Profile snapshot", paths.profile],
    ["Dataset snapshot", paths.dataset],
    ["generated", paths.generated],
    ["OpenCode root", path.dirname(paths.opencodeConfig)],
    ["OpenCode config", paths.opencodeConfig],
    ["state", paths.state],
    ["logs", paths.logs],
  ] as const) {
    await assertNoSymlinkSegments(paths.root, directory);
    const directoryStats = await lstat(directory);
    if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
      throw new RuntimeManifestError(
        `${label} must be a non-symlink directory`,
        paths.manifest,
      );
    }
  }
  try {
    const databaseStats = await lstat(paths.opencodeDb);
    if (databaseStats.isSymbolicLink() || !databaseStats.isFile()) {
      throw new RuntimeManifestError(
        "OpenCode database must be a regular non-symlink file",
        paths.manifest,
      );
    }
  } catch (error) {
    if (!(isNodeError(error) && error.code === "ENOENT")) throw error;
  }
}

export function toPublicRuntime(
  record: RuntimeRecord,
  stale: boolean,
): PublicRuntime {
  const { manifest } = record;
  return {
    id: manifest.id,
    display_name: manifest.display_name,
    status: manifest.status,
    created_at: manifest.created_at,
    profile: {
      id: manifest.profile.id,
      title:
        manifest.profile.title ??
        record.loaded?.profile.title ??
        manifest.profile.id,
      ...(record.loaded
        ? { description: record.loaded.profile.description }
        : {}),
      revision: manifest.profile.revision,
    },
    dataset: {
      id: manifest.dataset.id,
      title:
        manifest.dataset.title ??
        record.loaded?.dataset.title ??
        manifest.dataset.id,
      ...(record.loaded
        ? { description: record.loaded.dataset.description }
        : {}),
      ontology_sha256: manifest.dataset.ontology_sha256,
    },
    ws_url: `/runtimes/${manifest.id}/acp`,
    stale,
    last_error: manifest.last_error,
  };
}

function validateRuntimeIdentity(
  manifest: RuntimeManifest,
  directoryName: string,
  location: RuntimeLocation,
  manifestPath: string,
): void {
  const expectedId = makeRuntimeId(manifest.profile.id, manifest.dataset.id);
  if (manifest.id !== expectedId) {
    throw new RuntimeManifestError(
      "Runtime id does not match Profile/Dataset ids",
      manifestPath,
    );
  }
  if (
    (location === "projects" && directoryName !== manifest.id) ||
    (location === "staging" &&
      !new RegExp(`^${escapeRegExp(manifest.id)}--[a-f0-9]{16}$`).test(
        directoryName,
      ))
  ) {
    throw new RuntimeManifestError(
      "Runtime directory name does not match its manifest",
      manifestPath,
    );
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function assertRegularFileWithoutSymlink(filePath: string): Promise<void> {
  let fileStats;
  try {
    fileStats = await lstat(filePath);
  } catch (error) {
    throw new RuntimeManifestError("Runtime manifest does not exist", filePath, {
      cause: error,
    });
  }
  if (fileStats.isSymbolicLink() || !fileStats.isFile()) {
    throw new RuntimeManifestError(
      "Runtime manifest must be a regular non-symlink file",
      filePath,
    );
  }
}

async function canonicalDirectory(directory: string, label: string): Promise<string> {
  const absolute = path.resolve(directory);
  let entryStats;
  try {
    entryStats = await lstat(absolute);
  } catch (error) {
    throw new RuntimeManifestError(`${label} does not exist`, absolute, {
      cause: error,
    });
  }
  if (entryStats.isSymbolicLink() || !entryStats.isDirectory()) {
    throw new RuntimeManifestError(
      `${label} must be a non-symlink directory`,
      absolute,
    );
  }
  return realpath(absolute);
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return "unknown schema error";
  return errors
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join("; ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
