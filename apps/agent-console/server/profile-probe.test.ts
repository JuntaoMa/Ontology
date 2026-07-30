import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { describe, expect, it } from "vitest";
import type { AcpSmokeResult } from "./acp-probe.js";
import {
  inferProfilesRoot,
  probeAcpProfile,
} from "./profile-probe.js";
import type { LoadedProfile, ProfileV1 } from "./profile.js";

const SMOKE_RESULT: AcpSmokeResult = {
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

interface ProbeFixture {
  projectRoot: string;
  profilesRoot: string;
  profileDirectory: string;
  profilePath: string;
}

describe("Agent Profile ACP smoke test", () => {
  it("uses the fixed Profile runtime and a disposable config overlay", async () => {
    const fixture = await createProbeFixture();
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
    let capturedProfile: LoadedProfile | undefined;
    let capturedEnvironment: NodeJS.ProcessEnv | undefined;
    let overlayDirectory = "";

    try {
      const result = await probeAcpProfile(
        fixture.profilePath,
        {
          environment: sourceEnvironment,
          smoke: async (profile, environment) => {
            capturedProfile = profile;
            capturedEnvironment = environment;
            overlayDirectory = environment.OPENCODE_CONFIG_DIR ?? "";
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
            return SMOKE_RESULT;
          },
        },
      );

      expect(result).toEqual(SMOKE_RESULT);
      expect(capturedProfile?.runtime.command).toBe(
        await realpath(process.execPath),
      );
      expect(capturedProfile?.runtime.args).toEqual(["--version"]);
      expect(capturedProfile?.runtime.cwd).toBe(canonicalProjectRoot);

      expect(capturedEnvironment).toMatchObject({
        HOME: "/tmp/profile-probe-home",
        QWEN_BASE_URL: "https://model.example.com/v1",
        QWEN_API_KEY: "profile-secret-key",
        OAG_BASE_URL: "http://127.0.0.1:8010",
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
      expect(capturedEnvironment?.HOST_ONLY_VALUE).toBeUndefined();
      expect(capturedEnvironment?.ONTOLOGY_EXPECTED_SHA256).toBeUndefined();
      expect(capturedEnvironment?.OPENCODE_CONFIG_DIR).toBe(overlayDirectory);

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
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it("fails before launching when a derived Profile variable is missing", async () => {
    const fixture = await createProbeFixture();
    let launched = false;

    try {
      await expect(
        probeAcpProfile(
          fixture.profilePath,
          {
            environment: {
              QWEN_BASE_URL: "https://model.example.com/v1",
              OAG_BASE_URL: "http://127.0.0.1:8010",
            },
            smoke: async () => {
              launched = true;
              return SMOKE_RESULT;
            },
          },
        ),
      ).rejects.toThrow(/QWEN_API_KEY/);
      expect(launched).toBe(false);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it("infers the conventional profiles catalog", async () => {
    const fixture = await createProbeFixture();
    try {
      expect(await inferProfilesRoot(fixture.profilePath)).toBe(
        await realpath(fixture.profilesRoot),
      );
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });
});

async function createProbeFixture(): Promise<ProbeFixture> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "profile-probe-"));
  const profilesRoot = path.join(projectRoot, "profiles");
  const profileDirectory = path.join(profilesRoot, "dev");
  const configDirectory = path.join(profileDirectory, "opencode");
  const skillDirectory = path.join(
    profileDirectory,
    "skills",
    "ontology-retrieval",
  );
  await mkdir(configDirectory, { recursive: true });
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(
    path.join(configDirectory, "opencode.jsonc"),
    '{ "$schema": "https://opencode.ai/config.json" }\n',
    "utf8",
  );
  await writeFile(
    path.join(configDirectory, "prompt.md"),
    "# Test Agent\n",
    "utf8",
  );
  await writeFile(
    path.join(skillDirectory, "SKILL.md"),
    "---\nname: ontology-retrieval\ndescription: Test\n---\n",
    "utf8",
  );

  const profile: ProfileV1 = {
    schema_version: 1,
    id: "dev",
    revision: "dev",
    title: "Development",
    description: "Profile smoke test fixture",
    runtime: {
      command: process.execPath,
      args: ["--version"],
      cwd: "../..",
      startup_timeout_ms: 15_000,
    },
    opencode: {
      config: "opencode/opencode.jsonc",
      assets: ["opencode/prompt.md"],
    },
    model: {
      id: "qwen-compatible",
      source: "profile",
      api_base: { env: "QWEN_BASE_URL" },
      auth: {
        source: "environment",
        api_key: { env: "QWEN_API_KEY" },
      },
    },
    skills: [
      {
        id: "ontology-retrieval",
        path: "skills/ontology-retrieval",
      },
    ],
    retrieval: {
      endpoint: { env: "OAG_BASE_URL" },
      vector_top_k: 5,
      graph_algorithm: "minimum_connected_subgraph",
    },
    ontology: { id: "smart-building-sample" },
  };
  const profilePath = path.join(profileDirectory, "profile.yaml");
  await writeFile(
    profilePath,
    stringify(profile, { lineWidth: 0, sortMapEntries: false }),
    "utf8",
  );
  return {
    projectRoot,
    profilesRoot,
    profileDirectory,
    profilePath,
  };
}
