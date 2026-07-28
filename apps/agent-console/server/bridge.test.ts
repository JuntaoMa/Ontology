import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildChildEnvironment,
  isAllowedClientMessage,
  redactRuntimeSecrets,
  splitNdjson,
  type BridgeProfile,
} from "./bridge.js";
import { resolveInside } from "./static-files.js";

describe("splitNdjson", () => {
  it("returns complete lines and preserves a partial tail", () => {
    expect(splitNdjson('{"id":1}\n{"id":2}\n{"id"')).toEqual({
      lines: ['{"id":1}', '{"id":2}'],
      remainder: '{"id"',
    });
  });
});

describe("redactRuntimeSecrets", () => {
  it("redacts values from secret-shaped environment variables", () => {
    const result = redactRuntimeSecrets("failed token-value at public-value", {
      API_KEY: "token-value",
      PUBLIC_NAME: "public-value",
    });
    expect(result).toBe("failed [REDACTED] at public-value");
  });
});

describe("Agent Profile child environment", () => {
  it("maps Profile declarations and excludes undeclared host variables", () => {
    const profileDirectory = path.join("/srv", "profiles", "baseline-v1");
    const stateDirectory = path.join("/srv", "state", "baseline-v1");
    const profile: BridgeProfile = {
      id: "baseline-v1",
      title: "Baseline v1",
      profilePath: path.join(profileDirectory, "profile.yaml"),
      configPath: path.join(profileDirectory, "opencode", "opencode.jsonc"),
      runtime: {
        command: "opencode",
        args: ["acp"],
        cwd: "/srv/project",
        stateDir: stateDirectory,
        configDir: path.join(profileDirectory, "opencode"),
        startupTimeoutMs: 15_000,
      },
      requiredEnv: ["QWEN_BASE_URL", "QWEN_API_KEY", "OAG_BASE_URL"],
      model: {
        id: "qwen-compatible/qwen-model",
        apiBaseEnv: "QWEN_BASE_URL",
        apiKeyEnv: "QWEN_API_KEY",
      },
      retrieval: {
        endpointEnv: "OAG_BASE_URL",
        vectorTopK: 5,
        graphAlgorithm: "minimum_connected_subgraph",
      },
      ontology: {
        id: "smart-building-sample",
        sha256: "a".repeat(64),
      },
    };

    const environment = buildChildEnvironment(
      profile,
      path.join(stateDirectory, "config"),
      {
        PATH: "/usr/bin",
        QWEN_BASE_URL: "https://model.example.com/v1",
        QWEN_API_KEY: "secret-key",
        OAG_BASE_URL: "http://127.0.0.1:8010",
        UNDECLARED_SECRET: "must-not-be-inherited",
      },
    );

    expect(environment).toMatchObject({
      PATH: "/usr/bin",
      QWEN_BASE_URL: "https://model.example.com/v1",
      QWEN_API_KEY: "secret-key",
      OAG_BASE_URL: "http://127.0.0.1:8010",
      OPENCODE_DB: path.join(stateDirectory, "opencode.db"),
      OPENCODE_CONFIG_DIR: path.join(stateDirectory, "config"),
      ONTOLOGY_PROFILE_DIR: profileDirectory,
      ONTOLOGY_MODEL_ID: "qwen-compatible/qwen-model",
      ONTOLOGY_MODEL_BASE_URL: "https://model.example.com/v1",
      ONTOLOGY_MODEL_API_KEY: "secret-key",
      ONTOLOGY_RETRIEVAL_ENDPOINT: "http://127.0.0.1:8010",
      ONTOLOGY_VECTOR_TOP_K: "5",
      ONTOLOGY_GRAPH_ALGORITHM: "minimum_connected_subgraph",
      ONTOLOGY_ID: "smart-building-sample",
      ONTOLOGY_EXPECTED_SHA256: "a".repeat(64),
    });
    expect(environment.UNDECLARED_SECRET).toBeUndefined();
  });
});

describe("resolveInside", () => {
  it("rejects path traversal outside the static root", () => {
    expect(resolveInside("/tmp/static", "../secret")).toBeNull();
    expect(resolveInside("/tmp/static", "assets/app.js")).toBe(
      "/tmp/static/assets/app.js",
    );
  });
});

describe("Agent Profile request gate", () => {
  const cwd = "/srv/ontology-demo";

  it("allows the fixed cwd without injected MCP servers", () => {
    expect(
      isAllowedClientMessage(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "session/new",
          params: { cwd, mcpServers: [] },
        }),
        cwd,
      ),
    ).toBe(true);
  });

  it("rejects cwd changes and client-provided MCP servers", () => {
    expect(
      isAllowedClientMessage(
        JSON.stringify({
          method: "session/load",
          params: { cwd: "/tmp/other", mcpServers: [] },
        }),
        cwd,
      ),
    ).toBe(false);
    expect(
      isAllowedClientMessage(
        JSON.stringify({
          method: "session/new",
          params: {
            cwd,
            mcpServers: [{ name: "injected", command: "sh", args: [] }],
          },
        }),
        cwd,
      ),
    ).toBe(false);
  });

  it("allows resume and fork only in the fixed cwd", () => {
    expect(
      isAllowedClientMessage(
        JSON.stringify({
          method: "session/resume",
          params: { cwd, sessionId: "session-1" },
        }),
        cwd,
      ),
    ).toBe(true);
    expect(
      isAllowedClientMessage(
        JSON.stringify({
          method: "session/fork",
          params: { cwd, sessionId: "session-1", mcpServers: [] },
        }),
        cwd,
      ),
    ).toBe(true);
    expect(
      isAllowedClientMessage(
        JSON.stringify({
          method: "session/resume",
          params: {
            cwd: "/tmp/other",
            sessionId: "session-1",
            mcpServers: [],
          },
        }),
        cwd,
      ),
    ).toBe(false);
    expect(
      isAllowedClientMessage(
        JSON.stringify({
          method: "session/fork",
          params: {
            cwd: "/tmp/other",
            sessionId: "session-1",
          },
        }),
        cwd,
      ),
    ).toBe(false);
  });

  it("rejects client-provided MCP servers on resume and fork", () => {
    const injectedServer = {
      name: "injected",
      command: "sh",
      args: [],
    };
    expect(
      isAllowedClientMessage(
        JSON.stringify({
          method: "session/resume",
          params: {
            cwd,
            sessionId: "session-1",
            mcpServers: [injectedServer],
          },
        }),
        cwd,
      ),
    ).toBe(false);
    expect(
      isAllowedClientMessage(
        JSON.stringify({
          method: "session/fork",
          params: {
            cwd,
            sessionId: "session-1",
            mcpServers: [injectedServer],
          },
        }),
        cwd,
      ),
    ).toBe(false);
    expect(
      isAllowedClientMessage(
        JSON.stringify({
          method: "session/resume",
          params: {
            cwd,
            sessionId: "session-1",
            mcpServers: {},
          },
        }),
        cwd,
      ),
    ).toBe(false);
  });

  it("rejects client changes to Profile-owned model and mode settings", () => {
    for (const request of [
      {
        method: "session/set_model",
        params: { sessionId: "session-1", modelId: "other-model" },
      },
      {
        method: "session/set_mode",
        params: { sessionId: "session-1", modeId: "other-mode" },
      },
      {
        method: "session/set_config_option",
        params: {
          sessionId: "session-1",
          configId: "model",
          value: "other-model",
        },
      },
    ]) {
      expect(
        isAllowedClientMessage(JSON.stringify(request), cwd),
      ).toBe(false);
    }
  });
});
