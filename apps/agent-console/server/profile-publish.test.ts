import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadProfile } from "./profile.js";
import {
  assertNoSensitiveText,
  publishProfile,
} from "./profile-publish.js";
import {
  createPublishFixture,
  removePublishFixture,
} from "./profile-publish.test-fixture.js";

const ONTOLOGY_SHA256 = "a".repeat(64);

describe("Agent Profile publication", () => {
  it.each([
    "http://[::1]/api",
    "http://100.64.0.1/api",
    "http://0.0.0.0/api",
    "http://service.lan/api",
  ])("rejects non-portable network address %s", (url) => {
    expect(() => assertNoSensitiveText(`endpoint: ${url}`, "config")).toThrow(
      /private network address/i,
    );
  });

  it("creates an immutable, checksum-verified, self-contained control bundle", async () => {
    const fixture = await createPublishFixture();
    try {
      const published = await publishProfile({
        sourceProfilePath: fixture.profilePath,
        profilesRoot: fixture.profilesRoot,
        releaseId: "baseline-v1",
        revision: "2026.07.1",
        ontologySha256: ONTOLOGY_SHA256,
        createdAt: new Date("2026-07-27T00:00:00.000Z"),
      });

      expect(published.profile).toMatchObject({
        id: "baseline-v1",
        revision: "2026.07.1",
        mutable: false,
      });
      expect(published.lock.external_inputs.ontology).toEqual({
        id: "smart-building-sample",
        sha256: ONTOLOGY_SHA256,
      });
      expect(published.lock.files.map((entry) => entry.path)).toEqual([
        "opencode/opencode.jsonc",
        "opencode/prompt.md",
        "profile.yaml",
        "skills/ontology-retrieval/scripts/retrieve.py",
        "skills/ontology-retrieval/SKILL.md",
      ]);

      const publishedYaml = await readFile(
        path.join(published.bundlePath, "profile.yaml"),
        "utf8",
      );
      expect(publishedYaml).toContain("mutable: false");
      expect(publishedYaml).not.toContain("secret-value");
      await expect(
        loadProfile(
          path.join(published.bundlePath, "profile.yaml"),
          fixture.profilesRoot,
        ),
      ).resolves.toMatchObject({ id: "baseline-v1", mutable: false });
    } finally {
      await removePublishFixture(fixture);
    }
  });

  it("creates and uses the canonical releases directory directly below profilesRoot", async () => {
    const fixture = await createPublishFixture();
    try {
      const published = await publishProfile({
        sourceProfilePath: fixture.profilePath,
        profilesRoot: fixture.profilesRoot,
        releaseId: "canonical-v1",
        ontologySha256: ONTOLOGY_SHA256,
      });

      const canonicalProfilesRoot = await realpath(fixture.profilesRoot);
      const canonicalReleasesRoot = await realpath(
        path.join(fixture.profilesRoot, "releases"),
      );
      expect(canonicalReleasesRoot).toBe(
        path.join(canonicalProfilesRoot, "releases"),
      );
      expect(path.dirname(published.bundlePath)).toBe(canonicalReleasesRoot);
    } finally {
      await removePublishFixture(fixture);
    }
  });

  it("rejects a symbolic-link releasesRoot without publishing through it", async () => {
    const fixture = await createPublishFixture();
    try {
      const outsideRoot = path.join(fixture.projectRoot, "outside-releases");
      const releasesRoot = path.join(fixture.profilesRoot, "releases");
      await mkdir(outsideRoot);
      await symlink(
        outsideRoot,
        releasesRoot,
        process.platform === "win32" ? "junction" : "dir",
      );

      await expect(
        publishProfile({
          sourceProfilePath: fixture.profilePath,
          profilesRoot: fixture.profilesRoot,
          releaseId: "escaped-v1",
          ontologySha256: ONTOLOGY_SHA256,
        }),
      ).rejects.toThrow(/releasesRoot.*symbolic link/i);
      await expect(
        lstat(path.join(outsideRoot, "escaped-v1")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await removePublishFixture(fixture);
    }
  });

  it("rejects an existing non-directory releasesRoot", async () => {
    const fixture = await createPublishFixture();
    try {
      await writeFile(
        path.join(fixture.profilesRoot, "releases"),
        "not a directory\n",
        "utf8",
      );

      await expect(
        publishProfile({
          sourceProfilePath: fixture.profilePath,
          profilesRoot: fixture.profilesRoot,
          releaseId: "blocked-v1",
          ontologySha256: ONTOLOGY_SHA256,
        }),
      ).rejects.toThrow(/releasesRoot is not a directory/i);
    } finally {
      await removePublishFixture(fixture);
    }
  });

  it("rejects secret values in copied configuration", async () => {
    const fixture = await createPublishFixture();
    try {
      await writeFile(
        path.join(fixture.profileDirectory, "opencode", "opencode.jsonc"),
        '{ "api_key": "plain-text-credential" }\n',
        "utf8",
      );
      await expect(
        publishProfile({
          sourceProfilePath: fixture.profilePath,
          profilesRoot: fixture.profilesRoot,
          releaseId: "unsafe-v1",
          ontologySha256: ONTOLOGY_SHA256,
        }),
      ).rejects.toThrow(/credential value|environment reference/i);
    } finally {
      await removePublishFixture(fixture);
    }
  });

  it("rejects secret values in declared OpenCode assets", async () => {
    const fixture = await createPublishFixture();
    try {
      await writeFile(
        path.join(fixture.profileDirectory, "opencode", "prompt.md"),
        "Use api_key: plain-text-credential\n",
        "utf8",
      );
      await expect(
        publishProfile({
          sourceProfilePath: fixture.profilePath,
          profilesRoot: fixture.profilesRoot,
          releaseId: "unsafe-asset-v1",
          ontologySha256: ONTOLOGY_SHA256,
        }),
      ).rejects.toThrow(/credential value|environment reference/i);
    } finally {
      await removePublishFixture(fixture);
    }
  });

  it("ignores OpenCode bootstrap files beside the declared config source", async () => {
    const fixture = await createPublishFixture();
    try {
      await writeFile(
        path.join(fixture.profileDirectory, "opencode", ".gitignore"),
        "node_modules\npackage.json\n",
        "utf8",
      );
      await writeFile(
        path.join(fixture.profileDirectory, "opencode", "package.json"),
        '{"private":true}\n',
        "utf8",
      );

      const published = await publishProfile({
        sourceProfilePath: fixture.profilePath,
        profilesRoot: fixture.profilesRoot,
        releaseId: "clean-v1",
        ontologySha256: ONTOLOGY_SHA256,
      });

      expect(published.lock.files.map((entry) => entry.path)).not.toContain(
        "opencode/package.json",
      );
      expect(published.lock.files.map((entry) => entry.path)).toContain(
        "opencode/opencode.jsonc",
      );
    } finally {
      await removePublishFixture(fixture);
    }
  });

  it("rejects ontology or data files embedded in a Skill", async () => {
    const fixture = await createPublishFixture();
    try {
      await writeFile(
        path.join(
          fixture.profileDirectory,
          "skills",
          "ontology-retrieval",
          "ontology.ttl",
        ),
        "@prefix ex: <https://example.com/> .\n",
        "utf8",
      );
      await expect(
        publishProfile({
          sourceProfilePath: fixture.profilePath,
          profilesRoot: fixture.profilesRoot,
          releaseId: "data-v1",
          ontologySha256: ONTOLOGY_SHA256,
        }),
      ).rejects.toThrow(/file type is not allowed/i);
    } finally {
      await removePublishFixture(fixture);
    }
  });

  it("never overwrites an existing immutable release", async () => {
    const fixture = await createPublishFixture();
    try {
      const options = {
        sourceProfilePath: fixture.profilePath,
        profilesRoot: fixture.profilesRoot,
        releaseId: "baseline-v1",
        ontologySha256: ONTOLOGY_SHA256,
      };
      await publishProfile(options);
      await expect(publishProfile(options)).rejects.toThrow(
        /already exists|immutable/i,
      );
    } finally {
      await removePublishFixture(fixture);
    }
  });

  it("detects a modified file after publication", async () => {
    const fixture = await createPublishFixture();
    try {
      const published = await publishProfile({
        sourceProfilePath: fixture.profilePath,
        profilesRoot: fixture.profilesRoot,
        releaseId: "tamper-v1",
        ontologySha256: ONTOLOGY_SHA256,
      });
      await writeFile(
        path.join(
          published.bundlePath,
          "skills",
          "ontology-retrieval",
          "SKILL.md",
        ),
        "modified\n",
        "utf8",
      );
      await expect(
        loadProfile(
          path.join(published.bundlePath, "profile.yaml"),
          fixture.profilesRoot,
        ),
      ).rejects.toThrow(/size mismatch|checksum mismatch/i);
    } finally {
      await removePublishFixture(fixture);
    }
  });
});
