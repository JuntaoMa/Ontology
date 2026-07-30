const commandSpec = {
  type: "object",
  additionalProperties: false,
  required: ["command", "args"],
  properties: {
    command: { $ref: "#/$defs/nonEmptySingleLine" },
    args: {
      type: "array",
      maxItems: 64,
      items: { $ref: "#/$defs/singleLine" },
    },
  },
} as const;
export const PROFILE_V2_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://ontology.local/schemas/agent-profile-v2.schema.json",
  title: "Ontology Agent Profile v2",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "id",
    "revision",
    "title",
    "description",
    "agent",
    "opencode",
    "model",
    "skills",
    "dataset_contract",
  ],
  properties: {
    schema_version: { const: 2 },
    id: { $ref: "#/$defs/id" },
    revision: {
      type: "string",
      minLength: 1,
      maxLength: 64,
      pattern: "^[a-z0-9][a-z0-9._-]*$",
    },
    title: { type: "string", minLength: 1, maxLength: 160 },
    description: { type: "string", minLength: 1, maxLength: 2_000 },
    agent: {
      ...commandSpec,
      required: [...commandSpec.required, "startup_timeout_ms"],
      properties: {
        ...commandSpec.properties,
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
    initializer: {
      ...commandSpec,
      required: [...commandSpec.required, "timeout_ms"],
      properties: {
        ...commandSpec.properties,
        timeout_ms: {
          type: "integer",
          minimum: 1_000,
          maximum: 3_600_000,
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
      maxItems: 64,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "path"],
        properties: {
          id: { $ref: "#/$defs/id" },
          path: { $ref: "#/$defs/relativePath" },
        },
      },
    },
    retrieval: {
      type: "object",
      additionalProperties: false,
      required: ["vector_top_k", "graph_algorithm"],
      properties: {
        vector_top_k: { type: "integer", minimum: 1, maximum: 20 },
        graph_algorithm: { const: "minimum_connected_subgraph" },
      },
    },
    dataset_contract: {
      type: "object",
      additionalProperties: false,
      required: ["ontology", "raw_data"],
      properties: {
        ontology: { const: "required" },
        raw_data: { enum: ["required", "optional"] },
      },
    },
  },
  $defs: {
    id: {
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
  },
} as const;
