import {
  access,
  mkdir,
  readFile,
  rename,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDatasetCatalog } from "./dataset.js";
import { loadProfileCatalog } from "./profile.js";
import {
  RuntimeCatalog,
  RuntimeRecordConflictError,
} from "./runtime-catalog.js";
import { RuntimeDeleteService } from "./runtime-delete.js";
import { RuntimeInitializer } from "./runtime-initializer.js";
import { RuntimeSupervisor } from "./runtime-supervisor.js";
import { createDemoFixture, type DemoFixture } from "./runtime.test-fixture.js";

describe("Runtime materialization and recovery", () => {
  let fixture: DemoFixture | undefined;

  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
  });

  it("copies Profile and Dataset snapshots and atomically publishes ready", async () => {
    fixture = await createDemoFixture();
    const supervisor = new RuntimeSupervisor();
    const initializer = new RuntimeInitializer(fixture.catalog, supervisor, {});

    const accepted = initializer.start("test-profile", "test-dataset");
    expect(accepted).toEqual({
      id: "test-profile--test-dataset",
      status: "initializing",
    });
    expect(fixture.catalog.list()[0]?.status).toBe("initializing");
    await initializer.waitFor(accepted.id);

    const runtime = fixture.catalog.getLoaded(accepted.id);
    expect(runtime?.location).toBe("projects");
    expect(runtime?.manifest.status).toBe("ready");
    expect(runtime?.paths.workspace).toBe(
      path.join(
        fixture.root,
        ".runtime",
        "projects",
        accepted.id,
        "workspace",
      ),
    );
    await expect(
      access(path.join(runtime!.paths.opencodeConfig, "opencode.jsonc")),
    ).resolves.toBeUndefined();
    expect(runtime?.dataset.ontologySha256).toBe(
      fixture.catalog.datasets.get("test-dataset")?.ontologySha256,
    );
    await supervisor.close();
  });

  it("retains a failed initializer in staging with a safe error code", async () => {
    fixture = await createDemoFixture({
      initializerScript: "process.exit(7)",
    });
    const supervisor = new RuntimeSupervisor();
    const initializer = new RuntimeInitializer(fixture.catalog, supervisor, {});

    const accepted = initializer.start("test-profile", "test-dataset");
    await initializer.waitFor(accepted.id);

    const record = fixture.catalog.get(accepted.id);
    expect(record?.location).toBe("staging");
    expect(record?.manifest.status).toBe("initialization_failed");
    expect(record?.manifest.last_error).toEqual({ code: "initializer_failed" });
    expect(JSON.stringify(fixture.catalog.list())).not.toContain(fixture.root);
    await supervisor.close();
  });

  it("allows an initializer to materialize Runtime-local Profile assets", async () => {
    fixture = await createDemoFixture({
      initializerScript:
        "require('node:fs').writeFileSync(" +
        "process.env.ONTOLOGY_PROFILE_DIR + '/materialized.txt', 'ready\\n')",
    });
    const sourceDigest =
      fixture.catalog.profiles.get("test-profile")!.snapshotSha256;
    const supervisor = new RuntimeSupervisor();
    const initializer = new RuntimeInitializer(fixture.catalog, supervisor, {});

    const accepted = initializer.start("test-profile", "test-dataset");
    await initializer.waitFor(accepted.id);

    const runtime = fixture.catalog.getLoaded(accepted.id)!;
    expect(runtime.manifest.status).toBe("ready");
    expect(runtime.manifest.profile.snapshot_sha256).toBe(sourceDigest);
    expect(runtime.profile.snapshotSha256).not.toBe(sourceDigest);
    expect(
      await readFile(
        path.join(runtime.paths.profile, "materialized.txt"),
        "utf8",
      ),
    ).toBe("ready\n");
    await supervisor.close();
  });

  it("fails rather than snapshotting a Profile changed after Catalog load", async () => {
    fixture = await createDemoFixture();
    await writeFile(
      path.join(fixture.profileRoot, "README.md"),
      "changed after catalog load\n",
      "utf8",
    );
    const supervisor = new RuntimeSupervisor();
    const initializer = new RuntimeInitializer(fixture.catalog, supervisor, {});

    const accepted = initializer.start("test-profile", "test-dataset");
    await initializer.waitFor(accepted.id);

    expect(fixture.catalog.get(accepted.id)?.manifest.status).toBe(
      "initialization_failed",
    );
    expect(fixture.catalog.get(accepted.id)?.location).toBe("staging");
    await supervisor.close();
  });

  it("rejects a symlink-swapped workspace before execution", async () => {
    fixture = await createDemoFixture();
    const supervisor = new RuntimeSupervisor();
    const initializer = new RuntimeInitializer(fixture.catalog, supervisor, {});
    const accepted = initializer.start("test-profile", "test-dataset");
    await initializer.waitFor(accepted.id);
    const workspace = fixture.catalog.getLoaded(accepted.id)!.paths.workspace;
    const held = `${workspace}-held`;
    await rename(workspace, held);
    await symlink(held, workspace, "dir");

    await expect(
      fixture.catalog.revalidateLoaded(accepted.id),
    ).rejects.toThrow(/symbolic link/i);
    await supervisor.close();
  });

  it("rejects a symlink-swapped managed Runtime parent before execution", async () => {
    fixture = await createDemoFixture();
    const supervisor = new RuntimeSupervisor();
    const initializer = new RuntimeInitializer(fixture.catalog, supervisor, {});
    const accepted = initializer.start("test-profile", "test-dataset");
    await initializer.waitFor(accepted.id);
    const projects = fixture.catalog.projectsRoot;
    const held = `${projects}-held`;
    await rename(projects, held);
    await symlink(held, projects, "dir");

    await expect(
      fixture.catalog.revalidateLoaded(accepted.id),
    ).rejects.toThrow(/Runtime parent.*(?:symlink|symbolic link)/i);
    await supervisor.close();
  });

  it("allows OpenCode-owned node_modules links below the fixed config boundary", async () => {
    fixture = await createDemoFixture();
    const supervisor = new RuntimeSupervisor();
    const initializer = new RuntimeInitializer(fixture.catalog, supervisor, {});
    const accepted = initializer.start("test-profile", "test-dataset");
    await initializer.waitFor(accepted.id);
    const runtime = fixture.catalog.getLoaded(accepted.id)!;
    const bin = path.join(
      runtime.paths.opencodeConfig,
      "node_modules",
      ".bin",
    );
    await mkdir(bin, { recursive: true });
    await symlink(process.execPath, path.join(bin, "node"));

    await expect(
      fixture.catalog.revalidateLoaded(accepted.id),
    ).resolves.toMatchObject({
      manifest: { id: accepted.id },
    });
    await supervisor.close();
  });

  it("recovers active to ready and reports source snapshot drift as stale", async () => {
    fixture = await createDemoFixture();
    const supervisor = new RuntimeSupervisor();
    const initializer = new RuntimeInitializer(fixture.catalog, supervisor, {});
    const accepted = initializer.start("test-profile", "test-dataset");
    await initializer.waitFor(accepted.id);
    await fixture.catalog.updateStatus(accepted.id, "active");

    await writeFile(
      path.join(fixture.profileRoot, "README.md"),
      "source changed\n",
      "utf8",
    );
    const [profiles, datasets] = await Promise.all([
      loadProfileCatalog(path.join(fixture.root, "profiles")),
      loadDatasetCatalog(path.join(fixture.root, "datasets")),
    ]);
    const recovered = new RuntimeCatalog({
      demoRoot: fixture.root,
      profiles,
      datasets,
    });
    await recovered.initialize();

    expect(recovered.get(accepted.id)?.manifest.status).toBe("ready");
    expect(recovered.list()[0]?.stale).toBe(true);
    expect(recovered.list()[0]?.last_error).toBeNull();
    await supervisor.close();
  });

  it("atomically reloads complete source catalogs and updates stale state", async () => {
    fixture = await createDemoFixture();
    const supervisor = new RuntimeSupervisor();
    const initializer = new RuntimeInitializer(fixture.catalog, supervisor, {});
    const accepted = initializer.start("test-profile", "test-dataset");
    await initializer.waitFor(accepted.id);
    const oldProfile = fixture.catalog.profiles.get("test-profile");
    const oldDataset = fixture.catalog.datasets.get("test-dataset");

    await Promise.all([
      writeFile(
        path.join(fixture.profileRoot, "README.md"),
        "new Profile revision bytes\n",
        "utf8",
      ),
      writeFile(
        path.join(fixture.datasetRoot, "ontology.ttl"),
        "@prefix ex: <https://example.test/> .\nex:b a ex:ChangedThing .\n",
        "utf8",
      ),
    ]);
    await Promise.all([
      fixture.catalog.reloadProfiles(path.join(fixture.root, "profiles")),
      fixture.catalog.reloadDatasets(path.join(fixture.root, "datasets")),
    ]);

    expect(fixture.catalog.profiles.get("test-profile")).not.toBe(oldProfile);
    expect(fixture.catalog.datasets.get("test-dataset")).not.toBe(oldDataset);
    expect(fixture.catalog.list()[0]?.stale).toBe(true);
    await supervisor.close();
  });

  it("keeps the previous source maps when a full catalog reload is invalid", async () => {
    fixture = await createDemoFixture();
    const profiles = fixture.catalog.profiles;
    const datasets = fixture.catalog.datasets;
    const badProfile = path.join(fixture.root, "profiles", "bad-profile");
    const badDataset = path.join(fixture.root, "datasets", "bad-dataset");
    await Promise.all([mkdir(badProfile), mkdir(badDataset)]);
    await Promise.all([
      writeFile(path.join(badProfile, "profile.yaml"), "not: valid\n", "utf8"),
      writeFile(path.join(badDataset, "dataset.yaml"), "not: valid\n", "utf8"),
    ]);

    await expect(
      fixture.catalog.reloadProfiles(path.join(fixture.root, "profiles")),
    ).rejects.toThrow();
    await expect(
      fixture.catalog.reloadDatasets(path.join(fixture.root, "datasets")),
    ).rejects.toThrow();
    expect(fixture.catalog.profiles).toBe(profiles);
    expect(fixture.catalog.datasets).toBe(datasets);
  });

  it("serializes status transitions and rejects a stale lifecycle write", async () => {
    fixture = await createDemoFixture();
    const supervisor = new RuntimeSupervisor();
    const initializer = new RuntimeInitializer(fixture.catalog, supervisor, {});
    const accepted = initializer.start("test-profile", "test-dataset");
    await initializer.waitFor(accepted.id);

    const activating = fixture.catalog.updateStatus(
      accepted.id,
      "active",
      null,
      ["ready"],
    );
    const deleting = fixture.catalog.updateStatus(
      accepted.id,
      "deleting",
      null,
      ["active"],
    );
    await Promise.all([activating, deleting]);
    await expect(
      fixture.catalog.updateStatus(
        accepted.id,
        "ready",
        null,
        ["active"],
      ),
    ).rejects.toThrow(/has status "deleting"/);
    expect(fixture.catalog.get(accepted.id)?.manifest.status).toBe("deleting");
    expect(
      (await readFile(
        path.join(fixture.catalog.get(accepted.id)!.root, "runtime.yaml"),
        "utf8",
      )).includes("status: deleting"),
    ).toBe(true);
    await supervisor.close();
  });

  it("serializes revalidation with status writes so stale data cannot win", async () => {
    fixture = await createDemoFixture();
    const supervisor = new RuntimeSupervisor();
    const initializer = new RuntimeInitializer(fixture.catalog, supervisor, {});
    const accepted = initializer.start("test-profile", "test-dataset");
    await initializer.waitFor(accepted.id);
    const entered = deferred<void>();
    const release = deferred<void>();
    const guarded = new RuntimeCatalog({
      demoRoot: fixture.root,
      profiles: [...fixture.catalog.profiles.values()],
      datasets: [...fixture.catalog.datasets.values()],
      revalidateRuntime: async (runtime) => {
        entered.resolve(undefined);
        await release.promise;
        return runtime;
      },
    });
    await guarded.initialize();

    const revalidating = guarded.revalidateLoaded(accepted.id);
    await entered.promise;
    const activating = guarded.updateStatus(
      accepted.id,
      "active",
      null,
      ["ready"],
    );
    release.resolve(undefined);
    await revalidating;
    await activating;

    expect(guarded.get(accepted.id)?.manifest.status).toBe("active");
    await supervisor.close();
  });

  it("does not resurrect a removed record after an in-flight refresh", async () => {
    fixture = await createDemoFixture();
    const supervisor = new RuntimeSupervisor();
    const initializer = new RuntimeInitializer(fixture.catalog, supervisor, {});
    const accepted = initializer.start("test-profile", "test-dataset");
    await initializer.waitFor(accepted.id);
    const loaded = fixture.catalog.getLoaded(accepted.id)!;
    const entered = deferred<void>();
    const release = deferred<void>();
    const guarded = new RuntimeCatalog({
      demoRoot: fixture.root,
      profiles: [...fixture.catalog.profiles.values()],
      datasets: [...fixture.catalog.datasets.values()],
      refreshRuntime: async () => {
        entered.resolve(undefined);
        await release.promise;
        return loaded;
      },
    });
    await guarded.initialize();

    const refreshing = guarded.refreshLoaded(accepted.id);
    await entered.promise;
    guarded.remove(accepted.id);
    release.resolve(undefined);

    await expect(refreshing).rejects.toBeInstanceOf(
      RuntimeRecordConflictError,
    );
    expect(guarded.get(accepted.id)).toBeUndefined();
    await supervisor.close();
  });

  it("never promotes an interrupted ready staging candidate", async () => {
    fixture = await createDemoFixture();
    const supervisor = new RuntimeSupervisor();
    const initializer = new RuntimeInitializer(fixture.catalog, supervisor, {});
    const accepted = initializer.start("test-profile", "test-dataset");
    await initializer.waitFor(accepted.id);
    const project = fixture.catalog.get(accepted.id)!.root;
    const staged = path.join(
      fixture.catalog.stagingRoot,
      `${accepted.id}--aaaaaaaaaaaaaaaa`,
    );
    await rename(project, staged);

    const recovered = new RuntimeCatalog({
      demoRoot: fixture.root,
      profiles: [...fixture.catalog.profiles.values()],
      datasets: [...fixture.catalog.datasets.values()],
    });
    await recovered.initialize();

    expect(recovered.get(accepted.id)?.location).toBe("staging");
    expect(recovered.get(accepted.id)?.manifest.status).toBe(
      "initialization_failed",
    );
    expect(recovered.get(accepted.id)?.manifest.last_error).toEqual({
      code: "initialization_interrupted",
    });
    await supervisor.close();
  });

  it("does not let Runtime deletion overtake Session process registration", async () => {
    fixture = await createDemoFixture();
    const supervisor = new RuntimeSupervisor();
    const initializer = new RuntimeInitializer(fixture.catalog, supervisor, {});
    const accepted = initializer.start("test-profile", "test-dataset");
    await initializer.waitFor(accepted.id);
    expect(fixture.catalog.beginSessionMaintenance(accepted.id)).toBe(true);
    let sessionProcessStopped = false;
    const deletion = new RuntimeDeleteService(
      fixture.catalog,
      initializer,
      { closeRuntime: async () => undefined },
      {
        stopRuntime: async () => {
          sessionProcessStopped = true;
        },
      },
    );

    await expect(deletion.delete(accepted.id)).rejects.toMatchObject({
      kind: "busy",
    });
    expect(sessionProcessStopped).toBe(false);
    expect(fixture.catalog.get(accepted.id)).toBeDefined();

    fixture.catalog.endOperation(accepted.id, "session");
    await deletion.delete(accepted.id);
    await deletion.close();

    expect(fixture.catalog.get(accepted.id)).toBeUndefined();
    expect(sessionProcessStopped).toBe(true);
    await expect(
      access(path.join(fixture.profileRoot, "profile.yaml")),
    ).resolves.toBeUndefined();
    await expect(
      access(path.join(fixture.datasetRoot, "ontology.ttl")),
    ).resolves.toBeUndefined();
    await supervisor.close();
  });

  it("refuses a symlink-swapped Runtime root without touching its target", async () => {
    fixture = await createDemoFixture();
    const supervisor = new RuntimeSupervisor();
    const initializer = new RuntimeInitializer(fixture.catalog, supervisor, {});
    const accepted = initializer.start("test-profile", "test-dataset");
    await initializer.waitFor(accepted.id);
    const record = fixture.catalog.get(accepted.id)!;
    const held = `${record.root}-held`;
    const external = path.join(fixture.root, "external-target");
    await mkdir(external);
    await writeFile(path.join(external, "sentinel.txt"), "preserve\n", "utf8");
    await rename(record.root, held);
    await symlink(external, record.root, "dir");
    const deletion = new RuntimeDeleteService(
      fixture.catalog,
      initializer,
      { closeRuntime: async () => undefined },
      { stopRuntime: async () => undefined },
    );

    await expect(deletion.delete(accepted.id)).rejects.toMatchObject({
      kind: "failed",
    });
    expect(await readFile(path.join(external, "sentinel.txt"), "utf8")).toBe(
      "preserve\n",
    );
    expect(
      (await readFile(path.join(held, "runtime.yaml"), "utf8")).includes(
        "status: ready",
      ),
    ).toBe(true);
    expect(fixture.catalog.get(accepted.id)?.manifest.status).toBe(
      "delete_failed",
    );
    await deletion.close();
    await supervisor.close();
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
