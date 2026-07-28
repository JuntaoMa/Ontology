import { describe, expect, it } from "vitest";
import {
  AcpProbeError,
  probeAcpCapabilities,
  sanitizeDiagnostic,
} from "./acp-probe.js";

const FAKE_AGENT = String.raw`
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");

rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: 1,
        agentInfo: {
          name: process.env.ACP_PROBE_INHERIT_TEST || "Fake ACP",
          version: process.env.PROBE_VERSION,
        },
        agentCapabilities: {
          loadSession: true,
          sessionCapabilities: { list: {}, resume: {}, close: {} },
        },
      },
    });
    return;
  }
  if (message.method === "session/list") {
    if (message.params.cwd !== process.cwd()) process.exit(21);
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        sessions: [
          {
            sessionId: "session-safe",
            title: "title-must-not-be-returned",
            cwd: process.cwd(),
          },
        ],
      },
    });
    return;
  }
  if (message.method === "session/load") {
    const sessionId = message.params.sessionId;
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "message-body-must-not-leak" },
        },
      },
    });
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          rawInput: { command: "secret-command-body" },
        },
      },
    });
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          rawOutput: { output: "secret-tool-output" },
        },
      },
    });
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        configOptions: [
          { id: "model", currentValue: "sensitive-model-value" },
          { id: "mode", currentValue: "sensitive-mode-value" },
        ],
      },
    });
  }
});
`;

function fakeAgentOptions(
  overrides: Parameters<typeof probeAcpCapabilities>[0] = {},
) {
  return {
    command: process.execPath,
    args: ["--input-type=module", "-e", FAKE_AGENT],
    cwd: process.cwd(),
    env: { PROBE_VERSION: "test-version" },
    timeoutMs: 2_000,
    shutdownGraceMs: 100,
    ...overrides,
  };
}

describe("probeAcpCapabilities", () => {
  it("initializes and lists sessions without returning session titles", async () => {
    const result = await probeAcpCapabilities(fakeAgentOptions());

    expect(result.protocolVersion).toBe(1);
    expect(result.agentInfo).toEqual({
      name: "Fake ACP",
      version: "test-version",
    });
    expect(result.agentCapabilities).toMatchObject({
      loadSession: true,
      sessionCapabilities: { list: {} },
    });
    expect(result.sessions).toEqual({
      count: 1,
      hasMore: false,
    });
    expect(JSON.stringify(result)).not.toContain("title-must-not-be-returned");
  });

  it("counts loaded update types without retaining message or tool bodies", async () => {
    const result = await probeAcpCapabilities(
      fakeAgentOptions({ loadSessionId: "session-safe" }),
    );

    expect(result.replay).toEqual({
      sessionId: "session-safe",
      totalUpdates: 3,
      updateCounts: {
        agent_message_chunk: 1,
        tool_call: 1,
        tool_call_update: 1,
      },
      configOptionIds: ["model", "mode"],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("message-body-must-not-leak");
    expect(serialized).not.toContain("secret-command-body");
    expect(serialized).not.toContain("secret-tool-output");
    expect(serialized).not.toContain("sensitive-model-value");
  });

  it("can replace rather than inherit the host environment", async () => {
    const variableName = "ACP_PROBE_INHERIT_TEST";
    const previous = process.env[variableName];
    process.env[variableName] = "must-not-reach-the-child";
    try {
      const result = await probeAcpCapabilities(
        fakeAgentOptions({
          inheritEnvironment: false,
        }),
      );
      expect(result.agentInfo?.name).toBe("Fake ACP");
    } finally {
      if (previous === undefined) delete process.env[variableName];
      else process.env[variableName] = previous;
    }
  });

  it("times out and terminates a non-responsive subprocess", async () => {
    const startedAt = Date.now();
    await expect(
      probeAcpCapabilities({
        command: process.execPath,
        args: [
          "--input-type=module",
          "-e",
          "process.stdin.resume(); setInterval(() => {}, 1000);",
        ],
        cwd: process.cwd(),
        timeoutMs: 40,
        shutdownGraceMs: 40,
      }),
    ).rejects.toMatchObject({
      name: "AcpProbeError",
      phase: "timeout",
    });
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it("redacts stderr and environment-shaped secrets on failure", async () => {
    const secret = "environment-secret-value";
    const failingAgent = String.raw`
process.stderr.write(
  "Authorization: Bearer bearer-value\n" +
  "API_KEY=literal-key-value\n" +
  process.env.PRIVATE_TOKEN + "\n",
);
process.exit(9);
`;

    let caught: unknown;
    try {
      await probeAcpCapabilities({
        command: process.execPath,
        args: ["--input-type=module", "-e", failingAgent],
        cwd: process.cwd(),
        env: { PRIVATE_TOKEN: secret },
        timeoutMs: 1_000,
        shutdownGraceMs: 50,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AcpProbeError);
    const probeError = caught as AcpProbeError;
    expect(probeError.stderr).toContain("[REDACTED]");
    expect(probeError.stderr).not.toContain(secret);
    expect(probeError.stderr).not.toContain("bearer-value");
    expect(probeError.stderr).not.toContain("literal-key-value");
  });
});

describe("sanitizeDiagnostic", () => {
  it("redacts URL credentials, JSON secrets, headers and query tokens", () => {
    const sanitized = sanitizeDiagnostic(
      [
        "https://user:password@example.test/path?token=abcd&ok=1",
        '"apiKey": "json-secret"',
        "Cookie: session=cookie-secret; preference=also-secret",
      ].join("\n"),
      [],
      1_000,
    );
    expect(sanitized).toBe(
      [
        "https://user:[REDACTED]@example.test/path?token=[REDACTED]&ok=1",
        '"apiKey": [REDACTED]',
        "Cookie: [REDACTED]",
      ].join("\n"),
    );
  });
});
