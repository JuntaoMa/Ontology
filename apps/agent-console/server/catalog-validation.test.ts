import {
  mkdir,
  readFile,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DatasetValidationError,
  loadDatasetCatalog,
} from "./dataset.js";
import {
  loadProfileCatalog,
  ProfileValidationError,
  toPublicProfile,
} from "./profile.js";
import { RuntimeCatalog } from "./runtime-catalog.js";
import {
  RuntimeCreateError,
  RuntimeInitializer,
} from "./runtime-initializer.js";
import { RuntimeSupervisor } from "./runtime-supervisor.js";
import { createDemoFixture, type DemoFixture } from "./runtime.test-fixture.js";

describe("Profile and Dataset source Catalogs", () => {
  let fixture: DemoFixture | undefined;

  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
  });

  it("returns a path-free Profile projection", async () => {
    fixture = await createDemoFixture();
    const profile = fixture.catalog.profiles.get("test-profile")!;
    const serialized = JSON.stringify(toPublicProfile(profile));
    expect(JSON.parse(serialized)).toEqual({
      id: "test-profile",
      revision: "dev",
      title: "Test Profile",
      description: "A deterministic Runtime test Profile.",
    });
    expect(serialized).not.toContain(fixture.root);
  });

  it("rejects Dataset binding fields in a shareable Profile", async () => {
    fixture = await createDemoFixture();
    const manifest = path.join(fixture.profileRoot, "profile.yaml");
    await writeFile(
      manifest,
      `${await readFile(manifest, "utf8")}dataset_id: test-dataset\n`,
      "utf8",
    );
    await expect(
      loadProfileCatalog(path.join(fixture.root, "profiles")),
    ).rejects.toBeInstanceOf(ProfileValidationError);
  });

  it("rejects generated Python caches instead of snapshotting them", async () => {
    fixture = await createDemoFixture();
    const cache = path.join(fixture.profileRoot, "tools", "__pycache__");
    await mkdir(cache, { recursive: true });
    await writeFile(path.join(cache, "initialize.cpython-313.pyc"), "cache");

    await expect(
      loadProfileCatalog(path.join(fixture.root, "profiles")),
    ).rejects.toThrow(/source files only.*__pycache__/i);
  });

  it("rejects a symlinked ontology instead of following it", async () => {
    fixture = await createDemoFixture();
    const outside = path.join(fixture.root, "outside.ttl");
    await writeFile(outside, "@prefix ex: <https://outside.test/> .\n", "utf8");
    const ontology = path.join(fixture.datasetRoot, "ontology.ttl");
    await unlink(ontology);
    await symlink(outside, ontology);
    await expect(
      loadDatasetCatalog(path.join(fixture.root, "datasets")),
    ).rejects.toBeInstanceOf(DatasetValidationError);
  });

  it("rejects a Dataset that lacks Profile-required raw_data", async () => {
    fixture = await createDemoFixture();
    const manifest = path.join(fixture.profileRoot, "profile.yaml");
    await writeFile(
      manifest,
      (await readFile(manifest, "utf8")).replace(
        "raw_data: optional",
        "raw_data: required",
      ),
      "utf8",
    );
    const [profiles, datasets] = await Promise.all([
      loadProfileCatalog(path.join(fixture.root, "profiles")),
      loadDatasetCatalog(path.join(fixture.root, "datasets")),
    ]);
    const catalog = new RuntimeCatalog({
      demoRoot: fixture.root,
      profiles,
      datasets,
    });
    await catalog.initialize();
    const supervisor = new RuntimeSupervisor();
    const initializer = new RuntimeInitializer(catalog, supervisor, {});

    expect(() =>
      initializer.start("test-profile", "test-dataset"),
    ).toThrowError(RuntimeCreateError);
    expect(catalog.list()).toEqual([]);
    await supervisor.close();
  });
});
