import { randomBytes } from "node:crypto";
import {
  access,
  lstat,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { RuntimeCatalog } from "./runtime-catalog.js";
import { RuntimeInitializer } from "./runtime-initializer.js";
import {
  buildRuntimePaths,
  isRuntimeId,
  readRuntimeManifest,
  splitRuntimeId,
  writeRuntimeManifest,
} from "./runtime-manifest.js";
import {
  assertDirectChild,
  assertNoSymlinkSegments,
  writeFileAtomic,
} from "./safe-files.js";

export interface RuntimeConnectionController {
  closeRuntime(runtimeId: string): Promise<void>;
}

export interface RuntimeSessionController {
  stopRuntime(runtimeId: string): Promise<void>;
}

export class RuntimeDeleteError extends Error {
  readonly kind: "not_found" | "busy" | "failed";

  constructor(kind: RuntimeDeleteError["kind"], options?: ErrorOptions) {
    super(
      kind === "not_found"
        ? "Runtime not found"
        : kind === "busy"
          ? "Runtime is already undergoing maintenance"
          : "Runtime deletion failed before commit",
      options,
    );
    this.name = "RuntimeDeleteError";
    this.kind = kind;
  }
}

/**
 * Runtime deletion has one filesystem commit point: rename into the managed
 * trash directory. Source Catalogs and paths stored in a manifest are never
 * recursive-delete targets.
 */
export class RuntimeDeleteService {
  private readonly cleanupTasks = new Set<Promise<void>>();
  private readonly safetyErrors: string[] = [];

  constructor(
    private readonly catalog: RuntimeCatalog,
    private readonly initializer: RuntimeInitializer,
    private readonly connections: RuntimeConnectionController,
    private readonly sessions: RuntimeSessionController,
  ) {}

  async delete(runtimeId: string): Promise<void> {
    if (!isRuntimeId(runtimeId)) throw new RuntimeDeleteError("not_found");
    const initial = this.catalog.get(runtimeId);
    if (!initial) throw new RuntimeDeleteError("not_found");
    if (!this.catalog.beginDelete(runtimeId)) {
      throw new RuntimeDeleteError("busy");
    }

    let committed = false;
    let cleanupScheduled = false;
    try {
      if (await exists(initial.root)) {
        const initialParent =
          initial.location === "projects"
            ? this.catalog.projectsRoot
            : this.catalog.stagingRoot;
        await validateManagedRuntimeTarget(
          initialParent,
          initial.root,
          runtimeId,
        );
        await this.catalog.updateStatus(
          runtimeId,
          "deleting",
          null,
          [
            "initializing",
            "initialization_failed",
            "ready",
            "active",
            "delete_failed",
          ],
        );
      }
      await this.initializer.cancelAndWait(runtimeId);
      await this.connections.closeRuntime(runtimeId);
      await this.sessions.stopRuntime(runtimeId);

      const record = this.catalog.get(runtimeId);
      if (!record) throw new RuntimeDeleteError("not_found");
      if (!(await exists(record.root))) {
        // Creation was cancelled before its staging directory existed.
        this.catalog.remove(runtimeId);
        committed = true;
        return;
      }
      const parent =
        record.location === "projects"
          ? this.catalog.projectsRoot
          : this.catalog.stagingRoot;
      await validateManagedRuntimeTarget(parent, record.root, runtimeId);

      const trashName = `${runtimeId}--${Date.now()}--${randomBytes(8).toString("hex")}`;
      const trashTarget = path.join(this.catalog.trashRoot, trashName);
      assertDirectChild(this.catalog.trashRoot, trashTarget);
      if (await exists(trashTarget)) {
        throw new RuntimeDeleteError("failed");
      }
      await rename(record.root, trashTarget);
      committed = true;
      this.catalog.remove(runtimeId);

      const cleanup = this.cleanupTrashTarget(trashTarget)
        .catch(() => undefined)
        .finally(() => {
          this.cleanupTasks.delete(cleanup);
          this.catalog.endOperation(runtimeId, "deleting");
        });
      this.cleanupTasks.add(cleanup);
      cleanupScheduled = true;
    } catch (error) {
      if (!committed) {
        await this.initializer.cancelAndWait(runtimeId).catch(() => undefined);
        await this.connections.closeRuntime(runtimeId).catch(() => undefined);
        await this.sessions.stopRuntime(runtimeId).catch(() => undefined);
        await this.markDeleteFailed(runtimeId);
        this.catalog.endOperation(runtimeId, "deleting");
      }
      throw error instanceof RuntimeDeleteError
        ? error
        : new RuntimeDeleteError("failed", { cause: error });
    } finally {
      if (committed && !cleanupScheduled) {
        this.catalog.endOperation(runtimeId, "deleting");
      }
    }
  }

  async recoverTrash(): Promise<void> {
    const entries = await readdir(this.catalog.trashRoot, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      const target = path.join(this.catalog.trashRoot, entry.name);
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        this.safetyErrors.push(`${target}: invalid trash entry`);
        continue;
      }
      try {
        await validateTrashTarget(this.catalog.trashRoot, target);
      } catch (error) {
        this.safetyErrors.push(`${target}: ${safeError(error)}`);
        continue;
      }
      const cleanup = this.cleanupTrashTarget(target).catch(() => undefined);
      this.cleanupTasks.add(cleanup);
      void cleanup.finally(() => this.cleanupTasks.delete(cleanup));
    }
  }

  getSafetyErrors(): readonly string[] {
    return this.safetyErrors;
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.cleanupTasks]);
  }

  private async cleanupTrashTarget(target: string): Promise<void> {
    try {
      await validateTrashTarget(this.catalog.trashRoot, target);
      await rm(target, { recursive: true, force: false });
    } catch (error) {
      await markCleanupFailed(target).catch(() => undefined);
      throw error;
    }
  }

  private async markDeleteFailed(runtimeId: string): Promise<void> {
    const record = await this.catalog.setStatusInMemory(
      runtimeId,
      "delete_failed",
      "delete_failed",
    );
    if (!record || !(await exists(buildRuntimePaths(record.root).manifest))) {
      return;
    }
    const parent =
      record.location === "projects"
        ? this.catalog.projectsRoot
        : this.catalog.stagingRoot;
    try {
      await validateManagedRuntimeTarget(parent, record.root, runtimeId);
    } catch {
      // Never follow an unsafe replacement merely to persist an error state.
      return;
    }
    await writeRuntimeManifest(record.root, record.manifest).catch(
      () => undefined,
    );
  }
}

async function validateManagedRuntimeTarget(
  managedParent: string,
  target: string,
  runtimeId: string,
): Promise<void> {
  const parentStats = await lstat(managedParent);
  if (parentStats.isSymbolicLink() || !parentStats.isDirectory()) {
    throw new Error("Managed Runtime parent is not a safe directory");
  }
  const parent = await realpath(managedParent);
  if (parent !== path.resolve(managedParent)) {
    throw new Error("Managed Runtime parent traverses a symbolic link");
  }
  assertDirectChild(parent, target);
  await assertNoSymlinkSegments(parent, target);
  const canonicalTarget = await realpath(target);
  assertDirectChild(parent, canonicalTarget);
  const manifest = await readRuntimeManifest(
    buildRuntimePaths(canonicalTarget).manifest,
  );
  if (manifest.id !== runtimeId) {
    throw new Error("Runtime manifest id does not match deletion target");
  }
  const ids = splitRuntimeId(runtimeId);
  if (
    manifest.profile.id !== ids.profileId ||
    manifest.dataset.id !== ids.datasetId
  ) {
    throw new Error("Runtime manifest identity is inconsistent");
  }
  const name = path.basename(canonicalTarget);
  if (
    name !== runtimeId &&
    !new RegExp(`^${escapeRegExp(runtimeId)}--[a-f0-9]{16}$`).test(name)
  ) {
    throw new Error("Runtime directory name is not a valid managed target");
  }
}

async function validateTrashTarget(
  trashRoot: string,
  target: string,
): Promise<void> {
  const rootStats = await lstat(trashRoot);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error("Managed trash root is not a safe directory");
  }
  const root = await realpath(trashRoot);
  if (root !== path.resolve(trashRoot)) {
    throw new Error("Managed trash root traverses a symbolic link");
  }
  assertDirectChild(root, target);
  await assertNoSymlinkSegments(root, target);
  const canonicalTarget = await realpath(target);
  assertDirectChild(root, canonicalTarget);
  const manifest = await readRuntimeManifest(
    buildRuntimePaths(canonicalTarget).manifest,
  );
  const expected =
    `^${escapeRegExp(manifest.id)}--\\d{10,17}--[a-f0-9]{16}$`;
  if (!new RegExp(expected).test(path.basename(canonicalTarget))) {
    throw new Error("Trash entry name does not match its Runtime manifest");
  }
  const ids = splitRuntimeId(manifest.id);
  if (
    manifest.profile.id !== ids.profileId ||
    manifest.dataset.id !== ids.datasetId
  ) {
    throw new Error("Trash manifest identity is inconsistent");
  }
}

async function markCleanupFailed(target: string): Promise<void> {
  const entryStats = await lstat(target);
  if (entryStats.isSymbolicLink() || !entryStats.isDirectory()) return;
  await writeFileAtomic(
    path.join(target, "cleanup.json"),
    `${JSON.stringify({
      status: "cleanup_failed",
      updated_at: new Date().toISOString(),
    }, null, 2)}\n`,
  );
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
