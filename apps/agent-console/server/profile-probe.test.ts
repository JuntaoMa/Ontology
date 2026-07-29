import {
  readFile,
  readdir,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type {
  AcpProbeOptions,
  AcpProbeResult,
} from "./acp-probe.js";
import {
  inferProfilesRoot,
  probeAcpProfile,
} from "./profile-probe.js";
import {
  createPublishFixture,
  removePublishFixture,
} from "./profile-publish.test-fixture.js";

const PROBE_RESULT: AcpProbeResult = {
  protocolVersion: 1,
  agentCapabilities: {
    loadSession: true,
    sessionCapabilities: { list: {} },
  },
  sessions: {
    count: 2,
    hasMore: false,
  },
};

describe("Agent Profile ACP probe", () => {
  it("uses the fixed Profile runtime and a disposable config overlay", async () => {
    const fixture = await createPublishFixture();
    const canonicalProjectRoot = await realpath(fixture.projectRoot);
    const canonicalProfileDirectory = await realpath(
      fixture.profileDirectory,
    );
    const sourceEnvironment: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: "/tmp/profile-probe-home",
      QWEN_BASE_URL: "https://model.example.com/v1",
      QWEN_API_KEY: "profile-secret-key",
      OAG_BASE_URL: "http://127.0.0.1:8010",
      HOST_ONLY_VALUE: "must-not-be-inherited",
    };
    let captured: AcpProbeOptions | undefined;
    let overlayDirectory = "";

    try {
      const result = await probeAcpProfile(
        fixture.profilePath,
        {
          loadSessionId: "session-existing",
          timeoutMs: 2_500,
        },
        {
          environment: sourceEnvironment,
          probe: async (options) => {
            captured = options;
            overlayDirectory = options.env?.OPENCODE_CONFIG_DIR ?? "";
            expect(overlayDirectory).not.toBe(
              path.join(fixture.profileDirectory, "opencode"),
            );
            expect(
              await readFile(
                path.join(overlayDirectory, "opencode.jsonc"),
                "utf8",
              ),
            ).toContain("https://opencode.ai/config.json");
            expect(
              await readFile(
                path.join(overlayDirectory, "prompt.md"),
                "utf8",
              ),
            ).toContain("Test Agent");
            return PROBE_RESULT;
          },
        },
      );

      expect(result).toEqual(PROBE_RESULT);
      expect(captured).toBeDefined();
      expect(captured?.command).toBe(await realpath(process.execPath));
      expect(captured?.args).toEqual(["--version"]);
      expect(captured?.cwd).toBe(canonicalProjectRoot);
      expect(captured?.loadSessionId).toBe("session-existing");
      expect(captured?.timeoutMs).toBe(2_500);
      expect(captured?.inheritEnvironment).toBe(false);

      const environment = captured?.env;
      expect(environment).toMatchObject({
        HOME: "/tmp/profile-probe-home",
        QWEN_BASE_URL: "https://model.example.com/v1",
        QWEN_API_KEY: "profile-secret-key",
        OAG_BASE_URL: "http://127.0.0.1:8010",
        ONTOLOGY_PROFILE_DIR: canonicalProfileDirectory,
        ONTOLOGY_SKILLS_ROOT: path.join(
          canonicalProfileDirectory,
          "skills",
        ),
        ONTOLOGY_MODEL_ID: "qwen-compatible",
        ONTOLOGY_MODEL_BASE_URL: "https://model.example.com/v1",
        ONTOLOGY_MODEL_API_KEY: "profile-secret-key",
        ONTOLOGY_RETRIEVAL_ENDPOINT: "http://127.0.0.1:8010",
        ONTOLOGY_VECTOR_TOP_K: "5",
        ONTOLOGY_GRAPH_ALGORITHM: "minimum_connected_subgraph",
        ONTOLOGY_ID: "smart-building-sample",
        OPENCODE_DB: path.join(
          canonicalProjectRoot,
          ".runtime",
          "opencode",
          "dev",
          "opencode.db",
        ),
      });
      expect(environment?.HOST_ONLY_VALUE).toBeUndefined();
      expect(environment?.ONTOLOGY_EXPECTED_SHA256).toBeUndefined();
      expect(environment?.OPENCODE_CONFIG_DIR).toBe(overlayDirectory);

      await expect(realpath(overlayDirectory)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(
        await readdir(path.join(fixture.profileDirectory, "opencode")),
      ).toEqual(["opencode.jsonc", "prompt.md"]);
      expect(
        await readdir(
          path.join(fixture.projectRoot, ".runtime", "opencode", "dev"),
        ),
      ).toEqual([]);
    } finally {
      await removePublishFixture(fixture);
    }
  });

  it("fails before launching when a required Profile variable is missing", async () => {
    const fixture = await createPublishFixture();
    let launched = false;

    try {
      await expect(
        probeAcpProfile(
          fixture.profilePath,
          {},
          {
            environment: {
              QWEN_BASE_URL: "https://model.example.com/v1",
              OAG_BASE_URL: "http://127.0.0.1:8010",
            },
            probe: async () => {
              launched = true;
              return PROBE_RESULT;
            },
          },
        ),
      ).rejects.toThrow(/QWEN_API_KEY/);
      expect(launched).toBe(false);
    } finally {
      await removePublishFixture(fixture);
    }
  });

  it("infers the conventional profiles catalog for nested releases", async () => {
    const fixture = await createPublishFixture();
    try {
      expect(await inferProfilesRoot(fixture.profilePath)).toBe(
        await realpath(fixture.profilesRoot),
      );
    } finally {
      await removePublishFixture(fixture);
    }
  });
});
