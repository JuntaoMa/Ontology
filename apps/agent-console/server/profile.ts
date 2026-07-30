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
import { PROFILE_V1_SCHEMA } from "./profile-schema.js";

const MAX_PROFILE_BYTES = 64 * 1024;
const MAX_CATALOG_PROFILES = 256;
const PROFILE_FILENAMES = new Set(["profile.yaml", "profile.yml"]);
const ENV_REF_KEY = "env";

export interface EnvReference {
  env: string;
}

export type ProfileModelAuthenticationV1 =
  | {
      source: "opencode";
    }
  | {
      source: "environment";
      api_key: EnvReference;
    };

export type ProfileModelV1 =
  | {
      id: string;
      source: "opencode";
      auth: ProfileModelAuthenticationV1;
    }
  | {
      id: string;
      source: "profile";
      api_base: EnvReference;
      auth: ProfileModelAuthenticationV1;
    };

export interface ProfileV1 {
  schema_version: 1;
  id: string;
  revision: string;
  title: string;
  description: string;
  runtime: {
    command: string;
    args: string[];
    cwd: string;
    startup_timeout_ms: number;
  };
  opencode: {
    config: string;
    assets?: string[];
  };
  model: ProfileModelV1;
  skills: Array<{
    id: string;
    path: string;
  }>;
  retrieval?: {
    endpoint: EnvReference;
    vector_top_k: number;
    graph_algorithm: "minimum_connected_subgraph";
  };
  ontology: {
    id: string;
    sha256?: string;
  };
}

export interface LoadedProfile {
  id: string;
  revision: string;
  title: string;
  description: string;
  profilePath: string;
  runtime: {
    command: string;
    args: string[];
    cwd: string;
    stateDir: string;
    startupTimeoutMs: number;
  };
  configPath: string;
  configAssets: Array<{
    path: string;
    relativePath: string;
  }>;
  skills: Array<{
    id: string;
    path: string;
  }>;
  skillsRoot?: string;
  requiredEnv: string[];
  model: LoadedProfileModel;
  retrieval?: {
    endpointEnv: string;
    vectorTopK: number;
    graphAlgorithm: "minimum_connected_subgraph";
  };
  ontology: {
    id: string;
    sha256?: string;
  };
}

export type LoadedProfileModelAuthentication =
  | {
      source: "opencode";
    }
  | {
      source: "environment";
      apiKeyEnv: string;
    };

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

export interface PublicAgent {
  id: string;
  revision: string;
  title: string;
  description: string;
  status: string;
  ws_url: string;
  cwd: string;
  model: {
    id: string;
    source: "opencode" | "profile";
  };
  retrieval?: {
    vector_top_k: number;
    graph_algorithm: string;
  };
  ontology: {
    id: string;
  };
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
ajv.addSchema(PROFILE_V1_SCHEMA);
const validateProfile = ajv.getSchema(PROFILE_V1_SCHEMA.$id) as ValidateFunction;

/**
 * Load every profile below a trusted server-side catalog root.
 *
 * Declarations are validated here, while environment values are checked when
 * a profile is started. One unavailable profile therefore does not prevent the
 * rest of the catalog from loading.
 */
export async function loadProfileCatalog(profilesRoot: string): Promise<LoadedProfile[]> {
  const root = await realpath(path.resolve(profilesRoot));
  const rootStats = await stat(root);
  if (!rootStats.isDirectory()) {
    throw new ProfileValidationError("Profile catalog root is not a directory", root);
  }

  const profilePaths = await discoverProfileFiles(root);
  const profiles = await Promise.all(
    profilePaths.map((profilePath) => loadProfile(profilePath, root)),
  );

  const ids = new Map<string, string>();
  for (const profile of profiles) {
    const duplicateId = ids.get(profile.id);
    if (duplicateId) {
      throw new ProfileValidationError(
        `Duplicate profile id "${profile.id}" also declared by ${duplicateId}`,
        profile.profilePath,
      );
    }
    ids.set(profile.id, profile.profilePath);
  }

  return profiles.sort((left, right) => left.id.localeCompare(right.id));
}

export async function loadProfile(
  profilePath: string,
  profilesRoot: string,
): Promise<LoadedProfile> {
  const root = await realpath(path.resolve(profilesRoot));
  const rootStats = await stat(root);
  if (!rootStats.isDirectory()) {
    throw new ProfileValidationError("Profile catalog root is not a directory", root);
  }

  const requestedProfilePath = path.resolve(profilePath);
  await assertRegularFileWithoutSymlink(requestedProfilePath, "Profile");
  const absoluteProfilePath = await realpath(requestedProfilePath);
  assertPathInside(root, absoluteProfilePath, "Profile file must be inside the catalog root");

  const profileText = await readTextFileLimited(
    absoluteProfilePath,
    MAX_PROFILE_BYTES,
    "Profile",
  );
  const source = parseProfileYaml(profileText, absoluteProfilePath);
  validateProfileObject(source, absoluteProfilePath);
  validateProfileSemantics(source, absoluteProfilePath);

  const profileDirectory = await realpath(path.dirname(absoluteProfilePath));
  const projectRoot = await realpath(path.dirname(root));

  const cwd = await resolveExistingDirectory(
    profileDirectory,
    source.runtime.cwd,
    "runtime.cwd",
    absoluteProfilePath,
  );
  assertPathInside(
    projectRoot,
    cwd,
    "runtime.cwd must remain inside the Profile project root",
  );

  const configPath = await resolveExistingFile(
    profileDirectory,
    source.opencode.config,
    "opencode.config",
    absoluteProfilePath,
  );
  assertPathInside(
    root,
    configPath,
    "opencode.config must remain inside the Profile catalog",
  );
  const configDir = await realpath(path.dirname(configPath));
  const configAssets: LoadedProfile["configAssets"] = [];
  const configAssetPaths = new Set<string>();
  for (const asset of source.opencode.assets ?? []) {
    const assetPath = await resolveExistingFile(
      profileDirectory,
      asset,
      `opencode.assets.${asset}`,
      absoluteProfilePath,
    );
    assertPathInside(
      configDir,
      assetPath,
      "opencode.assets files must be children of the OpenCode config directory",
      true,
    );
    const relativePath = toPortableRelativePath(configDir, assetPath);
    const normalizedRelativePath = normalizedPathKey(relativePath);
    if (configAssetPaths.has(normalizedRelativePath)) {
      throw new ProfileValidationError(
        `Duplicate OpenCode asset destination "${relativePath}"`,
        absoluteProfilePath,
      );
    }
    if (normalizedPathKey(path.basename(configPath)) === normalizedRelativePath) {
      throw new ProfileValidationError(
        "opencode.assets must not repeat the declared config file",
        absoluteProfilePath,
      );
    }
    configAssetPaths.add(normalizedRelativePath);
    configAssets.push({ path: assetPath, relativePath });
  }
  configAssets.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );

  const command = await resolveCommand(
    source.runtime.command,
    profileDirectory,
    absoluteProfilePath,
  );

  const stateRoot = path.join(projectRoot, ".runtime", "opencode");
  const stateDir = path.join(stateRoot, source.id);
  assertPathInside(
    stateRoot,
    stateDir,
    `Derived runtime state directory must be a child of ${stateRoot}`,
    true,
  );
  await rejectExistingSymlinkSegments(projectRoot, stateDir, absoluteProfilePath);

  const skills: LoadedProfile["skills"] = [];
  let skillsRoot: string | undefined;
  for (const skill of source.skills) {
    const skillPath = await resolveExistingDirectory(
      profileDirectory,
      skill.path,
      `skills.${skill.id}.path`,
      absoluteProfilePath,
    );
    await assertRegularFileWithoutSymlink(
      path.join(skillPath, "SKILL.md"),
      `Skill "${skill.id}" SKILL.md`,
    );
    assertPathInside(
      root,
      skillPath,
      `Skill "${skill.id}" must be inside the Profile catalog`,
    );
    const skillParent = await realpath(path.dirname(skillPath));
    if (
      skillsRoot !== undefined &&
      normalizedPathKey(skillsRoot) !== normalizedPathKey(skillParent)
    ) {
      throw new ProfileValidationError(
        "All declared Skill directories must share the same parent directory",
        absoluteProfilePath,
      );
    }
    skillsRoot = skillParent;
    skills.push({ id: skill.id, path: skillPath });
  }

  return {
    id: source.id,
    revision: source.revision,
    title: source.title,
    description: source.description,
    profilePath: absoluteProfilePath,
    runtime: {
      command,
      args: [...source.runtime.args],
      cwd,
      stateDir,
      startupTimeoutMs: source.runtime.startup_timeout_ms,
    },
    configPath,
    configAssets,
    skills,
    ...(skillsRoot !== undefined ? { skillsRoot } : {}),
    requiredEnv: [...collectEnvironmentReferences(source)].sort(),
    model: loadProfileModel(source.model),
    ...(source.retrieval
      ? {
          retrieval: {
            endpointEnv: source.retrieval.endpoint.env,
            vectorTopK: source.retrieval.vector_top_k,
            graphAlgorithm: source.retrieval.graph_algorithm,
          },
        }
      : {}),
    ontology: {
      id: source.ontology.id,
      sha256: source.ontology.sha256,
    },
  };
}

function loadProfileModel(model: ProfileModelV1): LoadedProfileModel {
  const auth: LoadedProfileModelAuthentication =
    model.auth.source === "opencode"
      ? { source: "opencode" }
      : {
          source: "environment",
          apiKeyEnv: model.auth.api_key.env,
        };
  if (model.source === "opencode") {
    return {
      id: model.id,
      source: "opencode",
      auth,
    };
  }
  return {
    id: model.id,
    source: "profile",
    apiBaseEnv: model.api_base.env,
    auth,
  };
}

export function toPublicAgent(profile: LoadedProfile, status: string): PublicAgent {
  return {
    id: profile.id,
    revision: profile.revision,
    title: profile.title,
    description: profile.description,
    status,
    ws_url: `/agents/${profile.id}/acp`,
    cwd: profile.runtime.cwd,
    model: {
      id: profile.model.id,
      source: profile.model.source,
    },
    ...(profile.retrieval
      ? {
          retrieval: {
            vector_top_k: profile.retrieval.vectorTopK,
            graph_algorithm: profile.retrieval.graphAlgorithm,
          },
        }
      : {}),
    ontology: {
      id: profile.ontology.id,
    },
  };
}

export function getMissingRequiredEnvironment(
  profile: Pick<LoadedProfile, "requiredEnv">,
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  return profile.requiredEnv.filter((name) => {
    const value = environment[name];
    return value === undefined || value.length === 0;
  });
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

function parseProfileYaml(profileText: string, profilePath: string): unknown {
  const document = parseDocument(profileText, {
    schema: "core",
    uniqueKeys: true,
    prettyErrors: false,
  });
  if (document.errors.length > 0) {
    throw new ProfileValidationError(
      `YAML parsing failed: ${document.errors.map((error) => error.message).join("; ")}`,
      profilePath,
    );
  }
  if (document.warnings.length > 0) {
    throw new ProfileValidationError(
      `YAML warning treated as an error: ${document.warnings
        .map((warning) => warning.message)
        .join("; ")}`,
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

function validateProfileObject(value: unknown, profilePath: string): asserts value is ProfileV1 {
  if (!validateProfile(value)) {
    throw new ProfileValidationError(
      `Profile schema validation failed: ${formatAjvErrors(validateProfile.errors)}`,
      profilePath,
    );
  }
}

function validateProfileSemantics(profile: ProfileV1, profilePath: string): void {
  const skillIds = new Set<string>();
  for (const skill of profile.skills) {
    if (skillIds.has(skill.id)) {
      throw new ProfileValidationError(
        `Duplicate Skill id "${skill.id}"`,
        profilePath,
      );
    }
    skillIds.add(skill.id);
  }

  for (const argument of profile.runtime.args) {
    if (
      /^--?(?:api[-_]?key|access[-_]?token|token|secret|password|passwd|authorization|credential)(?:$|[=:])/i.test(
        argument,
      ) ||
      /(?:^|[=:_-])(?:api[-_]?key|access[-_]?token|token|secret|password|passwd|authorization|credential)(?:=|:)/i.test(
        argument,
      )
    ) {
      throw new ProfileValidationError(
        "runtime.args must not embed credentials or credential-shaped flags",
        profilePath,
      );
    }
  }

  for (const [field, value] of [
    ["runtime.cwd", profile.runtime.cwd],
    ["opencode.config", profile.opencode.config],
    ...(profile.opencode.assets ?? []).map((asset) => [
      `opencode.assets.${asset}`,
      asset,
    ]),
    ...profile.skills.map((skill) => [`skills.${skill.id}.path`, skill.path]),
  ]) {
    ensureRelativePath(value, field, profilePath);
  }
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ensureRelativePath(value: string, field: string, profilePath: string): void {
  if (path.isAbsolute(value) || path.win32.isAbsolute(value)) {
    throw new ProfileValidationError(`${field} must be relative to profile.yaml`, profilePath);
  }
}

function resolveRelativePath(
  profileDirectory: string,
  value: string,
  field: string,
  profilePath: string,
): string {
  ensureRelativePath(value, field, profilePath);
  return path.resolve(profileDirectory, value);
}

async function resolveExistingDirectory(
  profileDirectory: string,
  value: string,
  field: string,
  profilePath: string,
): Promise<string> {
  const candidate = resolveRelativePath(profileDirectory, value, field, profilePath);
  const resolved = await realpath(candidate).catch((error: unknown) => {
    throw new ProfileValidationError(`${field} does not exist`, profilePath, {
      cause: error,
    });
  });
  const fileStats = await stat(resolved);
  if (!fileStats.isDirectory()) {
    throw new ProfileValidationError(`${field} is not a directory`, profilePath);
  }
  return resolved;
}

async function resolveExistingFile(
  profileDirectory: string,
  value: string,
  field: string,
  profilePath: string,
): Promise<string> {
  const candidate = resolveRelativePath(profileDirectory, value, field, profilePath);
  await assertRegularFileWithoutSymlink(candidate, field);
  return realpath(candidate);
}

async function resolveCommand(
  command: string,
  profileDirectory: string,
  profilePath: string,
): Promise<string> {
  const hasPathSeparator =
    command.includes("/") ||
    command.includes("\\") ||
    path.isAbsolute(command) ||
    path.win32.isAbsolute(command);
  if (hasPathSeparator) {
    const candidate =
      path.isAbsolute(command) || path.win32.isAbsolute(command)
        ? path.resolve(command)
        : path.resolve(profileDirectory, command);
    return assertExecutable(candidate, profilePath);
  }

  const pathEntries = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];
  for (const entry of pathEntries) {
    for (const extension of extensions) {
      const candidate = path.join(entry, `${command}${extension}`);
      try {
        return await assertExecutable(candidate, profilePath);
      } catch {
        // Continue searching PATH. The final error intentionally does not
        // reveal the complete server PATH.
      }
    }
  }
  throw new ProfileValidationError(
    `runtime.command "${command}" was not found on PATH`,
    profilePath,
  );
}

async function assertExecutable(candidate: string, profilePath: string): Promise<string> {
  const resolved = await realpath(candidate).catch((error: unknown) => {
    throw new ProfileValidationError("runtime.command does not exist", profilePath, {
      cause: error,
    });
  });
  await assertRegularFileWithoutSymlink(resolved, "runtime.command");
  await access(
    resolved,
    process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK,
  );
  return resolved;
}

async function discoverProfileFiles(root: string): Promise<string[]> {
  const result: string[] = [];

  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > 4) {
      throw new ProfileValidationError("Profile catalog nesting exceeds four levels", directory);
    }
    const entries = await readdir(directory, { withFileTypes: true });
    const profileFiles = entries.filter(
      (entry) => entry.isFile() && PROFILE_FILENAMES.has(entry.name),
    );
    if (profileFiles.length > 1) {
      throw new ProfileValidationError(
        "A profile directory cannot contain both profile.yaml and profile.yml",
        directory,
      );
    }
    if (profileFiles.length === 1) {
      result.push(path.join(directory, profileFiles[0].name));
      if (result.length > MAX_CATALOG_PROFILES) {
        throw new ProfileValidationError(
          `Profile catalog exceeds ${MAX_CATALOG_PROFILES} profiles`,
          root,
        );
      }
      return;
    }

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      // Underscore-prefixed directories hold shared catalog resources (for
      // example `_shared/skills`) and can contain arbitrary implementation
      // depth. Profile ids cannot begin with an underscore.
      if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
      if (entry.isSymbolicLink()) {
        throw new ProfileValidationError(
          "Profile catalog must not contain symbolic links",
          path.join(directory, entry.name),
        );
      }
      if (entry.isDirectory()) {
        await visit(path.join(directory, entry.name), depth + 1);
      }
    }
  }

  await visit(root, 0);
  return result.sort();
}

async function rejectExistingSymlinkSegments(
  boundary: string,
  target: string,
  profilePath: string,
): Promise<void> {
  assertPathInside(boundary, target, "Runtime state path escapes project root");
  const relative = path.relative(boundary, target);
  let current = boundary;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const entryStats = await lstat(current);
      if (entryStats.isSymbolicLink()) {
        throw new ProfileValidationError(
          `Derived runtime state directory crosses symbolic link ${current}`,
          profilePath,
        );
      }
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return;
      throw error;
    }
  }
}

function assertPathInside(
  boundary: string,
  candidate: string,
  message: string,
  requireChild = false,
): void {
  const relative = path.relative(path.resolve(boundary), path.resolve(candidate));
  const outside =
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative);
  if (outside || (requireChild && relative.length === 0)) {
    throw new ProfileValidationError(message, candidate);
  }
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
    throw new ProfileValidationError(`${label} must be a regular non-symlink file`, filePath);
  }
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

function toPortableRelativePath(root: string, filePath: string): string {
  const relative = path.relative(root, filePath);
  assertPathInside(root, filePath, "Profile file escapes its declared root");
  return relative.split(path.sep).join("/");
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
