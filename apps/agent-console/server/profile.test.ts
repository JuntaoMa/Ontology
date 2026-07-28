import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { describe, expect, it } from "vitest";
import {
  getMissingRequiredEnvironment,
  loadProfile,
  loadProfileCatalog,
  toPublicAgent,
  type ProfileV1,
} from "./profile.js";
import {
  PROFILE_LOCK_V1_SCHEMA,
  PROFILE_V1_SCHEMA,
} from "./profile-schema.js";

interface ProfileFixture {
  projectRoot: string;
  profilesRoot: string;
  profileDirectory: string;
  profilePath: string;
  profile: ProfileV1;
}

describe("Agent Profile v1", () => {
  it("keeps the exported JSON Schema artifact in sync", async () => {
    const [profileSchemaText, lockSchemaText] = await Promise.all([
      readFile(
        new URL("./schemas/profile-v1.schema.json", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("./schemas/profile-lock-v1.schema.json", import.meta.url),
        "utf8",
      ),
    ]);
    expect(JSON.parse(profileSchemaText)).toEqual(PROFILE_V1_SCHEMA);
    expect(JSON.parse(lockSchemaText)).toEqual(PROFILE_LOCK_V1_SCHEMA);
  });

  it("loads relative paths and exposes only a redacted public catalog entry", async () => {
    const fixture = await createProfileFixture();
    try {
      const [loaded] = await loadProfileCatalog(fixture.profilesRoot);
      const canonicalProjectRoot = await realpath(fixture.projectRoot);

      expect(loaded.id).toBe("dev");
      expect(loaded.runtime.command).toBe(await realExecutable(process.execPath));
      expect(loaded.runtime.cwd).toBe(canonicalProjectRoot);
      expect(loaded.runtime.stateDir).toBe(
        path.join(canonicalProjectRoot, ".runtime", "opencode", "dev"),
      );
      expect(loaded.runtime.configDir).toBe(
        path.join(
          canonicalProjectRoot,
          "profiles",
          "dev",
          "opencode",
        ),
      );
      expect(loaded.skills[0].path).toBe(
        path.join(
          canonicalProjectRoot,
          "profiles",
          "dev",
          "skills",
          "ontology-retrieval",
        ),
      );
      expect(getMissingRequiredEnvironment(loaded, {})).toEqual([
        "OAG_BASE_URL",
        "QWEN_API_KEY",
        "QWEN_BASE_URL",
      ]);

      const publicAgent = toPublicAgent(loaded, "stopped");
      expect(publicAgent).toEqual({
        id: "dev",
        revision: "dev",
        title: "Ontology RAG Development",
        description: "Mutable local test profile",
        mutable: true,
        status: "stopped",
        ws_url: "/agents/dev/acp",
        cwd: canonicalProjectRoot,
      });
      expect(JSON.stringify(publicAgent)).not.toContain("QWEN_API_KEY");
      expect(JSON.stringify(publicAgent)).not.toContain(loaded.runtime.command);
      expect(JSON.stringify(publicAgent)).not.toContain(loaded.runtime.stateDir);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects unknown keys under the strict schema", async () => {
    const fixture = await createProfileFixture((profile) => {
      (profile.runtime as ProfileV1["runtime"] & { shell?: boolean }).shell = true;
    });
    try {
      await expect(
        loadProfile(fixture.profilePath, fixture.profilesRoot),
      ).rejects.toThrow(/additional properties|schema validation/i);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects environment references omitted from environment.required", async () => {
    const fixture = await createProfileFixture((profile) => {
      profile.environment.required = profile.environment.required.filter(
        (name) => name !== "QWEN_API_KEY",
      );
    });
    try {
      await expect(
        loadProfile(fixture.profilePath, fixture.profilesRoot),
      ).rejects.toThrow(/QWEN_API_KEY/);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ["separate credential flag", ["--api-key", "plain-text-credential"]],
    ["inline credential flag", ["--token=plain-text-credential"]],
  ])("rejects %s in runtime arguments", async (_label, args) => {
    const fixture = await createProfileFixture((profile) => {
      profile.runtime.args = args;
    });
    try {
      await expect(
        loadProfile(fixture.profilePath, fixture.profilesRoot),
      ).rejects.toThrow(/credential-shaped flags/i);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects runtime state outside the project state root", async () => {
    const fixture = await createProfileFixture((profile) => {
      profile.runtime.state_dir = "../../../escaped-state";
    });
    try {
      await expect(
        loadProfile(fixture.profilePath, fixture.profilesRoot),
      ).rejects.toThrow(/runtime\.state_dir must be a child/i);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects YAML aliases", async () => {
    const fixture = await createProfileFixture();
    try {
      const yaml = await profileYaml(fixture.profile);
      await writeFile(
        fixture.profilePath,
        `${yaml}\nalias_probe: &value one\nalias_use: *value\n`,
        "utf8",
      );
      await expect(
        loadProfile(fixture.profilePath, fixture.profilesRoot),
      ).rejects.toThrow(/alias|schema validation/i);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects duplicate catalog ids", async () => {
    const fixture = await createProfileFixture();
    try {
      await createProfileFixture(
        undefined,
        fixture.projectRoot,
        "duplicate",
      );
      await expect(loadProfileCatalog(fixture.profilesRoot)).rejects.toThrow(
        /duplicate profile id/i,
      );
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it("requires a publication lock for immutable profiles", async () => {
    const fixture = await createProfileFixture((profile) => {
      profile.mutable = false;
      profile.ontology.sha256 = "a".repeat(64);
    });
    try {
      await expect(
        loadProfile(fixture.profilePath, fixture.profilesRoot),
      ).rejects.toThrow(/profile lock|does not exist/i);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });
});

async function createProfileFixture(
  mutate?: (profile: ProfileV1) => void,
  existingProjectRoot?: string,
  directoryName = "dev",
): Promise<ProfileFixture> {
  const projectRoot =
    existingProjectRoot ??
    (await mkdtemp(path.join(tmpdir(), "agent-console-profile-")));
  const profilesRoot = path.join(projectRoot, "profiles");
  const profileDirectory = path.join(profilesRoot, directoryName);
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
    path.join(skillDirectory, "SKILL.md"),
    "---\nname: ontology-retrieval\ndescription: Test retrieval Skill\n---\n",
    "utf8",
  );

  const profile: ProfileV1 = {
    schema_version: 1,
    id: "dev",
    revision: "dev",
    title: "Ontology RAG Development",
    description: "Mutable local test profile",
    mutable: true,
    runtime: {
      command: process.execPath,
      args: ["--version"],
      cwd: "../..",
      state_dir: `../../.runtime/opencode/${directoryName}`,
      startup_timeout_ms: 15_000,
    },
    opencode: {
      config: "opencode/opencode.jsonc",
    },
    model: {
      id: "qwen-compatible",
      api_base: { env: "QWEN_BASE_URL" },
      api_key: { env: "QWEN_API_KEY" },
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
    ontology: {
      id: "smart-building-sample",
    },
    environment: {
      required: [
        "QWEN_BASE_URL",
        "QWEN_API_KEY",
        "OAG_BASE_URL",
      ],
    },
  };
  mutate?.(profile);

  const profilePath = path.join(profileDirectory, "profile.yaml");
  await writeFile(profilePath, await profileYaml(profile), "utf8");
  return {
    projectRoot,
    profilesRoot,
    profileDirectory,
    profilePath,
    profile,
  };
}

async function profileYaml(profile: ProfileV1): Promise<string> {
  return stringify(profile, { lineWidth: 0, sortMapEntries: false });
}

async function realExecutable(executable: string): Promise<string> {
  return realpath(executable);
}
