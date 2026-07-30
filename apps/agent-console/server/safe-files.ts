import { createHash, randomBytes } from "node:crypto";
import {
  constants as fsConstants,
  createReadStream,
  createWriteStream,
} from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const DEFAULT_MAX_FILES = 50_000;
const DEFAULT_MAX_TOTAL_BYTES = 20 * 1024 * 1024 * 1024;
const DEFAULT_MAX_FILE_BYTES = 4 * 1024 * 1024 * 1024;
const DEFAULT_MAX_DEPTH = 48;

export interface TreeLimits {
  maxFiles?: number;
  maxTotalBytes?: number;
  maxFileBytes?: number;
  maxDepth?: number;
}

export interface TreeSummary {
  files: number;
  bytes: number;
  sha256: string;
}

export class UnsafePathError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "UnsafePathError";
  }
}

interface ResolvedLimits {
  maxFiles: number;
  maxTotalBytes: number;
  maxFileBytes: number;
  maxDepth: number;
}

/**
 * Validate and hash a directory without following symbolic links.
 *
 * The digest includes entry type, portable relative path, file length and file
 * bytes. It is therefore stable across machines while detecting renames and
 * empty directories.
 */
export async function inspectTree(
  root: string,
  limits: TreeLimits = {},
  signal?: AbortSignal,
): Promise<TreeSummary> {
  throwIfAborted(signal);
  const resolvedRoot = path.resolve(root);
  await assertDirectoryNoSymlink(resolvedRoot, "Snapshot root");
  const state = {
    files: 0,
    bytes: 0,
    hash: createHash("sha256"),
    limits: resolveLimits(limits),
    signal,
  };
  await visitTree(resolvedRoot, "", 0, state);
  return {
    files: state.files,
    bytes: state.bytes,
    sha256: state.hash.digest("hex"),
  };
}

/**
 * Copy a validated tree to a new directory using ordinary files only.
 *
 * Destination creation is exclusive. The destination is independently
 * inspected after the copy and must have the same digest as the source.
 */
export async function copyTreeSnapshot(
  source: string,
  destination: string,
  limits: TreeLimits = {},
  signal?: AbortSignal,
): Promise<TreeSummary> {
  throwIfAborted(signal);
  const sourceRoot = path.resolve(source);
  const destinationRoot = path.resolve(destination);
  await assertDirectoryNoSymlink(sourceRoot, "Snapshot source");
  await mkdir(destinationRoot, { recursive: false, mode: 0o700 });

  const resolvedLimits = resolveLimits(limits);
  const sourceSummary = await inspectTree(sourceRoot, resolvedLimits, signal);
  await copyEntries(
    sourceRoot,
    destinationRoot,
    "",
    0,
    resolvedLimits,
    signal,
  );
  const destinationSummary = await inspectTree(
    destinationRoot,
    resolvedLimits,
    signal,
  );
  if (
    sourceSummary.sha256 !== destinationSummary.sha256 ||
    sourceSummary.files !== destinationSummary.files ||
    sourceSummary.bytes !== destinationSummary.bytes
  ) {
    throw new UnsafePathError("Snapshot source changed while it was being copied");
  }
  return destinationSummary;
}

export async function sha256File(
  filePath: string,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);
  const absolute = path.resolve(filePath);
  const fileStats = await lstat(absolute);
  if (fileStats.isSymbolicLink() || !fileStats.isFile()) {
    throw new UnsafePathError("Digest target must be a regular non-symlink file");
  }
  const hash = createHash("sha256");
  await hashFileInto(absolute, hash, signal);
  return hash.digest("hex");
}

export function assertPathInside(
  boundary: string,
  candidate: string,
  message = "Path escapes its managed boundary",
  requireChild = false,
): void {
  const relative = path.relative(path.resolve(boundary), path.resolve(candidate));
  const outside =
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative);
  if (outside || (requireChild && relative.length === 0)) {
    throw new UnsafePathError(message);
  }
}

export function assertDirectChild(
  parent: string,
  candidate: string,
  message = "Path is not a managed direct child",
): void {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    relative.includes(path.sep)
  ) {
    throw new UnsafePathError(message);
  }
}

/**
 * Verify every existing path segment from boundary through target without
 * trusting realpath to silently follow a link.
 */
export async function assertNoSymlinkSegments(
  boundary: string,
  target: string,
): Promise<void> {
  const absoluteBoundary = path.resolve(boundary);
  const absoluteTarget = path.resolve(target);
  assertPathInside(absoluteBoundary, absoluteTarget);
  await assertDirectoryNoSymlink(absoluteBoundary, "Managed boundary");
  const relative = path.relative(absoluteBoundary, absoluteTarget);
  let current = absoluteBoundary;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let entryStats;
    try {
      entryStats = await lstat(current);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return;
      throw error;
    }
    if (entryStats.isSymbolicLink()) {
      throw new UnsafePathError("Managed path crosses a symbolic link");
    }
  }
}

export async function assertCanonicalDirectChild(
  parent: string,
  candidate: string,
): Promise<void> {
  const canonicalParent = await realpath(path.resolve(parent));
  assertDirectChild(canonicalParent, candidate);
  await assertNoSymlinkSegments(canonicalParent, candidate);
  const canonicalCandidate = await realpath(path.resolve(candidate));
  assertDirectChild(canonicalParent, canonicalCandidate);
}

export async function writeFileAtomic(
  filePath: string,
  contents: string,
  mode = 0o600,
): Promise<void> {
  const absolute = path.resolve(filePath);
  const parent = path.dirname(absolute);
  await assertDirectoryNoSymlink(parent, "Atomic write parent");
  const temporary = path.join(
    parent,
    `.${path.basename(absolute)}.${randomBytes(8).toString("hex")}.tmp`,
  );
  const handle = await open(
    temporary,
    fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
    mode,
  );
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, absolute);
}

async function visitTree(
  root: string,
  relativeDirectory: string,
  depth: number,
  state: {
    files: number;
    bytes: number;
    hash: ReturnType<typeof createHash>;
    limits: ResolvedLimits;
    signal?: AbortSignal;
  },
): Promise<void> {
  throwIfAborted(state.signal);
  if (depth > state.limits.maxDepth) {
    throw new UnsafePathError("Snapshot tree exceeds the maximum nesting depth");
  }
  const directory = path.join(root, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    throwIfAborted(state.signal);
    const relative = relativeDirectory
      ? path.join(relativeDirectory, entry.name)
      : entry.name;
    const portable = relative.split(path.sep).join("/");
    const absolute = path.join(root, relative);
    const entryStats = await lstat(absolute);
    if (entryStats.isSymbolicLink()) {
      throw new UnsafePathError(`Snapshot contains a symbolic link: ${portable}`);
    }
    if (entryStats.isDirectory()) {
      state.hash.update(`D\0${portable}\0`);
      await visitTree(root, relative, depth + 1, state);
      continue;
    }
    if (!entryStats.isFile()) {
      throw new UnsafePathError(`Snapshot contains a non-regular file: ${portable}`);
    }
    if (entryStats.size > state.limits.maxFileBytes) {
      throw new UnsafePathError(`Snapshot file exceeds the size limit: ${portable}`);
    }
    state.files += 1;
    state.bytes += entryStats.size;
    if (state.files > state.limits.maxFiles) {
      throw new UnsafePathError("Snapshot contains too many files");
    }
    if (state.bytes > state.limits.maxTotalBytes) {
      throw new UnsafePathError("Snapshot exceeds the total size limit");
    }
    state.hash.update(`F\0${portable}\0${entryStats.size}\0`);
    await hashFileInto(absolute, state.hash, state.signal);
  }
}

async function copyEntries(
  sourceRoot: string,
  destinationRoot: string,
  relativeDirectory: string,
  depth: number,
  limits: ResolvedLimits,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  if (depth > limits.maxDepth) {
    throw new UnsafePathError("Snapshot tree exceeds the maximum nesting depth");
  }
  const sourceDirectory = path.join(sourceRoot, relativeDirectory);
  const entries = await readdir(sourceDirectory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    throwIfAborted(signal);
    const relative = relativeDirectory
      ? path.join(relativeDirectory, entry.name)
      : entry.name;
    const sourcePath = path.join(sourceRoot, relative);
    const destinationPath = path.join(destinationRoot, relative);
    const before = await lstat(sourcePath);
    if (before.isSymbolicLink()) {
      throw new UnsafePathError("Snapshot source changed to a symbolic link");
    }
    if (before.isDirectory()) {
      await mkdir(destinationPath, { mode: before.mode & 0o777 });
      await copyEntries(
        sourceRoot,
        destinationRoot,
        relative,
        depth + 1,
        limits,
        signal,
      );
      continue;
    }
    if (!before.isFile()) {
      throw new UnsafePathError("Snapshot source contains a non-regular file");
    }
    await copyRegularFile(
      sourcePath,
      destinationPath,
      before.mode & 0o777,
      signal,
    );
    const after = await lstat(sourcePath);
    if (
      after.isSymbolicLink() ||
      !after.isFile() ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    ) {
      throw new UnsafePathError("Snapshot source changed while it was being copied");
    }
  }
}

async function hashFileInto(
  filePath: string,
  hash: ReturnType<typeof createHash>,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    const abort = (): void => {
      stream.destroy(abortError());
    };
    signal?.addEventListener("abort", abort, { once: true });
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", (error) => {
      signal?.removeEventListener("abort", abort);
      reject(error);
    });
    stream.once("end", () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    });
  });
}

async function copyRegularFile(
  source: string,
  destination: string,
  mode: number,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const input = createReadStream(source);
  const output = createWriteStream(destination, {
    flags: "wx",
    mode,
  });
  if (signal) await pipeline(input, output, { signal });
  else await pipeline(input, output);
  await chmod(destination, mode);
}

async function assertDirectoryNoSymlink(
  directory: string,
  label: string,
): Promise<void> {
  const entryStats = await lstat(directory);
  if (entryStats.isSymbolicLink() || !entryStats.isDirectory()) {
    throw new UnsafePathError(`${label} must be a non-symlink directory`);
  }
}

function resolveLimits(limits: TreeLimits): ResolvedLimits {
  return {
    maxFiles: limits.maxFiles ?? DEFAULT_MAX_FILES,
    maxTotalBytes: limits.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
    maxFileBytes: limits.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    maxDepth: limits.maxDepth ?? DEFAULT_MAX_DEPTH,
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): Error {
  const error = new Error("Operation aborted");
  error.name = "AbortError";
  return error;
}
