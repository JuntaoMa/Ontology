import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadDatasetCatalog } from "./dataset.js";
import { loadProfileCatalog } from "./profile.js";
import { RuntimeCatalog } from "./runtime-catalog.js";

export interface DemoFixture {
  root: string;
  profileRoot: string;
  datasetRoot: string;
  catalog: RuntimeCatalog;
  cleanup: () => Promise<void>;
}

export async function createDemoFixture(
  options: {
    initializerScript?: string;
    rawData?: boolean;
    retrieval?: boolean;
  } = {},
): Promise<DemoFixture> {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "agent-console-runtime-")),
  );
  const profileRoot = path.join(root, "profiles", "test-profile");
  const datasetRoot = path.join(root, "datasets", "test-dataset");
  await Promise.all([
    mkdir(path.join(profileRoot, "opencode"), { recursive: true }),
    mkdir(datasetRoot, { recursive: true }),
  ]);
  if (options.rawData) {
    await mkdir(path.join(datasetRoot, "raw_data"));
  }
  await Promise.all([
    writeFile(
      path.join(profileRoot, "profile.yaml"),
      profileYaml(options),
      "utf8",
    ),
    writeFile(
      path.join(profileRoot, "opencode", "opencode.jsonc"),
      "{}\n",
      "utf8",
    ),
    writeFile(
      path.join(datasetRoot, "dataset.yaml"),
      datasetYaml(options.rawData === true),
      "utf8",
    ),
    writeFile(
      path.join(datasetRoot, "ontology.ttl"),
      "@prefix ex: <https://example.test/> .\nex:a a ex:Thing .\n",
      "utf8",
    ),
  ]);
  const [profiles, datasets] = await Promise.all([
    loadProfileCatalog(path.join(root, "profiles")),
    loadDatasetCatalog(path.join(root, "datasets")),
  ]);
  const catalog = new RuntimeCatalog({ demoRoot: root, profiles, datasets });
  await catalog.initialize();
  return {
    root,
    profileRoot,
    datasetRoot,
    catalog,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

function profileYaml(options: {
  initializerScript?: string;
  rawData?: boolean;
  retrieval?: boolean;
}): string {
  return `schema_version: 2
id: test-profile
revision: dev
title: Test Profile
description: A deterministic Runtime test Profile.
agent:
  command: node
  args: ["-e", "process.stdin.resume()"]
  startup_timeout_ms: 1000
opencode:
  config: opencode/opencode.jsonc
${options.initializerScript === undefined ? "" : `initializer:
  command: node
  args: ["-e", ${JSON.stringify(options.initializerScript)}]
  timeout_ms: 2000
`}model:
  id: test/model
  source: opencode
  auth:
    source: opencode
skills: []
${options.retrieval ? `retrieval:
  vector_top_k: 5
  graph_algorithm: minimum_connected_subgraph
` : ""}dataset_contract:
  ontology: required
  raw_data: ${options.rawData ? "required" : "optional"}
`;
}

function datasetYaml(rawData: boolean): string {
  return `schema_version: 1
id: test-dataset
title: Test Dataset
description: A small, fictional Dataset.
ontology_file: ontology.ttl
${rawData ? "raw_data_dir: raw_data\n" : ""}`;
}
