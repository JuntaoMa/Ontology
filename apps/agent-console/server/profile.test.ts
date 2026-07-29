import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
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
      expect(loaded.configAssets).toEqual([
        {
          path: path.join(
            canonicalProjectRoot,
            "profiles",
            "dev",
            "opencode",
            "prompt.md",
          ),
          relativePath: "prompt.md",
        },
      ]);
      expect(loaded.skills[0].path).toBe(
        path.join(
          canonicalProjectRoot,
          "profiles",
          "dev",
          "skills",
          "ontology-retrieval",
        ),
      );
      expect(loaded.skillsRoot).toBe(
        path.join(
          canonicalProjectRoot,
          "profiles",
          "dev",
          "skills",
        ),
      );
      expect(loaded.model).toEqual({
        id: "qwen-compatible",
        source: "profile",
        apiBaseEnv: "QWEN_BASE_URL",
        auth: {
          source: "environment",
          apiKeyEnv: "QWEN_API_KEY",
        },
      });
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

  it("loads an OpenCode-managed model without model environment variables", async () => {
    const fixture = await createProfileFixture((profile) => {
      profile.model = {
        id: "deepseek/deepseek-v4-flash",
        source: "opencode",
        auth: { source: "opencode" },
      };
      profile.skills = [];
      delete profile.retrieval;
      profile.environment.required = [];
    });
    try {
      const loaded = await loadProfile(
        fixture.profilePath,
        fixture.profilesRoot,
      );
      expect(loaded.model).toEqual({
        id: "deepseek/deepseek-v4-flash",
        source: "opencode",
        auth: { source: "opencode" },
      });
      expect(loaded.skills).toEqual([]);
      expect(loaded.skillsRoot).toBeUndefined();
      expect(loaded.retrieval).toBeUndefined();
      expect(getMissingRequiredEnvironment(loaded, {})).toEqual([]);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it("requires profile-hosted model endpoints to declare api_base", async () => {
    const fixture = await createProfileFixture((profile) => {
      profile.model = {
        id: "qwen-compatible/model",
        source: "profile",
        auth: { source: "opencode" },
      } as ProfileV1["model"];
    });
    try {
      await expect(
        loadProfile(fixture.profilePath, fixture.profilesRoot),
      ).rejects.toThrow(/api_base|schema validation/i);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects OpenCode assets outside the declared config directory", async () => {
    const fixture = await createProfileFixture((profile) => {
      profile.opencode.assets = [
        "skills/ontology-retrieval/SKILL.md",
      ];
    });
    try {
      await expect(
        loadProfile(fixture.profilePath, fixture.profilesRoot),
      ).rejects.toThrow(/assets.*config directory/i);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects symbolic-link OpenCode assets", async () => {
    const fixture = await createProfileFixture();
    const linkPath = path.join(
      fixture.profileDirectory,
      "opencode",
      "linked-prompt.md",
    );
    try {
      await symlink(
        path.join(fixture.profileDirectory, "opencode", "prompt.md"),
        linkPath,
        "file",
      );
      fixture.profile.opencode.assets = [
        "opencode/linked-prompt.md",
      ];
      await writeFile(
        fixture.profilePath,
        await profileYaml(fixture.profile),
        "utf8",
      );
      await expect(
        loadProfile(fixture.profilePath, fixture.profilesRoot),
      ).rejects.toThrow(/non-symlink|must be a regular/i);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it("requires all declared Skill directories to share one parent", async () => {
    const fixture = await createProfileFixture();
    const secondSkillDirectory = path.join(
      fixture.profileDirectory,
      "other-skills",
      "second-skill",
    );
    try {
      await mkdir(secondSkillDirectory, { recursive: true });
      await writeFile(
        path.join(secondSkillDirectory, "SKILL.md"),
        "---\nname: second-skill\ndescription: Test\n---\n",
        "utf8",
      );
      fixture.profile.skills.push({
        id: "second-skill",
        path: "other-skills/second-skill",
      });
      await writeFile(
        fixture.profilePath,
        await profileYaml(fixture.profile),
        "utf8",
      );
      await expect(
        loadProfile(fixture.profilePath, fixture.profilesRoot),
      ).rejects.toThrow(/same parent directory/i);
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
    '{ "$schema": "https://opencode.ai/config.json", "agent": { "test": { "prompt": "{file:./prompt.md}" } } }\n',
    "utf8",
  );
  await writeFile(
    path.join(configDirectory, "prompt.md"),
    "# Test Agent\n",
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
