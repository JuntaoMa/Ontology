import { mkdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRuntimeManifest,
  readRuntimeManifest,
  toPublicRuntime,
  writeRuntimeManifest,
  type LoadedRuntime,
  type RuntimeRecord,
} from "./runtime-manifest.js";
import { createDemoFixture, type DemoFixture } from "./runtime.test-fixture.js";

describe("Runtime title snapshots", () => {
  let fixture: DemoFixture | undefined;

  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
  });

  it("persists Profile and Dataset titles in new manifests", async () => {
    fixture = await createDemoFixture();
    const profile = fixture.catalog.profiles.get("test-profile")!;
    const dataset = fixture.catalog.datasets.get("test-dataset")!;

    const manifest = createRuntimeManifest(profile, dataset);

    expect(manifest.profile.title).toBe("Test Profile");
    expect(manifest.dataset.title).toBe("Test Dataset");
    expect(
      toPublicRuntime(
        {
          manifest,
          location: "staging",
          root: path.join(fixture.root, "runtime"),
        },
        false,
      ),
    ).toMatchObject({
      profile: { id: "test-profile", title: "Test Profile" },
      dataset: { id: "test-dataset", title: "Test Dataset" },
    });
  });

  it("accepts old manifests and falls back to loaded snapshot titles", async () => {
    fixture = await createDemoFixture();
    const profile = fixture.catalog.profiles.get("test-profile")!;
    const dataset = fixture.catalog.datasets.get("test-dataset")!;
    const manifest = createRuntimeManifest(profile, dataset);
    delete manifest.profile.title;
    delete manifest.dataset.title;

    const runtimeRoot = path.join(fixture.root, "legacy-runtime");
    await mkdir(runtimeRoot);
    await writeRuntimeManifest(runtimeRoot, manifest);
    const legacyManifest = await readRuntimeManifest(
      path.join(runtimeRoot, "runtime.yaml"),
    );
    const record: RuntimeRecord = {
      manifest: legacyManifest,
      location: "projects",
      root: runtimeRoot,
      loaded: {
        profile,
        dataset,
      } as LoadedRuntime,
    };

    expect(toPublicRuntime(record, false)).toMatchObject({
      profile: {
        id: "test-profile",
        title: "Test Profile",
        description: "A deterministic Runtime test Profile.",
      },
      dataset: {
        id: "test-dataset",
        title: "Test Dataset",
        description: "A small, fictional Dataset.",
      },
    });
  });

  it("uses ids when an old partial Runtime has no loaded snapshot", async () => {
    fixture = await createDemoFixture();
    const profile = fixture.catalog.profiles.get("test-profile")!;
    const dataset = fixture.catalog.datasets.get("test-dataset")!;
    const manifest = createRuntimeManifest(profile, dataset);
    delete manifest.profile.title;
    delete manifest.dataset.title;

    expect(
      toPublicRuntime(
        {
          manifest,
          location: "staging",
          root: path.join(fixture.root, "partial-runtime"),
        },
        false,
      ),
    ).toMatchObject({
      profile: { id: "test-profile", title: "test-profile" },
      dataset: { id: "test-dataset", title: "test-dataset" },
    });
  });
});
