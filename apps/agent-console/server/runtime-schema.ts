export const RUNTIME_V1_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://ontology.local/schemas/runtime-v1.schema.json",
  title: "Ontology Runtime v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "id",
    "display_name",
    "status",
    "created_at",
    "profile",
    "dataset",
    "paths",
    "last_error",
  ],
  properties: {
    schema_version: { const: 1 },
    id: { $ref: "#/$defs/runtimeId" },
    display_name: { type: "string", minLength: 1, maxLength: 321 },
    status: {
      enum: [
        "initializing",
        "ready",
        "active",
        "initialization_failed",
        "deleting",
        "delete_failed",
      ],
    },
    created_at: {
      type: "string",
      minLength: 20,
      maxLength: 40,
      pattern: "^\\d{4}-\\d{2}-\\d{2}T",
    },
    profile: {
      type: "object",
      additionalProperties: false,
      required: ["id", "revision", "snapshot_sha256"],
      properties: {
        id: { $ref: "#/$defs/id" },
        title: { type: "string", minLength: 1, maxLength: 160 },
        revision: {
          type: "string",
          minLength: 1,
          maxLength: 64,
          pattern: "^[a-z0-9][a-z0-9._-]*$",
        },
        snapshot_sha256: { $ref: "#/$defs/sha256" },
      },
    },
    dataset: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "ontology_file",
        "snapshot_sha256",
        "ontology_sha256",
      ],
      properties: {
        id: { $ref: "#/$defs/id" },
        title: { type: "string", minLength: 1, maxLength: 160 },
        ontology_file: {
          type: "string",
          minLength: 5,
          maxLength: 255,
          pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*\\.ttl$",
        },
        snapshot_sha256: { $ref: "#/$defs/sha256" },
        ontology_sha256: { $ref: "#/$defs/sha256" },
      },
    },
    paths: {
      type: "object",
      additionalProperties: false,
      required: [
        "workspace",
        "profile",
        "dataset",
        "generated",
        "opencode_db",
        "opencode_config",
        "state",
      ],
      properties: {
        workspace: { const: "workspace" },
        profile: { const: "workspace/profile" },
        dataset: { const: "workspace/dataset" },
        generated: { const: "workspace/generated" },
        opencode_db: { const: "opencode/opencode.db" },
        opencode_config: { const: "opencode/config" },
        state: { const: "state" },
      },
    },
    last_error: {
      oneOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["code"],
          properties: {
            code: {
              type: "string",
              minLength: 1,
              maxLength: 64,
              pattern: "^[a-z0-9_]+$",
            },
          },
        },
      ],
    },
  },
  $defs: {
    id: {
      type: "string",
      minLength: 1,
      maxLength: 64,
      pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    },
    runtimeId: {
      type: "string",
      minLength: 4,
      maxLength: 130,
      pattern:
        "^[a-z0-9]+(?:-[a-z0-9]+)*--[a-z0-9]+(?:-[a-z0-9]+)*$",
    },
    sha256: {
      type: "string",
      pattern: "^[a-f0-9]{64}$",
    },
  },
} as const;
