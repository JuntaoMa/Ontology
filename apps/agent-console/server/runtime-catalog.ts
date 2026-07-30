import type { Dirent } from "node:fs";
import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import {
  loadDatasetCatalog,
  type LoadedDataset,
} from "./dataset.js";
import {
  loadProfileCatalog,
  type LoadedProfile,
} from "./profile.js";
import {
  buildRuntimePaths,
  isRuntimeId,
  loadRuntime,
  makeRuntimeId,
  readRuntimeManifest,
  revalidateRuntimeExecution,
  type LoadedRuntime,
  type PublicRuntime,
  type RuntimeLocation,
  type RuntimeManifest,
  type RuntimeRecord,
  type RuntimeStatus,
  splitRuntimeId,
  toPublicRuntime,
  writeRuntimeManifest,
} from "./runtime-manifest.js";
import {
  assertDirectChild,
  assertNoSymlinkSegments,
} from "./safe-files.js";

export type RuntimeOperation = "initializing" | "deleting" | "session";

export interface RuntimeCatalogOptions {
  demoRoot: string;
  profiles: LoadedProfile[];
  datasets: LoadedDataset[];
  runtimeRoot?: string;
  refreshRuntime?: typeof loadRuntime;
  revalidateRuntime?: typeof revalidateRuntimeExecution;
}

export interface RuntimeCatalogHealth {
  runtimes: number;
  initializing: number;
  active: number;
  safety_errors: number;
}

export class RuntimeStatusConflictError extends Error {
  constructor(
    readonly runtimeId: string,
    readonly actualStatus: RuntimeStatus,
    readonly expectedStatuses: readonly RuntimeStatus[],
  ) {
    super(
      `Runtime "${runtimeId}" has status "${actualStatus}", expected ` +
        expectedStatuses.map((status) => `"${status}"`).join(" or "),
    );
    this.name = "RuntimeStatusConflictError";
  }
}

export class RuntimeRecordConflictError extends Error {
  constructor(readonly runtimeId: string) {
    super(`Runtime "${runtimeId}" changed while it was being reloaded`);
    this.name = "RuntimeRecordConflictError";
  }
}

/**
 * Owns only Runtime discovery, durable status and per-id operation
 * reservations. Process supervision and filesystem transactions remain in
 * their dedicated modules.
 */
export class RuntimeCatalog {
  readonly demoRoot: string;
  readonly runtimeRoot: string;
  readonly projectsRoot: string;
  readonly stagingRoot: string;
  readonly trashRoot: string;

  private profilesById: ReadonlyMap<string, LoadedProfile>;
  private datasetsById: ReadonlyMap<string, LoadedDataset>;
  private readonly refreshRuntime: typeof loadRuntime;
  private readonly revalidateRuntime: typeof revalidateRuntimeExecution;
  private readonly records = new Map<string, RuntimeRecord>();
  private readonly operations = new Map<string, RuntimeOperation>();
  private readonly recordMutations = new Map<string, Promise<void>>();
  private readonly safetyErrors: string[] = [];

  constructor(options: RuntimeCatalogOptions) {
    this.demoRoot = path.resolve(options.demoRoot);
    this.runtimeRoot = path.resolve(
      options.runtimeRoot ?? path.join(this.demoRoot, ".runtime"),
    );
    this.projectsRoot = path.join(this.runtimeRoot, "projects");
    this.stagingRoot = path.join(this.runtimeRoot, "staging");
    this.trashRoot = path.join(this.runtimeRoot, "trash");
    this.profilesById = indexedCatalog(options.profiles, "Profile");
    this.datasetsById = indexedCatalog(options.datasets, "Dataset");
    this.refreshRuntime = options.refreshRuntime ?? loadRuntime;
    this.revalidateRuntime =
      options.revalidateRuntime ?? revalidateRuntimeExecution;
  }

  get profiles(): ReadonlyMap<string, LoadedProfile> {
    return this.profilesById;
  }

  get datasets(): ReadonlyMap<string, LoadedDataset> {
    return this.datasetsById;
  }

  private replaceProfiles(profiles: LoadedProfile[]): void {
    this.profilesById = indexedCatalog(profiles, "Profile");
  }

  private replaceDatasets(datasets: LoadedDataset[]): void {
    this.datasetsById = indexedCatalog(datasets, "Dataset");
  }

  async reloadProfiles(profilesRoot: string): Promise<LoadedProfile[]> {
    const profiles = await loadProfileCatalog(profilesRoot);
    this.replaceProfiles(profiles);
    return profiles;
  }

  async reloadDatasets(datasetsRoot: string): Promise<LoadedDataset[]> {
    const datasets = await loadDatasetCatalog(datasetsRoot);
    this.replaceDatasets(datasets);
    return datasets;
  }

  async initialize(): Promise<void> {
    await ensureManagedDirectory(this.demoRoot, "Demo root", false);
    await ensureManagedDirectory(this.runtimeRoot, "Runtime root", true);
    await ensureManagedDirectory(this.projectsRoot, "Runtime projects", true);
    await ensureManagedDirectory(this.stagingRoot, "Runtime staging", true);
    await ensureManagedDirectory(this.trashRoot, "Runtime trash", true);
    this.records.clear();
    this.safetyErrors.length = 0;
    await this.scanProjects();
    await this.scanStaging();
  }

  get(runtimeId: string): RuntimeRecord | undefined {
    return this.records.get(runtimeId);
  }

  getLoaded(runtimeId: string): LoadedRuntime | undefined {
    return this.records.get(runtimeId)?.loaded;
  }

  list(): PublicRuntime[] {
    return [...this.records.values()]
      .map((record) => toPublicRuntime(record, this.isRecordStale(record)))
      .sort((left, right) => {
        const created = left.created_at.localeCompare(right.created_at);
        return created === 0 ? left.id.localeCompare(right.id) : created;
      });
  }

  health(): RuntimeCatalogHealth {
    const values = [...this.records.values()];
    return {
      runtimes: values.length,
      initializing: values.filter(
        (record) => record.manifest.status === "initializing",
      ).length,
      active: values.filter((record) => record.manifest.status === "active")
        .length,
      safety_errors: this.safetyErrors.length,
    };
  }

  getSafetyErrors(): readonly string[] {
    return this.safetyErrors;
  }

  hasOrReserved(runtimeId: string): boolean {
    return this.records.has(runtimeId) || this.operations.has(runtimeId);
  }

  beginCreate(profileId: string, datasetId: string): string | undefined {
    const runtimeId = makeRuntimeId(profileId, datasetId);
    if (this.hasOrReserved(runtimeId)) return undefined;
    this.operations.set(runtimeId, "initializing");
    return runtimeId;
  }

  beginDelete(runtimeId: string): boolean {
    if (!this.records.has(runtimeId)) return false;
    const current = this.operations.get(runtimeId);
    if (current === "deleting" || current === "session") return false;
    // Deletion may supersede an initializer because RuntimeDeleteService can
    // cancel and await the already-registered initialization task. It must not
    // supersede Session maintenance: that route may not have registered its
    // subprocess yet, so a one-shot stop could otherwise miss the late spawn.
    this.operations.set(runtimeId, "deleting");
    return true;
  }

  beginSessionMaintenance(runtimeId: string): boolean {
    if (!this.records.has(runtimeId) || this.operations.has(runtimeId)) {
      return false;
    }
    this.operations.set(runtimeId, "session");
    return true;
  }

  ownsOperation(runtimeId: string, operation: RuntimeOperation): boolean {
    return this.operations.get(runtimeId) === operation;
  }

  isLocked(runtimeId: string): boolean {
    return this.operations.has(runtimeId);
  }

  isRuntimeStale(runtimeId: string): boolean {
    const record = this.records.get(runtimeId);
    return record === undefined || this.isRecordStale(record);
  }

  endOperation(runtimeId: string, operation: RuntimeOperation): void {
    if (this.operations.get(runtimeId) === operation) {
      this.operations.delete(runtimeId);
    }
  }

  register(record: RuntimeRecord): void {
    this.records.set(record.manifest.id, record);
  }

  remove(runtimeId: string): void {
    this.records.delete(runtimeId);
  }

  async replaceWithLoaded(
    runtimeId: string,
    runtimeRoot: string,
    location: RuntimeLocation,
  ): Promise<LoadedRuntime> {
    const parent =
      location === "projects" ? this.projectsRoot : this.stagingRoot;
    const loaded = await loadRuntime(
      runtimeRoot,
      parent,
      location,
      this.demoRoot,
    );
    if (loaded.manifest.id !== runtimeId) {
      throw new Error("Loaded Runtime id does not match the requested id");
    }
    this.records.set(runtimeId, {
      manifest: loaded.manifest,
      location,
      root: loaded.paths.root,
      loaded,
    });
    return loaded;
  }

  async refreshLoaded(runtimeId: string): Promise<LoadedRuntime> {
    const expected = this.records.get(runtimeId);
    if (!expected) throw new Error(`Unknown Runtime "${runtimeId}"`);
    return this.serializeRecordMutation(runtimeId, async () => {
      this.assertCurrentRecord(runtimeId, expected);
      const parent =
        expected.location === "projects"
          ? this.projectsRoot
          : this.stagingRoot;
      const loaded = await this.refreshRuntime(
        expected.root,
        parent,
        expected.location,
        this.demoRoot,
      );
      this.assertCurrentRecord(runtimeId, expected);
      this.records.set(runtimeId, {
        manifest: loaded.manifest,
        location: expected.location,
        root: loaded.paths.root,
        loaded,
      });
      return loaded;
    });
  }

  async revalidateLoaded(runtimeId: string): Promise<LoadedRuntime> {
    const expected = this.records.get(runtimeId);
    if (!expected?.loaded) {
      throw new Error(`Runtime "${runtimeId}" is not loaded`);
    }
    return this.serializeRecordMutation(runtimeId, async () => {
      this.assertCurrentRecord(runtimeId, expected);
      const loaded = await this.revalidateRuntime(expected.loaded!);
      this.assertCurrentRecord(runtimeId, expected);
      this.records.set(runtimeId, {
        ...expected,
        manifest: loaded.manifest,
        loaded,
      });
      return loaded;
    });
  }

  async updateStatus(
    runtimeId: string,
    status: RuntimeStatus,
    errorCode: string | null = null,
    expectedStatuses?: readonly RuntimeStatus[],
  ): Promise<RuntimeRecord> {
    return this.serializeRecordMutation(runtimeId, async () => {
      const record = this.records.get(runtimeId);
      if (!record) throw new Error(`Unknown Runtime "${runtimeId}"`);
      this.assertExpectedStatus(record, expectedStatuses);
      const updated = this.buildStatusRecord(record, status, errorCode);
      await writeRuntimeManifest(updated.root, updated.manifest);
      this.records.set(runtimeId, updated);
      return updated;
    });
  }

  async setStatusInMemory(
    runtimeId: string,
    status: RuntimeStatus,
    errorCode: string | null = null,
    expectedStatuses?: readonly RuntimeStatus[],
  ): Promise<RuntimeRecord | undefined> {
    return this.serializeRecordMutation(runtimeId, () => {
      const record = this.records.get(runtimeId);
      if (!record) return undefined;
      this.assertExpectedStatus(record, expectedStatuses);
      const updated = this.buildStatusRecord(record, status, errorCode);
      this.records.set(runtimeId, updated);
      return updated;
    });
  }

  private assertExpectedStatus(
    record: RuntimeRecord,
    expectedStatuses: readonly RuntimeStatus[] | undefined,
  ): void {
    if (
      expectedStatuses &&
      !expectedStatuses.includes(record.manifest.status)
    ) {
      throw new RuntimeStatusConflictError(
        record.manifest.id,
        record.manifest.status,
        expectedStatuses,
      );
    }
  }

  private assertCurrentRecord(
    runtimeId: string,
    expected: RuntimeRecord,
  ): void {
    if (this.records.get(runtimeId) !== expected) {
      throw new RuntimeRecordConflictError(runtimeId);
    }
  }

  private async serializeRecordMutation<T>(
    runtimeId: string,
    operation: () => Promise<T> | T,
  ): Promise<T> {
    const previous =
      this.recordMutations.get(runtimeId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const barrier = result.then(
      () => undefined,
      () => undefined,
    );
    this.recordMutations.set(runtimeId, barrier);
    try {
      return await result;
    } finally {
      if (this.recordMutations.get(runtimeId) === barrier) {
        this.recordMutations.delete(runtimeId);
      }
    }
  }

  private buildStatusRecord(
    record: RuntimeRecord,
    status: RuntimeStatus,
    errorCode: string | null,
  ): RuntimeRecord {
    const manifest: RuntimeManifest = {
      ...record.manifest,
      status,
      last_error: errorCode === null ? null : { code: errorCode },
    };
    return {
      ...record,
      manifest,
      ...(record.loaded
        ? {
            loaded: {
              ...record.loaded,
              manifest,
            },
          }
        : {}),
    };
  }

  expectedProjectRoot(runtimeId: string): string {
    if (!isRuntimeId(runtimeId)) throw new Error("Invalid Runtime id");
    return path.join(this.projectsRoot, runtimeId);
  }

  private isRecordStale(record: RuntimeRecord): boolean {
    const profile = this.profilesById.get(record.manifest.profile.id);
    const dataset = this.datasetsById.get(record.manifest.dataset.id);
    return (
      profile === undefined ||
      profile.revision !== record.manifest.profile.revision ||
      profile.snapshotSha256 !== record.manifest.profile.snapshot_sha256 ||
      dataset === undefined ||
      dataset.snapshotSha256 !== record.manifest.dataset.snapshot_sha256 ||
      dataset.ontologySha256 !== record.manifest.dataset.ontology_sha256
    );
  }

  private async scanProjects(): Promise<void> {
    for (const entry of await managedEntries(this.projectsRoot)) {
      const runtimeRoot = path.join(this.projectsRoot, entry.name);
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        this.recordSafetyError(runtimeRoot, "non-directory Runtime entry");
        continue;
      }
      if (!isRuntimeId(entry.name)) {
        this.recordSafetyError(runtimeRoot, "invalid Runtime directory name");
        continue;
      }
      try {
        let loaded = await loadRuntime(
          runtimeRoot,
          this.projectsRoot,
          "projects",
          this.demoRoot,
        );
        const recovered = recoveryStatus(loaded.manifest.status, "projects");
        if (recovered) {
          const manifest = {
            ...loaded.manifest,
            status: recovered.status,
            last_error:
              recovered.errorCode === null
                ? null
                : { code: recovered.errorCode },
          } satisfies RuntimeManifest;
          await writeRuntimeManifest(runtimeRoot, manifest);
          loaded = { ...loaded, manifest };
        }
        if (this.records.has(loaded.manifest.id)) {
          throw new Error("duplicate Runtime id");
        }
        this.records.set(loaded.manifest.id, {
          manifest: loaded.manifest,
          location: "projects",
          root: loaded.paths.root,
          loaded,
        });
      } catch (error) {
        this.recordSafetyError(runtimeRoot, safeError(error));
      }
    }
  }

  private async scanStaging(): Promise<void> {
    for (const entry of await managedEntries(this.stagingRoot)) {
      const runtimeRoot = path.join(this.stagingRoot, entry.name);
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        this.recordSafetyError(runtimeRoot, "non-directory staging entry");
        continue;
      }
      try {
        assertDirectChild(this.stagingRoot, runtimeRoot);
        await assertNoSymlinkSegments(this.stagingRoot, runtimeRoot);
        let manifest = await readRuntimeManifest(
          buildRuntimePaths(runtimeRoot).manifest,
        );
        const expected = splitRuntimeId(manifest.id);
        if (
          makeRuntimeId(expected.profileId, expected.datasetId) !==
            manifest.id ||
          !entry.name.startsWith(`${manifest.id}--`) ||
          !/^[a-f0-9]{16}$/.test(entry.name.slice(manifest.id.length + 2))
        ) {
          throw new Error("staging directory identity mismatch");
        }
        if (this.records.has(manifest.id)) {
          throw new Error("a published Runtime already uses this id");
        }
        const recovered = recoveryStatus(manifest.status, "staging");
        if (recovered) {
          manifest = {
            ...manifest,
            status: recovered.status,
            last_error:
              recovered.errorCode === null
                ? null
                : { code: recovered.errorCode },
          };
          await writeRuntimeManifest(runtimeRoot, manifest);
        }
        let loaded: LoadedRuntime | undefined;
        try {
          loaded = await loadRuntime(
            runtimeRoot,
            this.stagingRoot,
            "staging",
            this.demoRoot,
          );
          loaded = { ...loaded, manifest };
        } catch {
          // A failed Initializer may leave only a partial snapshot. The valid
          // manifest remains visible and deletable, but never executable.
        }
        this.records.set(manifest.id, {
          manifest,
          location: "staging",
          root: runtimeRoot,
          ...(loaded ? { loaded } : {}),
        });
      } catch (error) {
        this.recordSafetyError(runtimeRoot, safeError(error));
      }
    }
  }

  private recordSafetyError(target: string, message: string): void {
    this.safetyErrors.push(`${target}: ${message}`);
  }
}

function recoveryStatus(
  status: RuntimeStatus,
  location: RuntimeLocation,
): { status: RuntimeStatus; errorCode: string | null } | undefined {
  if (location === "staging") {
    if (status === "deleting") {
      return { status: "delete_failed", errorCode: "delete_interrupted" };
    }
    if (
      status === "initializing" ||
      status === "ready" ||
      status === "active"
    ) {
      return {
        status: "initialization_failed",
        errorCode: "initialization_interrupted",
      };
    }
    return undefined;
  }
  if (status === "active") {
    return { status: "ready", errorCode: null };
  }
  if (status === "deleting") {
    return { status: "delete_failed", errorCode: "delete_interrupted" };
  }
  if (status === "initializing") {
    return {
      status: "initialization_failed",
      errorCode: "initialization_interrupted",
    };
  }
  return undefined;
}

async function ensureManagedDirectory(
  directory: string,
  label: string,
  create: boolean,
): Promise<void> {
  if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
  const entryStats = await lstat(directory);
  if (entryStats.isSymbolicLink() || !entryStats.isDirectory()) {
    throw new Error(`${label} must be a non-symlink directory`);
  }
  const canonical = await realpath(directory);
  if (canonical !== path.resolve(directory)) {
    throw new Error(`${label} must not traverse symbolic links`);
  }
}

async function managedEntries(
  root: string,
): Promise<Dirent<string>[]> {
  return readdir(root, { withFileTypes: true });
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function indexedCatalog<T extends { id: string }>(
  entries: readonly T[],
  label: string,
): ReadonlyMap<string, T> {
  const indexed = new Map<string, T>();
  for (const entry of entries) {
    if (indexed.has(entry.id)) {
      throw new Error(`Duplicate ${label} id "${entry.id}"`);
    }
    indexed.set(entry.id, entry);
  }
  return indexed;
}
