import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import type { ProfileV1 } from "./profile.js";

export interface PublishFixture {
  projectRoot: string;
  profilesRoot: string;
  profileDirectory: string;
  profilePath: string;
}

export async function createPublishFixture(): Promise<PublishFixture> {
  const projectRoot = await mkdtemp(
    path.join(tmpdir(), "agent-console-publish-"),
  );
  const profilesRoot = path.join(projectRoot, "profiles");
  const profileDirectory = path.join(profilesRoot, "dev");
  const configDirectory = path.join(profileDirectory, "opencode");
  const skillDirectory = path.join(
    profileDirectory,
    "skills",
    "ontology-retrieval",
  );
  await mkdir(configDirectory, { recursive: true });
  await mkdir(path.join(skillDirectory, "scripts"), { recursive: true });
  await writeFile(
    path.join(configDirectory, "opencode.jsonc"),
    '{ "$schema": "https://opencode.ai/config.json", "agent": { "test": { "prompt": "{file:./prompt.md}" } } }\n',
    "utf8",
  );
  await writeFile(
    path.join(configDirectory, "prompt.md"),
    "# Test Agent\n\nUse the declared ontology retrieval capability.\n",
    "utf8",
  );
  await writeFile(
    path.join(skillDirectory, "SKILL.md"),
    "---\nname: ontology-retrieval\ndescription: Test retrieval Skill\n---\n",
    "utf8",
  );
  await writeFile(
    path.join(skillDirectory, "scripts", "retrieve.py"),
    'print("ONTOLOGY_ARTIFACT:{}")\n',
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
      state_dir: "../../.runtime/opencode/dev",
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

export async function removePublishFixture(
  fixture: PublishFixture,
): Promise<void> {
  await rm(fixture.projectRoot, { recursive: true, force: true });
}
