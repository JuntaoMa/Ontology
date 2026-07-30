import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  readdir,
  readFile,
  realpath,
  stat,
} from "node:fs/promises";
import path from "node:path";
import {
  Ajv2020,
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import { parseDocument } from "yaml";
import { PROFILE_V2_SCHEMA } from "./profile-schema.js";
import {
  assertPathInside,
  inspectTree,
  type TreeSummary,
} from "./safe-files.js";

const MAX_PROFILE_BYTES = 64 * 1024;
const MAX_CATALOG_PROFILES = 256;
const PROFILE_FILENAME = "profile.yaml";
const PROFILE_TREE_LIMITS = {
  maxFiles: 4_096,
  maxTotalBytes: 512 * 1024 * 1024,
  maxFileBytes: 256 * 1024 * 1024,
  maxDepth: 24,
} as const;
const ENV_REF_KEY = "env";
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RUNTIME_VARIABLES = new Set([
  "ONTOLOGY_DEMO_ROOT",
  "ONTOLOGY_RUNTIME_ID",
  "ONTOLOGY_RUNTIME_ROOT",
  "ONTOLOGY_WORKSPACE_DIR",
  "ONTOLOGY_PROFILE_DIR",
  "ONTOLOGY_DATASET_DIR",
  "ONTOLOGY_GENERATED_DIR",
  "ONTOLOGY_RUNTIME_STATE_DIR",
  "ONTOLOGY_PATH",
  "ONTOLOGY_ID",
  "ONTOLOGY_EXPECTED_SHA256",
  "OPENCODE_DB",
  "OPENCODE_CONFIG_DIR",
]);

export interface EnvReference {
  env: string;
}

export type ProfileModelAuthenticationV2 =
  | { source: "opencode" }
  | { source: "environment"; api_key: EnvReference };

export type ProfileModelV2 =
  | {
      id: string;
      source: "opencode";
      auth: ProfileModelAuthenticationV2;
    }
  | {
      id: string;
      source: "profile";
      api_base: EnvReference;
      auth: ProfileModelAuthenticationV2;
    };

export interface ProfileCommandV2 {
  command: string;
  args: string[];
}

export interface ProfileV2 {
  schema_version: 2;
  id: string;
  revision: string;
  title: string;
  description: string;
  agent: ProfileCommandV2 & {
    startup_timeout_ms: number;
  };
  opencode: {
    config: string;
    assets?: string[];
  };
  initializer?: ProfileCommandV2 & {
    timeout_ms: number;
  };
  model: ProfileModelV2;
  skills: Array<{ id: string; path: string }>;
  retrieval?: {
    vector_top_k: number;
    graph_algorithm: "minimum_connected_subgraph";
  };
  dataset_contract: {
    ontology: "required";
    raw_data: "required" | "optional";
  };
}

export interface LoadedCommand {
  command: string;
  args: string[];
}

export interface LoadedProfile {
  id: string;
  revision: string;
  title: string;
  description: string;
  profilePath: string;
  profileRoot: string;
  demoRoot: string;
  /** Digest of the complete source Profile tree at load time. */
  snapshotSha256: string;
  agent: LoadedCommand & {
    startupTimeoutMs: number;
  };
  initializer?: LoadedCommand & {
    timeoutMs: number;
  };
  configPath: string;
  configAssets: Array<{ path: string; relativePath: string }>;
  skills: Array<{ id: string; path: string }>;
  skillsRoot?: string;
  requiredEnv: string[];
  model: LoadedProfileModel;
  retrieval?: {
    vectorTopK: number;
    graphAlgorithm: "minimum_connected_subgraph";
  };
  datasetContract: {
    ontology: "required";
    rawData: "required" | "optional";
  };
}

export type LoadedProfileModelAuthentication =
  | { source: "opencode" }
  | { source: "environment"; apiKeyEnv: string };

export type LoadedProfileModel =
  | {
      id: string;
      source: "opencode";
      auth: LoadedProfileModelAuthentication;
    }
  | {
      id: string;
      source: "profile";
      apiBaseEnv: string;
      auth: LoadedProfileModelAuthentication;
    };

export interface PublicProfile {
  id: string;
  revision: string;
  title: string;
  description: string;
}

export interface LoadProfileOptions {
  /** Snapshot directories are named `profile`, not with the source id. */
  enforceDirectoryId?: boolean;
  demoRoot?: string;
  signal?: AbortSignal;
}

export class ProfileValidationError extends Error {
  readonly profilePath?: string;

  constructor(message: string, profilePath?: string, options?: ErrorOptions) {
    super(profilePath ? `${profilePath}: ${message}` : message, options);
    this.name = "ProfileValidationError";
    this.profilePath = profilePath;
  }
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  allowUnionTypes: false,
});
ajv.addSchema(PROFILE_V2_SCHEMA);
const validateProfile = ajv.getSchema(PROFILE_V2_SCHEMA.$id) as ValidateFunction;

/**
 * Discover only the two-level source catalog: profiles/<profile-id>/profile.yaml.
 */
export async function loadProfileCatalog(
  profilesRoot: string,
): Promise<LoadedProfile[]> {
  const root = await canonicalDirectory(profilesRoot, "Profile catalog root");
  const demoRoot = await canonicalDirectory(path.dirname(root), "Demo root");
  const entries = await readdir(root, { withFileTypes: true });
  const profileDirectories = entries
    .filter((entry) => !entry.name.startsWith(".") && !entry.name.startsWith("_"))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (profileDirectories.length > MAX_CATALOG_PROFILES) {
    throw new ProfileValidationError(
      `Profile catalog exceeds ${MAX_CATALOG_PROFILES} profiles`,
      root,
    );
  }

  const profiles: LoadedProfile[] = [];
  for (const entry of profileDirectories) {
    const entryPath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      throw new ProfileValidationError(
        "Profile catalog must not contain symbolic links",
        entryPath,
      );
    }
    if (!entry.isDirectory()) continue;
    if (!ID_PATTERN.test(entry.name)) {
      throw new ProfileValidationError(
        "Profile directory name must be a lowercase kebab id",
        entryPath,
      );
    }
    const profilePath = path.join(entryPath, PROFILE_FILENAME);
    let profileStats;
    try {
      profileStats = await lstat(profilePath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") continue;
      throw error;
    }
    if (profileStats.isSymbolicLink() || !profileStats.isFile()) {
      throw new ProfileValidationError(
        "profile.yaml must be a regular non-symlink file",
        profilePath,
      );
    }
    profiles.push(
      await loadProfile(profilePath, root, {
        enforceDirectoryId: true,
        demoRoot,
      }),
    );
  }
  const ids = new Set<string>();
  for (const profile of profiles) {
    if (ids.has(profile.id)) {
      throw new ProfileValidationError(
        `Duplicate profile id "${profile.id}"`,
        profile.profilePath,
      );
    }
    ids.add(profile.id);
  }
  return profiles.sort((left, right) => left.id.localeCompare(right.id));
}

export async function loadProfile(
  profilePath: string,
  profilesRoot: string,
  options: LoadProfileOptions = {},
): Promise<LoadedProfile> {
  const catalogRoot = await canonicalDirectory(profilesRoot, "Profile catalog root");
  const requestedProfilePath = path.resolve(profilePath);
  await assertRegularFileWithoutSymlink(requestedProfilePath, "Profile");
  const absoluteProfilePath = await realpath(requestedProfilePath);
  assertPathInside(
    catalogRoot,
    absoluteProfilePath,
    "Profile file must be inside the catalog root",
  );

  const profileRoot = await canonicalDirectory(
    path.dirname(absoluteProfilePath),
    "Profile root",
  );
  assertPathInside(
    catalogRoot,
    profileRoot,
    "Profile root must be inside the catalog",
    true,
  );
  await rejectProfileBuildArtifacts(profileRoot);
  let profileTree: TreeSummary;
  try {
    profileTree = await inspectTree(
      profileRoot,
      PROFILE_TREE_LIMITS,
      options.signal,
    );
  } catch (error) {
    throw new ProfileValidationError(
      "Profile tree contains an unsafe entry",
      absoluteProfilePath,
      { cause: error },
    );
  }
  const source = parseProfileYaml(
    await readTextFileLimited(absoluteProfilePath, MAX_PROFILE_BYTES, "Profile"),
    absoluteProfilePath,
  );
  validateProfileObject(source, absoluteProfilePath);
  validateProfileSemantics(source, absoluteProfilePath);
  if (
    options.enforceDirectoryId !== false &&
    path.basename(profileRoot) !== source.id
  ) {
    throw new ProfileValidationError(
      "Profile id must match its directory name",
      absoluteProfilePath,
    );
  }

  const demoRoot = await canonicalDirectory(
    options.demoRoot ?? path.dirname(catalogRoot),
    "Demo root",
  );
  const configPath = await resolveProfileFile(
    profileRoot,
    source.opencode.config,
    "opencode.config",
    absoluteProfilePath,
  );
  const configDir = path.dirname(configPath);
  const configAssets: LoadedProfile["configAssets"] = [];
  const assetDestinations = new Set<string>();
  for (const asset of source.opencode.assets ?? []) {
    const assetPath = await resolveProfileFile(
      profileRoot,
      asset,
      `opencode.assets.${asset}`,
      absoluteProfilePath,
    );
    assertPathInside(
      configDir,
      assetPath,
      "OpenCode assets must be children of the config directory",
      true,
    );
    const relativePath = portableRelative(configDir, assetPath);
    const key = normalizedPathKey(relativePath);
    if (assetDestinations.has(key) || key === normalizedPathKey("opencode.jsonc")) {
      throw new ProfileValidationError(
        `Duplicate or reserved OpenCode asset destination "${relativePath}"`,
        absoluteProfilePath,
      );
    }
    assetDestinations.add(key);
    configAssets.push({ path: assetPath, relativePath });
  }
  configAssets.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );

  const skills: LoadedProfile["skills"] = [];
  const skillsDirectory = path.join(profileRoot, "skills");
  for (const skill of source.skills) {
    const skillPath = await resolveProfileDirectory(
      profileRoot,
      skill.path,
      `skills.${skill.id}.path`,
      absoluteProfilePath,
    );
    assertPathInside(
      skillsDirectory,
      skillPath,
      `Skill "${skill.id}" must be below the Profile skills directory`,
      true,
    );
    if (
      path.dirname(skillPath) !== skillsDirectory ||
      path.basename(skillPath) !== skill.id
    ) {
      throw new ProfileValidationError(
        `Skill "${skill.id}" path must be skills/${skill.id}`,
        absoluteProfilePath,
      );
    }
    await assertRegularFileWithoutSymlink(
      path.join(skillPath, "SKILL.md"),
      `Skill "${skill.id}" SKILL.md`,
    );
    skills.push({ id: skill.id, path: skillPath });
  }

  return {
    id: source.id,
    revision: source.revision,
    title: source.title,
    description: source.description,
    profilePath: absoluteProfilePath,
    profileRoot,
    demoRoot,
    snapshotSha256: profileTree.sha256,
    agent: {
      command: await resolveCommand(
        source.agent.command,
        profileRoot,
        absoluteProfilePath,
      ),
      args: [...source.agent.args],
      startupTimeoutMs: source.agent.startup_timeout_ms,
    },
    ...(source.initializer
      ? {
          initializer: {
            command: await resolveCommand(
              source.initializer.command,
              profileRoot,
              absoluteProfilePath,
            ),
            args: [...source.initializer.args],
            timeoutMs: source.initializer.timeout_ms,
          },
        }
      : {}),
    configPath,
    configAssets,
    skills,
    ...(skills.length > 0 ? { skillsRoot: skillsDirectory } : {}),
    requiredEnv: [...collectEnvironmentReferences(source)].sort(),
    model: loadProfileModel(source.model),
    ...(source.retrieval
      ? {
          retrieval: {
            vectorTopK: source.retrieval.vector_top_k,
            graphAlgorithm: source.retrieval.graph_algorithm,
          },
        }
      : {}),
    datasetContract: {
      ontology: source.dataset_contract.ontology,
      rawData: source.dataset_contract.raw_data,
    },
  };
}

export function toPublicProfile(profile: LoadedProfile): PublicProfile {
  return {
    id: profile.id,
    revision: profile.revision,
    title: profile.title,
    description: profile.description,
  };
}

export function getMissingRequiredEnvironment(
  profile: Pick<LoadedProfile, "requiredEnv">,
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  return profile.requiredEnv.filter((name) => !environment[name]);
}

export function assertRequiredEnvironment(
  profile: Pick<LoadedProfile, "id" | "requiredEnv">,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const missing = getMissingRequiredEnvironment(profile, environment);
  if (missing.length > 0) {
    throw new ProfileValidationError(
      `Profile "${profile.id}" is missing required environment variables: ${missing.join(", ")}`,
    );
  }
}

export function expandRuntimeArguments(
  args: string[],
  variables: Readonly<Record<string, string>>,
): string[] {
  return args.map((argument) =>
    argument.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_match, name: string) => {
      if (!RUNTIME_VARIABLES.has(name) || variables[name] === undefined) {
        throw new ProfileValidationError(
          `Command references unavailable runtime variable \${${name}}`,
        );
      }
      return variables[name];
    }),
  );
}

export function collectEnvironmentReferences(
  value: unknown,
  result = new Set<string>(),
): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectEnvironmentReferences(item, result);
    return result;
  }
  if (!isPlainObject(value)) return result;
  if (
    Object.keys(value).length === 1 &&
    typeof value[ENV_REF_KEY] === "string"
  ) {
    result.add(value[ENV_REF_KEY]);
    return result;
  }
  for (const child of Object.values(value)) {
    collectEnvironmentReferences(child, result);
  }
  return result;
}

function loadProfileModel(model: ProfileModelV2): LoadedProfileModel {
  const auth: LoadedProfileModelAuthentication =
    model.auth.source === "opencode"
      ? { source: "opencode" }
      : { source: "environment", apiKeyEnv: model.auth.api_key.env };
  return model.source === "opencode"
    ? { id: model.id, source: "opencode", auth }
    : {
        id: model.id,
        source: "profile",
        apiBaseEnv: model.api_base.env,
        auth,
      };
}

function validateProfileSemantics(
  profile: ProfileV2,
  profilePath: string,
): void {
  const skillIds = new Set<string>();
  for (const skill of profile.skills) {
    if (skillIds.has(skill.id)) {
      throw new ProfileValidationError(`Duplicate Skill id "${skill.id}"`, profilePath);
    }
    skillIds.add(skill.id);
  }
  for (const [label, command] of [
    ["agent", profile.agent],
    ...(profile.initializer ? [["initializer", profile.initializer] as const] : []),
  ] as Array<readonly [string, ProfileCommandV2]>) {
    for (const argument of command.args) {
      if (isCredentialShapedArgument(argument)) {
        throw new ProfileValidationError(
          `${label}.args must not embed credentials or credential-shaped flags`,
          profilePath,
        );
      }
      for (const match of argument.matchAll(/\$\{([^}]+)\}/g)) {
        if (!RUNTIME_VARIABLES.has(match[1])) {
          throw new ProfileValidationError(
            `${label}.args references unsupported runtime variable \${${match[1]}}`,
            profilePath,
          );
        }
      }
      if (argument.includes("${") && !/\$\{[A-Z_][A-Z0-9_]*\}/.test(argument)) {
        throw new ProfileValidationError(
          `${label}.args contains invalid runtime interpolation`,
          profilePath,
        );
      }
    }
  }
  for (const [field, value] of [
    ["opencode.config", profile.opencode.config],
    ...(profile.opencode.assets ?? []).map(
      (asset) => [`opencode.assets.${asset}`, asset] as const,
    ),
    ...profile.skills.map(
      (skill) => [`skills.${skill.id}.path`, skill.path] as const,
    ),
  ]) {
    ensureRelativePath(value, field, profilePath);
  }
}

function parseProfileYaml(profileText: string, profilePath: string): unknown {
  const document = parseDocument(profileText, {
    schema: "core",
    uniqueKeys: true,
    prettyErrors: false,
  });
  if (document.errors.length > 0 || document.warnings.length > 0) {
    throw new ProfileValidationError(
      `YAML parsing failed: ${[
        ...document.errors,
        ...document.warnings,
      ].map((error) => error.message).join("; ")}`,
      profilePath,
    );
  }
  try {
    return document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new ProfileValidationError(
      "YAML aliases are not allowed in Agent Profiles",
      profilePath,
      { cause: error },
    );
  }
}

function validateProfileObject(
  value: unknown,
  profilePath: string,
): asserts value is ProfileV2 {
  if (!validateProfile(value)) {
    throw new ProfileValidationError(
      `Profile schema validation failed: ${formatAjvErrors(validateProfile.errors)}`,
      profilePath,
    );
  }
}

async function resolveProfileFile(
  profileRoot: string,
  value: string,
  field: string,
  profilePath: string,
): Promise<string> {
  const candidate = resolveRelativePath(profileRoot, value, field, profilePath);
  assertPathInside(
    profileRoot,
    candidate,
    `${field} must remain inside its Profile package`,
    true,
  );
  await assertRegularFileWithoutSymlink(candidate, field);
  return realpath(candidate);
}

async function resolveProfileDirectory(
  profileRoot: string,
  value: string,
  field: string,
  profilePath: string,
): Promise<string> {
  const candidate = resolveRelativePath(profileRoot, value, field, profilePath);
  assertPathInside(
    profileRoot,
    candidate,
    `${field} must remain inside its Profile package`,
    true,
  );
  return canonicalDirectory(candidate, field);
}

function resolveRelativePath(
  profileRoot: string,
  value: string,
  field: string,
  profilePath: string,
): string {
  ensureRelativePath(value, field, profilePath);
  return path.resolve(profileRoot, value);
}

function ensureRelativePath(
  value: string,
  field: string,
  profilePath: string,
): void {
  if (path.isAbsolute(value) || path.win32.isAbsolute(value)) {
    throw new ProfileValidationError(
      `${field} must be relative to profile.yaml`,
      profilePath,
    );
  }
}

async function resolveCommand(
  command: string,
  profileRoot: string,
  profilePath: string,
): Promise<string> {
  const hasPathSeparator =
    command.includes("/") ||
    command.includes("\\") ||
    path.isAbsolute(command) ||
    path.win32.isAbsolute(command);
  if (hasPathSeparator) {
    if (path.isAbsolute(command) || path.win32.isAbsolute(command)) {
      throw new ProfileValidationError(
        "Profile command paths must be relative or resolved from PATH",
        profilePath,
      );
    }
    const candidate = path.resolve(profileRoot, command);
    assertPathInside(
      profileRoot,
      candidate,
      "Relative Profile command escapes the Profile package",
      true,
    );
    return assertExecutable(candidate, profilePath);
  }

  const pathEntries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];
  for (const entry of pathEntries) {
    for (const extension of extensions) {
      try {
        return await assertExecutable(
          path.join(entry, `${command}${extension}`),
          profilePath,
        );
      } catch {
        // Continue without exposing the server PATH.
      }
    }
  }
  throw new ProfileValidationError(
    `Profile command "${command}" was not found on PATH`,
    profilePath,
  );
}

async function assertExecutable(
  candidate: string,
  profilePath: string,
): Promise<string> {
  const resolved = await realpath(candidate).catch((error: unknown) => {
    throw new ProfileValidationError("Profile command does not exist", profilePath, {
      cause: error,
    });
  });
  await assertRegularFileWithoutSymlink(resolved, "Profile command");
  await access(
    resolved,
    process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK,
  );
  return resolved;
}

async function assertRegularFileWithoutSymlink(
  filePath: string,
  label: string,
): Promise<void> {
  let fileStats;
  try {
    fileStats = await lstat(filePath);
  } catch (error) {
    throw new ProfileValidationError(`${label} file does not exist`, filePath, {
      cause: error,
    });
  }
  if (fileStats.isSymbolicLink() || !fileStats.isFile()) {
    throw new ProfileValidationError(
      `${label} must be a regular non-symlink file`,
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
    throw new ProfileValidationError(`${label} does not exist`, absolute, {
      cause: error,
    });
  }
  if (entryStats.isSymbolicLink() || !entryStats.isDirectory()) {
    throw new ProfileValidationError(
      `${label} must be a non-symlink directory`,
      absolute,
    );
  }
  return realpath(absolute);
}

async function rejectProfileBuildArtifacts(profileRoot: string): Promise<void> {
  const rejectedNames = new Set([
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "__pycache__",
    "node_modules",
    "pyproject.toml",
    "uv.lock",
  ]);
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (
        rejectedNames.has(entry.name) ||
        entry.isFile() && /\.(?:pyc|pyo)$/.test(entry.name)
      ) {
        throw new ProfileValidationError(
          `Profile packages must contain source files only; found ${entry.name}`,
          path.join(directory, entry.name),
        );
      }
      if (entry.isDirectory()) await visit(path.join(directory, entry.name));
    }
  }
  await visit(profileRoot);
}

async function readTextFileLimited(
  filePath: string,
  maxBytes: number,
  label: string,
): Promise<string> {
  const fileStats = await stat(filePath);
  if (fileStats.size > maxBytes) {
    throw new ProfileValidationError(`${label} exceeds ${maxBytes} bytes`, filePath);
  }
  const contents = await readFile(filePath);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(contents);
  } catch (error) {
    throw new ProfileValidationError(`${label} is not valid UTF-8`, filePath, {
      cause: error,
    });
  }
}

function isCredentialShapedArgument(argument: string): boolean {
  return (
    /^--?(?:api[-_]?key|access[-_]?token|token|secret|password|passwd|authorization|credential)(?:$|[=:])/i.test(
      argument,
    ) ||
    /(?:^|[=:_-])(?:api[-_]?key|access[-_]?token|token|secret|password|passwd|authorization|credential)(?:=|:)/i.test(
      argument,
    )
  );
}

function portableRelative(root: string, filePath: string): string {
  assertPathInside(root, filePath, "Profile asset escapes its config directory");
  return path.relative(root, filePath).split(path.sep).join("/");
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return "unknown schema error";
  return errors
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join("; ");
}

function normalizedPathKey(value: string): string {
  return process.platform === "win32" ? value.toLocaleLowerCase() : value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
