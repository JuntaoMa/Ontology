import { randomBytes } from "node:crypto";
import { access, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { prepareRuntimeConfigOverlay } from "./opencode-runtime.js";
import { type LoadedDataset } from "./dataset.js";
import { type LoadedProfile } from "./profile.js";
import { RuntimeCatalog } from "./runtime-catalog.js";
import {
  buildRuntimePaths,
  createRuntimeManifest,
  loadRuntime,
  type RuntimeManifest,
  type RuntimeRecord,
  writeRuntimeManifest,
} from "./runtime-manifest.js";
import {
  RuntimeProcessError,
  RuntimeSupervisor,
} from "./runtime-supervisor.js";
import { copyTreeSnapshot, inspectTree } from "./safe-files.js";

const CANCEL_WAIT_TIMEOUT_MS = 10_000;

export class RuntimeCreateError extends Error {
  readonly kind: "not_found" | "incompatible" | "exists";

  constructor(kind: RuntimeCreateError["kind"]) {
    super(
      kind === "not_found"
        ? "Profile or Dataset was not found"
        : kind === "incompatible"
          ? "Dataset does not satisfy the Profile contract"
          : "Runtime already exists",
    );
    this.name = "RuntimeCreateError";
    this.kind = kind;
  }
}

export interface AcceptedRuntime {
  id: string;
  status: "initializing";
}

interface ActiveInitialization {
  controller: AbortController;
  task: Promise<void>;
}

/**
 * Materializes immutable source inputs through staging and publishes only by
 * an atomic same-filesystem rename.
 */
export class RuntimeInitializer {
  private readonly active = new Map<string, ActiveInitialization>();

  constructor(
    private readonly catalog: RuntimeCatalog,
    private readonly supervisor: RuntimeSupervisor,
    private readonly sourceEnvironment: NodeJS.ProcessEnv = process.env,
  ) {}

  start(profileId: string, datasetId: string): AcceptedRuntime {
    const profile = this.catalog.profiles.get(profileId);
    const dataset = this.catalog.datasets.get(datasetId);
    if (!profile || !dataset) throw new RuntimeCreateError("not_found");
    if (
      profile.datasetContract.rawData === "required" &&
      dataset.rawDataDir === undefined
    ) {
      throw new RuntimeCreateError("incompatible");
    }
    const runtimeId = this.catalog.beginCreate(profileId, datasetId);
    if (!runtimeId) throw new RuntimeCreateError("exists");

    const controller = new AbortController();
    const manifest = createRuntimeManifest(profile, dataset);
    const nonce = randomBytes(8).toString("hex");
    const stagingRoot = path.join(
      this.catalog.stagingRoot,
      `${runtimeId}--${nonce}`,
    );
    this.catalog.register({
      manifest,
      location: "staging",
      root: stagingRoot,
    });
    const task = this.initializeOne(
      profile,
      dataset,
      manifest,
      stagingRoot,
      controller.signal,
    )
      .catch(() => {
        // Failure is represented durably by runtime.yaml. The async job must
        // not become an unhandled rejection.
      })
      .finally(() => {
        this.active.delete(runtimeId);
        this.catalog.endOperation(runtimeId, "initializing");
      });
    this.active.set(runtimeId, { controller, task });
    return { id: runtimeId, status: "initializing" };
  }

  async cancelAndWait(runtimeId: string): Promise<void> {
    const current = this.active.get(runtimeId);
    if (!current) {
      await this.supervisor.stopInitializer(runtimeId);
      return;
    }
    current.controller.abort();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        (async () => {
          await this.supervisor.stopInitializer(runtimeId);
          await current.task;
        })(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(new RuntimeProcessError("process_stop_failed")),
            CANCEL_WAIT_TIMEOUT_MS,
          );
          timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async waitFor(runtimeId: string): Promise<void> {
    await this.active.get(runtimeId)?.task;
  }

  async close(): Promise<void> {
    const active = [...this.active.entries()];
    for (const [, process] of active) process.controller.abort();
    await Promise.allSettled(
      active.map(async ([runtimeId, process]) => {
        await this.supervisor.stopInitializer(runtimeId);
        await process.task;
      }),
    );
  }

  private async initializeOne(
    sourceProfile: LoadedProfile,
    sourceDataset: LoadedDataset,
    manifest: RuntimeManifest,
    stagingRoot: string,
    signal: AbortSignal,
  ): Promise<void> {
    const runtimeId = manifest.id;
    const projectRoot = this.catalog.expectedProjectRoot(runtimeId);
    let currentManifest = manifest;
    let promoted = false;

    try {
      throwIfInitializationLost(this.catalog, runtimeId, signal);
      await mkdir(stagingRoot, { mode: 0o700 });
      await writeRuntimeManifest(stagingRoot, currentManifest);
      throwIfInitializationLost(this.catalog, runtimeId, signal);
      const paths = buildRuntimePaths(stagingRoot);
      await mkdir(paths.workspace, { mode: 0o700 });
      const copiedProfile = await copyTreeSnapshot(
        sourceProfile.profileRoot,
        paths.profile,
        {},
        signal,
      );
      if (copiedProfile.sha256 !== manifest.profile.snapshot_sha256) {
        throw new Error("Profile source changed after Catalog validation");
      }
      throwIfInitializationLost(this.catalog, runtimeId, signal);
      const copiedDataset = await copyTreeSnapshot(
        sourceDataset.datasetRoot,
        paths.dataset,
        {},
        signal,
      );
      if (copiedDataset.sha256 !== manifest.dataset.snapshot_sha256) {
        throw new Error("Dataset source changed after Catalog validation");
      }
      throwIfInitializationLost(this.catalog, runtimeId, signal);
      await Promise.all([
        mkdir(paths.generated, { mode: 0o700 }),
        mkdir(paths.opencodeConfig, { recursive: true, mode: 0o700 }),
        mkdir(paths.state, { mode: 0o700 }),
        mkdir(paths.logs, { mode: 0o700 }),
      ]);
      throwIfInitializationLost(this.catalog, runtimeId, signal);
      const pendingRecord: RuntimeRecord = {
        manifest: currentManifest,
        location: "staging",
        root: stagingRoot,
      };
      this.catalog.register(pendingRecord);

      let runtime = await loadRuntime(
        stagingRoot,
        this.catalog.stagingRoot,
        "staging",
        this.catalog.demoRoot,
        signal,
      );
      throwIfInitializationLost(this.catalog, runtimeId, signal);
      this.catalog.register({
        ...pendingRecord,
        loaded: runtime,
      });
      throwIfInitializationLost(this.catalog, runtimeId, signal);
      await this.supervisor.runInitializer(runtime, this.sourceEnvironment);
      throwIfInitializationLost(this.catalog, runtimeId, signal);

      // Re-validate the complete candidate after arbitrary Profile-owned
      // initializer code ran. Dataset bytes must remain the creation snapshot.
      await inspectTree(stagingRoot, {}, signal);
      runtime = await loadRuntime(
        stagingRoot,
        this.catalog.stagingRoot,
        "staging",
        this.catalog.demoRoot,
        signal,
      );
      if (
        JSON.stringify(runtime.manifest) !== JSON.stringify(currentManifest)
      ) {
        throw new Error("Initializer modified the Runtime manifest");
      }
      throwIfInitializationLost(this.catalog, runtimeId, signal);
      prepareRuntimeConfigOverlay(runtime.profile, runtime.paths.opencodeConfig);
      currentManifest = {
        ...currentManifest,
        status: "ready",
        last_error: null,
      };
      await writeRuntimeManifest(stagingRoot, currentManifest);

      throwIfInitializationLost(this.catalog, runtimeId, signal);
      await assertDoesNotExist(projectRoot);
      await rename(stagingRoot, projectRoot);
      promoted = true;
      this.catalog.register({
        manifest: currentManifest,
        location: "projects",
        root: projectRoot,
      });
      await this.catalog.replaceWithLoaded(runtimeId, projectRoot, "projects");
    } catch (error) {
      if (!this.catalog.ownsOperation(runtimeId, "initializing")) return;
      const root = promoted ? projectRoot : stagingRoot;
      const code = initializationErrorCode(error);
      currentManifest = {
        ...currentManifest,
        status: "initialization_failed",
        last_error: { code },
      };
      try {
        await writeRuntimeManifest(root, currentManifest);
        this.catalog.register({
          manifest: currentManifest,
          location: promoted ? "projects" : "staging",
          root,
        });
      } catch {
        // If even the failure manifest cannot be made durable, leave the
        // directory untouched. Startup scan reports it as a safety error.
      }
    }
  }
}

function throwIfInitializationLost(
  catalog: RuntimeCatalog,
  runtimeId: string,
  signal: AbortSignal,
): void {
  if (
    signal.aborted ||
    !catalog.ownsOperation(runtimeId, "initializing")
  ) {
    throw new RuntimeProcessError("initializer_cancelled");
  }
}

async function assertDoesNotExist(target: string): Promise<void> {
  try {
    await access(target);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
  throw new RuntimeCreateError("exists");
}

function initializationErrorCode(error: unknown): string {
  if (error instanceof RuntimeProcessError) return error.code;
  if (error instanceof RuntimeCreateError) return "runtime_exists";
  return "initialization_failed";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
