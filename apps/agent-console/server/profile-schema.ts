export const PROFILE_V1_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://ontology.local/schemas/agent-profile-v1.schema.json",
  title: "Ontology Agent Profile v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "id",
    "revision",
    "title",
    "description",
    "mutable",
    "runtime",
    "opencode",
    "model",
    "skills",
    "ontology",
    "environment",
  ],
  properties: {
    schema_version: { const: 1 },
    id: { $ref: "#/$defs/profileId" },
    revision: {
      type: "string",
      minLength: 1,
      maxLength: 64,
      pattern: "^[a-z0-9][a-z0-9._-]*$",
    },
    title: { type: "string", minLength: 1, maxLength: 160 },
    description: { type: "string", minLength: 1, maxLength: 2_000 },
    mutable: { type: "boolean" },
    runtime: {
      type: "object",
      additionalProperties: false,
      required: ["command", "args", "cwd", "state_dir", "startup_timeout_ms"],
      properties: {
        command: { $ref: "#/$defs/nonEmptySingleLine" },
        args: {
          type: "array",
          maxItems: 32,
          items: { $ref: "#/$defs/singleLine" },
        },
        cwd: { $ref: "#/$defs/relativePath" },
        state_dir: { $ref: "#/$defs/relativePath" },
        startup_timeout_ms: {
          type: "integer",
          minimum: 1_000,
          maximum: 120_000,
        },
      },
    },
    opencode: {
      type: "object",
      additionalProperties: false,
      required: ["config"],
      properties: {
        config: { $ref: "#/$defs/relativePath" },
        assets: {
          type: "array",
          minItems: 1,
          maxItems: 32,
          uniqueItems: true,
          items: { $ref: "#/$defs/relativePath" },
        },
      },
    },
    model: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["id", "source", "auth"],
          properties: {
            id: { $ref: "#/$defs/modelId" },
            source: { const: "opencode" },
            auth: { $ref: "#/$defs/modelAuth" },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["id", "source", "api_base", "auth"],
          properties: {
            id: { $ref: "#/$defs/modelId" },
            source: { const: "profile" },
            api_base: { $ref: "#/$defs/envRef" },
            auth: { $ref: "#/$defs/modelAuth" },
          },
        },
      ],
    },
    skills: {
      type: "array",
      minItems: 0,
      maxItems: 64,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "path"],
        properties: {
          id: { $ref: "#/$defs/profileId" },
          path: { $ref: "#/$defs/relativePath" },
        },
      },
    },
    retrieval: {
      type: "object",
      additionalProperties: false,
      required: ["endpoint", "vector_top_k", "graph_algorithm"],
      properties: {
        endpoint: { $ref: "#/$defs/envRef" },
        vector_top_k: { type: "integer", minimum: 1, maximum: 100 },
        graph_algorithm: {
          type: "string",
          minLength: 1,
          maxLength: 80,
          pattern: "^[a-z][a-z0-9_]*$",
        },
      },
    },
    ontology: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: {
          type: "string",
          minLength: 1,
          maxLength: 160,
          pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$",
        },
        sha256: { $ref: "#/$defs/sha256" },
      },
    },
    environment: {
      type: "object",
      additionalProperties: false,
      required: ["required"],
      properties: {
        required: {
          type: "array",
          minItems: 0,
          maxItems: 128,
          uniqueItems: true,
          items: { $ref: "#/$defs/envName" },
        },
      },
    },
  },
  $defs: {
    profileId: {
      type: "string",
      minLength: 1,
      maxLength: 64,
      pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    },
    envName: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Z_][A-Z0-9_]*$",
    },
    envRef: {
      type: "object",
      additionalProperties: false,
      required: ["env"],
      properties: {
        env: { $ref: "#/$defs/envName" },
      },
    },
    modelId: {
      type: "string",
      minLength: 1,
      maxLength: 160,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._/-]*$",
    },
    modelAuth: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["source"],
          properties: {
            source: { const: "opencode" },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["source", "api_key"],
          properties: {
            source: { const: "environment" },
            api_key: { $ref: "#/$defs/envRef" },
          },
        },
      ],
    },
    singleLine: {
      type: "string",
      maxLength: 4_096,
      pattern: "^[^\\u0000\\r\\n]*$",
    },
    nonEmptySingleLine: {
      type: "string",
      minLength: 1,
      maxLength: 4_096,
      pattern: "^[^\\u0000\\r\\n]+$",
    },
    relativePath: {
      type: "string",
      minLength: 1,
      maxLength: 1_024,
      pattern: "^[^\\u0000\\r\\n]+$",
    },
    sha256: {
      type: "string",
      pattern: "^[a-f0-9]{64}$",
    },
  },
} as const;

export const PROFILE_LOCK_V1_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://ontology.local/schemas/agent-profile-lock-v1.schema.json",
  title: "Ontology Agent Profile publication lock v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "profile_id",
    "profile_revision",
    "created_at",
    "files",
    "external_inputs",
  ],
  properties: {
    schema_version: { const: 1 },
    profile_id: { $ref: "https://ontology.local/schemas/agent-profile-v1.schema.json#/$defs/profileId" },
    profile_revision: {
      type: "string",
      minLength: 1,
      maxLength: 64,
      pattern: "^[a-z0-9][a-z0-9._-]*$",
    },
    created_at: {
      type: "string",
      pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$",
    },
    files: {
      type: "array",
      minItems: 1,
      maxItems: 256,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "sha256", "size"],
        properties: {
          path: {
            type: "string",
            minLength: 1,
            maxLength: 1_024,
            pattern: "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))[^\\u0000\\r\\n]+$",
          },
          sha256: {
            type: "string",
            pattern: "^[a-f0-9]{64}$",
          },
          size: {
            type: "integer",
            minimum: 0,
            maximum: 262_144,
          },
        },
      },
    },
    external_inputs: {
      type: "object",
      additionalProperties: false,
      required: ["ontology"],
      properties: {
        ontology: {
          type: "object",
          additionalProperties: false,
          required: ["id", "sha256"],
          properties: {
            id: {
              type: "string",
              minLength: 1,
              maxLength: 160,
              pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$",
            },
            sha256: {
              type: "string",
              pattern: "^[a-f0-9]{64}$",
            },
          },
        },
      },
    },
  },
} as const;
