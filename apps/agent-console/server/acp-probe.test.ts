import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AcpProbeError,
  sanitizeDiagnostic,
  smokeAcpProfile,
} from "./acp-probe.js";
import type { LoadedProfile } from "./profile.js";

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
          name: "Fake ACP",
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
  }
});
`;

function profileFixture(
  args: string[],
  startupTimeoutMs = 2_000,
): LoadedProfile {
  return {
    id: "smoke-test",
    revision: "test",
    title: "Smoke test",
    description: "ACP smoke test fixture",
    profilePath: path.join(process.cwd(), "profiles", "smoke-test", "profile.yaml"),
    configPath: path.join(process.cwd(), "profiles", "smoke-test", "opencode.jsonc"),
    configAssets: [],
    skills: [],
    runtime: {
      command: process.execPath,
      args,
      cwd: process.cwd(),
      stateDir: path.join(process.cwd(), ".runtime", "opencode", "smoke-test"),
      startupTimeoutMs,
    },
    requiredEnv: [],
    model: {
      id: "test/model",
      source: "opencode",
      auth: { source: "opencode" },
    },
    ontology: { id: "test" },
  };
}

describe("smokeAcpProfile", () => {
  it("initializes and lists sessions without returning Session bodies", async () => {
    const result = await smokeAcpProfile(
      profileFixture(["--input-type=module", "-e", FAKE_AGENT]),
      { PATH: process.env.PATH, PROBE_VERSION: "test-version" },
    );

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

  it("times out and terminates a non-responsive Profile runtime", async () => {
    const startedAt = Date.now();
    await expect(
      smokeAcpProfile(
        profileFixture(
          [
            "--input-type=module",
            "-e",
            "process.stdin.resume(); setInterval(() => {}, 1000);",
          ],
          40,
        ),
        { PATH: process.env.PATH },
      ),
    ).rejects.toMatchObject({
      name: "AcpProbeError",
      phase: "timeout",
    });
    expect(Date.now() - startedAt).toBeLessThan(2_000);
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
      await smokeAcpProfile(
        profileFixture(["--input-type=module", "-e", failingAgent]),
        { PATH: process.env.PATH, PRIVATE_TOKEN: secret },
      );
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
