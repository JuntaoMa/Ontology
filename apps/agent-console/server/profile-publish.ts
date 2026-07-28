import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { isIP } from "node:net";
import { stringify } from "yaml";
import {
  loadProfile,
  ProfileValidationError,
  sha256File,
  type LoadedProfile,
  type ProfileLockV1,
  type ProfileV1,
} from "./profile.js";

const PROFILE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REVISION_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 128;

const ALLOWED_EXTENSIONS = new Set([
  ".bash",
  ".cjs",
  ".js",
  ".json",
  ".jsonc",
  ".md",
  ".mjs",
  ".py",
  ".sh",
  ".toml",
  ".ts",
  ".txt",
  ".yaml",
  ".yml",
]);

const FORBIDDEN_EXTENSIONS = new Set([
  ".bin",
  ".db",
  ".db-shm",
  ".db-wal",
  ".gguf",
  ".gz",
  ".lance",
  ".nq",
  ".nt",
  ".onnx",
  ".owl",
  ".parquet",
  ".pdf",
  ".pt",
  ".pth",
  ".rdf",
  ".safetensors",
  ".tar",
  ".trig",
  ".ttl",
  ".whl",
  ".zip",
]);

const FORBIDDEN_PATH_SEGMENTS = new Set([
  ".git",
  ".venv",
  "artifacts",
  "data",
  "datasets",
  "models",
  "node_modules",
  "sources",
  "state",
  "vendor",
  "weights",
]);

export interface PublishProfileOptions {
  sourceProfilePath: string;
  profilesRoot?: string;
  releaseId: string;
  revision?: string;
  ontologySha256?: string;
  createdAt?: Date;
}

export interface PublishedProfile {
  bundlePath: string;
  profile: LoadedProfile;
  lock: ProfileLockV1;
}

interface PublishBudget {
  files: number;
  bytes: number;
}

export async function publishProfile(
  options: PublishProfileOptions,
): Promise<PublishedProfile> {
  validateReleaseIdentifier(options.releaseId, "releaseId", PROFILE_ID_PATTERN);
  const revision = options.revision ?? options.releaseId;
  validateReleaseIdentifier(revision, "revision", REVISION_PATTERN);

  const sourceProfilePath = path.resolve(options.sourceProfilePath);
  const profilesRoot = options.profilesRoot
    ? await resolveExistingDirectory(options.profilesRoot, "profilesRoot")
    : await discoverProfilesRoot(sourceProfilePath);
  const source = await loadProfile(sourceProfilePath, profilesRoot);
  if (!source.mutable) {
    throw new ProfileValidationError(
      "Only a mutable source profile can be published as a new immutable revision",
      sourceProfilePath,
    );
  }
  if (options.releaseId === source.id) {
    throw new ProfileValidationError(
      "Published Profile id must differ from the mutable source id",
      sourceProfilePath,
    );
  }

  const ontologySha256 = options.ontologySha256 ?? source.ontology.sha256;
  if (!ontologySha256 || !SHA256_PATTERN.test(ontologySha256)) {
    throw new ProfileValidationError(
      "Publishing requires a lowercase 64-character ontology SHA-256 digest",
      sourceProfilePath,
    );
  }

  const releasesRoot = await resolveReleasesRoot(profilesRoot);
  const target = path.join(releasesRoot, options.releaseId);
  await assertTargetDoesNotExist(target);

  const sourceBundleRoot = path.dirname(source.profilePath);
  assertStrictChild(
    sourceBundleRoot,
    source.runtime.configDir,
    "opencode.config must live in a dedicated directory below the source profile",
  );
  for (const skill of source.skills) {
    assertStrictChild(
      sourceBundleRoot,
      skill.path,
      `Skill "${skill.id}" must live below the source profile directory`,
    );
  }

  const staging = await mkdtemp(path.join(releasesRoot, `.publish-${options.releaseId}-`));
  let published = false;
  try {
    const budget: PublishBudget = { files: 0, bytes: 0 };
    const destinationConfigDir = path.join(staging, "opencode");
    await mkdir(destinationConfigDir, { recursive: true, mode: 0o755 });
    await copyPublishableFile(
      source.configPath,
      path.join(destinationConfigDir, path.basename(source.configPath)),
      "OpenCode configuration",
      budget,
    );

    for (const skill of source.skills) {
      await copyPublishableTree(
        skill.path,
        path.join(staging, "skills", skill.id),
        `Skill "${skill.id}"`,
        budget,
      );
    }

    const destinationProfilePath = path.join(staging, "profile.yaml");
    const finalProfileDirectory = target;
    const projectRoot = path.dirname(profilesRoot);
    const immutableStateDirectory = path.join(
      projectRoot,
      ".runtime",
      "opencode",
      options.releaseId,
    );
    const configRelativePath = toPortablePath(
      path.join("opencode", path.basename(source.configPath)),
    );

    const immutableProfile = structuredClone(source.source) as ProfileV1;
    immutableProfile.id = options.releaseId;
    immutableProfile.revision = revision;
    immutableProfile.mutable = false;
    immutableProfile.runtime.cwd = portableRelativePath(
      finalProfileDirectory,
      source.runtime.cwd,
    );
    immutableProfile.runtime.state_dir = portableRelativePath(
      finalProfileDirectory,
      immutableStateDirectory,
    );
    immutableProfile.opencode.config = configRelativePath;
    immutableProfile.skills = source.skills.map((skill) => ({
      id: skill.id,
      path: toPortablePath(path.join("skills", skill.id)),
    }));
    immutableProfile.ontology.sha256 = ontologySha256;

    const profileText = stringify(immutableProfile, {
      lineWidth: 0,
      sortMapEntries: false,
    });
    assertNoSensitiveText(profileText, "profile.yaml");
    await writeFile(destinationProfilePath, profileText, {
      encoding: "utf8",
      mode: 0o644,
      flag: "wx",
    });
    budget.files += 1;
    budget.bytes += Buffer.byteLength(profileText);
    assertWithinBudget(budget, destinationProfilePath);

    const bundleFiles = await listFiles(staging);
    const files = [];
    for (const filePath of bundleFiles) {
      const relativePath = toPortablePath(path.relative(staging, filePath));
      await assertPublishableFile(filePath, relativePath);
      const fileStats = await stat(filePath);
      files.push({
        path: relativePath,
        sha256: await sha256File(filePath),
        size: fileStats.size,
      });
    }
    files.sort((left, right) => left.path.localeCompare(right.path));

    const lock: ProfileLockV1 = {
      schema_version: 1,
      profile_id: options.releaseId,
      profile_revision: revision,
      created_at: (options.createdAt ?? new Date()).toISOString(),
      files,
      external_inputs: {
        ontology: {
          id: immutableProfile.ontology.id,
          sha256: ontologySha256,
        },
      },
    };
    await writeFile(
      path.join(staging, "profile.lock.json"),
      `${JSON.stringify(lock, null, 2)}\n`,
      { encoding: "utf8", mode: 0o644, flag: "wx" },
    );

    await rename(staging, target);
    published = true;
    try {
      const profile = await loadProfile(path.join(target, "profile.yaml"), profilesRoot);
      return { bundlePath: target, profile, lock };
    } catch (error) {
      await rm(target, { recursive: true, force: true });
      throw error;
    }
  } finally {
    if (!published) {
      await rm(staging, { recursive: true, force: true });
    }
  }
}

export async function assertPublishableFile(
  filePath: string,
  relativePath = path.basename(filePath),
): Promise<void> {
  const portablePath = toPortablePath(relativePath);
  const segments = portablePath.split("/").filter(Boolean);
  for (const segment of segments) {
    const normalized = segment.toLocaleLowerCase();
    if (
      FORBIDDEN_PATH_SEGMENTS.has(normalized) ||
      /(?:^|[._-])(?:credential|private[-_]?key|secret|token|password|passwd)(?:[._-]|$)/i.test(
        normalized,
      ) ||
      normalized === ".env" ||
      normalized.startsWith(".env.")
    ) {
      throw new ProfileValidationError(
        `Sensitive or runtime-data path is not publishable: ${portablePath}`,
        filePath,
      );
    }
  }

  const extension = path.extname(filePath).toLocaleLowerCase();
  if (FORBIDDEN_EXTENSIONS.has(extension) || !ALLOWED_EXTENSIONS.has(extension)) {
    throw new ProfileValidationError(
      `File type is not allowed in a Profile bundle: ${portablePath}`,
      filePath,
    );
  }

  const fileStats = await lstat(filePath);
  if (fileStats.isSymbolicLink() || !fileStats.isFile()) {
    throw new ProfileValidationError(
      `Profile bundles only accept regular non-symlink files: ${portablePath}`,
      filePath,
    );
  }
  if (fileStats.size > MAX_FILE_BYTES) {
    throw new ProfileValidationError(
      `Profile bundle file exceeds ${MAX_FILE_BYTES} bytes: ${portablePath}`,
      filePath,
    );
  }

  const contents = await readFile(filePath);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(contents);
  } catch (error) {
    throw new ProfileValidationError(
      `Binary content is not allowed in a Profile bundle: ${portablePath}`,
      filePath,
      { cause: error },
    );
  }
  assertNoSensitiveText(text, portablePath);
}

export function assertNoSensitiveText(text: string, label: string): void {
  if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(text)) {
    throw new ProfileValidationError(`Private key material detected in ${label}`);
  }
  if (
    /\b(?:sk|rk|pk)-(?:live|test|proj)?-?[A-Za-z0-9_-]{16,}\b/.test(text) ||
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/.test(text) ||
    /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/.test(text)
  ) {
    throw new ProfileValidationError(`Credential-shaped token detected in ${label}`);
  }

  const assignment =
    /(?:api[-_]?key|access[-_]?token|auth(?:orization)?|credential|password|passwd|secret|token)["']?[ \t]*[:=][ \t]*["']?([^"',}\s]+)/gi;
  for (const match of text.matchAll(assignment)) {
    const value = match[1] ?? "";
    if (isSafeReferenceValue(value)) continue;
    throw new ProfileValidationError(
      `Credential value must be an environment reference in ${label}`,
    );
  }

  const bearer = /\bBearer[ \t]+([^\s"',}]+)/gi;
  for (const match of text.matchAll(bearer)) {
    const value = match[1] ?? "";
    if (isSafeReferenceValue(value)) continue;
    throw new ProfileValidationError(`Bearer credential detected in ${label}`);
  }

  // Keep `]` in the candidate so bracketed IPv6 hosts reach URL parsing.
  // A JSON/Markdown closing bracket may remain in the path, but does not
  // affect hostname classification.
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>"')}]+/gi)) {
    const rawUrl = match[0].replace(/[.,;:]$/, "");
    let hostname: string;
    try {
      hostname = new URL(rawUrl).hostname.toLocaleLowerCase();
    } catch {
      continue;
    }
    if (isPrivateHostname(hostname)) {
      throw new ProfileValidationError(`Private network address detected in ${label}`);
    }
  }
}

async function copyPublishableTree(
  source: string,
  destination: string,
  label: string,
  budget: PublishBudget,
): Promise<void> {
  const sourceStats = await lstat(source);
  if (sourceStats.isSymbolicLink() || !sourceStats.isDirectory()) {
    throw new ProfileValidationError(`${label} must be a non-symlink directory`, source);
  }
  await mkdir(destination, { recursive: true, mode: 0o755 });

  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    const relativeDestination = path.relative(path.dirname(destination), destinationPath);
    if (entry.isSymbolicLink()) {
      throw new ProfileValidationError(
        `${label} contains a symbolic link, which cannot be published`,
        sourcePath,
      );
    }
    if (entry.isDirectory()) {
      await copyPublishableTree(
        sourcePath,
        destinationPath,
        label,
        budget,
      );
      continue;
    }
    if (!entry.isFile()) {
      throw new ProfileValidationError(
        `${label} contains a non-regular file`,
        sourcePath,
      );
    }

    await copyPublishableFile(
      sourcePath,
      destinationPath,
      relativeDestination,
      budget,
    );
  }
}

async function copyPublishableFile(
  source: string,
  destination: string,
  label: string,
  budget: PublishBudget,
): Promise<void> {
  await assertPublishableFile(source, label);
  const fileStats = await stat(source);
  budget.files += 1;
  budget.bytes += fileStats.size;
  assertWithinBudget(budget, source);
  await copyFile(source, destination);
  await chmod(destination, fileStats.mode & 0o755);
}

function assertWithinBudget(budget: PublishBudget, filePath: string): void {
  if (budget.files > MAX_FILES) {
    throw new ProfileValidationError(
      `Profile bundle exceeds ${MAX_FILES} files`,
      filePath,
    );
  }
  if (budget.bytes > MAX_TOTAL_BYTES) {
    throw new ProfileValidationError(
      `Profile bundle exceeds ${MAX_TOTAL_BYTES} bytes`,
      filePath,
    );
  }
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new ProfileValidationError(
          "Profile publication staging contains a symbolic link",
          entryPath,
        );
      }
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      } else {
        throw new ProfileValidationError(
          "Profile publication staging contains a non-regular file",
          entryPath,
        );
      }
    }
  }
  await visit(root);
  return files;
}

function isSafeReferenceValue(value: string): boolean {
  return (
    value.length === 0 ||
    value.startsWith("{env:") ||
    value.startsWith("${") ||
    value.startsWith("$") ||
    value.startsWith("process.env") ||
    value.startsWith("os.environ") ||
    value === "replace-me" ||
    value === "example"
  );
}

function isPrivateHostname(hostname: string): boolean {
  const normalizedHostname =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  if (
    normalizedHostname === "example.com" ||
    normalizedHostname.endsWith(".example.com")
  ) {
    return false;
  }
  if (
    normalizedHostname === "localhost" ||
    normalizedHostname.endsWith(".localhost") ||
    normalizedHostname.endsWith(".local") ||
    normalizedHostname.endsWith(".localdomain") ||
    normalizedHostname.endsWith(".lan") ||
    normalizedHostname.endsWith(".internal") ||
    normalizedHostname.endsWith(".corp") ||
    normalizedHostname.endsWith(".intranet")
  ) {
    return true;
  }

  // Literal addresses are never portable Profile configuration. Keep them in
  // an environment reference even when the address happens to be public.
  return isIP(normalizedHostname) !== 0;
}

async function discoverProfilesRoot(profilePath: string): Promise<string> {
  let current = path.dirname(profilePath);
  while (true) {
    if (path.basename(current) === "profiles") {
      return resolveExistingDirectory(current, "profilesRoot");
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new ProfileValidationError(
    "Could not infer profilesRoot; pass profilesRoot explicitly",
    profilePath,
  );
}

async function resolveExistingDirectory(value: string, label: string): Promise<string> {
  const resolved = path.resolve(value);
  const valueStats = await stat(resolved).catch((error: unknown) => {
    throw new ProfileValidationError(`${label} does not exist`, resolved, {
      cause: error,
    });
  });
  if (!valueStats.isDirectory()) {
    throw new ProfileValidationError(`${label} is not a directory`, resolved);
  }
  return realpath(resolved);
}

async function resolveReleasesRoot(profilesRoot: string): Promise<string> {
  const expectedRoot = path.join(profilesRoot, "releases");
  let existingStats: Awaited<ReturnType<typeof lstat>> | undefined;

  try {
    existingStats = await lstat(expectedRoot);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  if (existingStats) {
    assertReleasesRootDirectory(existingStats, expectedRoot);
  } else {
    await mkdir(expectedRoot, { mode: 0o755 });
  }

  // Re-check after creation to close the simple lstat/mkdir race and reject a
  // path that was replaced with a symlink before canonicalization.
  const finalStats = await lstat(expectedRoot).catch((error: unknown) => {
    throw new ProfileValidationError(
      "releasesRoot does not exist after creation",
      expectedRoot,
      { cause: error },
    );
  });
  assertReleasesRootDirectory(finalStats, expectedRoot);

  const canonicalRoot = await realpath(expectedRoot);
  const relative = path.relative(profilesRoot, canonicalRoot);
  if (
    relative !== "releases" ||
    path.dirname(canonicalRoot) !== profilesRoot
  ) {
    throw new ProfileValidationError(
      "releasesRoot must resolve to the expected direct child of profilesRoot",
      expectedRoot,
    );
  }

  return canonicalRoot;
}

function assertReleasesRootDirectory(
  rootStats: Awaited<ReturnType<typeof lstat>>,
  releasesRoot: string,
): void {
  if (rootStats.isSymbolicLink()) {
    throw new ProfileValidationError(
      "releasesRoot must not be a symbolic link",
      releasesRoot,
    );
  }
  if (!rootStats.isDirectory()) {
    throw new ProfileValidationError(
      "releasesRoot is not a directory",
      releasesRoot,
    );
  }
}

async function assertTargetDoesNotExist(target: string): Promise<void> {
  try {
    await lstat(target);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
  throw new ProfileValidationError(
    "Published Profile target already exists; releases are immutable",
    target,
  );
}

function assertStrictChild(boundary: string, candidate: string, message: string): void {
  const relative = path.relative(boundary, candidate);
  if (
    relative.length === 0 ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new ProfileValidationError(message, candidate);
  }
}

function portableRelativePath(from: string, to: string): string {
  const relative = path.relative(from, to);
  return toPortablePath(relative || ".");
}

function toPortablePath(value: string): string {
  return value.split(path.sep).join("/");
}

function validateReleaseIdentifier(
  value: string,
  label: string,
  pattern: RegExp,
): void {
  if (value.length > 64 || !pattern.test(value)) {
    throw new ProfileValidationError(`${label} has an invalid format`);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
