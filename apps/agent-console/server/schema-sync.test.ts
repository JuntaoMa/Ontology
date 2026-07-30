import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DATASET_V1_SCHEMA } from "./dataset-schema.js";
import { PROFILE_V2_SCHEMA } from "./profile-schema.js";
import { RUNTIME_V1_SCHEMA } from "./runtime-schema.js";

describe("published JSON schemas", () => {
  it.each([
    ["profile-v2.schema.json", PROFILE_V2_SCHEMA],
    ["dataset-v1.schema.json", DATASET_V1_SCHEMA],
    ["runtime-v1.schema.json", RUNTIME_V1_SCHEMA],
  ])("keeps %s synchronized with its validator", async (filename, schema) => {
    const path = fileURLToPath(new URL(`./schemas/${filename}`, import.meta.url));
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(schema);
  });
});
