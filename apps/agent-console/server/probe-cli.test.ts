import { describe, expect, it } from "vitest";
import type { AcpProbeResult } from "./acp-probe.js";
import { parseProbeCliArgs, runProbeCli } from "./probe-cli.js";
import { ProfileValidationError } from "./profile.js";

const RESULT: AcpProbeResult = {
  protocolVersion: 1,
  agentCapabilities: {},
  sessions: { count: 0, hasMore: false },
};

function captureStream() {
  let value = "";
  return {
    stream: {
      write(chunk: string | Uint8Array): boolean {
        value += chunk.toString();
        return true;
      },
    },
    value: () => value,
  };
}

describe("parseProbeCliArgs", () => {
  it("parses command, repeated args, cwd, env, load and timeout", () => {
    expect(
      parseProbeCliArgs([
        "--command",
        "/usr/local/bin/opencode",
        "--arg",
        "acp",
        "--arg",
        "--pure",
        "--cwd",
        "/tmp/project",
        "--env",
        "PROFILE_ID=baseline",
        "--load-session",
        "session-1",
        "--timeout-ms",
        "2500",
      ]),
    ).toEqual({
      help: false,
      options: {
        command: "/usr/local/bin/opencode",
        args: ["acp", "--pure"],
        cwd: "/tmp/project",
        env: { PROFILE_ID: "baseline" },
        loadSessionId: "session-1",
        timeoutMs: 2500,
      },
    });
  });

  it("rejects malformed environment overrides without echoing a value", () => {
    expect(() =>
      parseProbeCliArgs(["--env", "not-an-assignment"]),
    ).toThrow("--env must use NAME=VALUE");
  });

  it("parses Profile mode with read-only load and timeout options", () => {
    expect(
      parseProbeCliArgs([
        "--profile",
        "ontology-rag-demo/profiles/dev/profile.yaml",
        "--load-session",
        "session-1",
        "--timeout-ms",
        "2500",
      ]),
    ).toEqual({
      help: false,
      profilePath: "ontology-rag-demo/profiles/dev/profile.yaml",
      options: {
        loadSessionId: "session-1",
        timeoutMs: 2500,
      },
    });
  });

  it("does not allow Profile runtime fields to be overridden", () => {
    expect(() =>
      parseProbeCliArgs([
        "--profile",
        "profiles/dev/profile.yaml",
        "--cwd",
        "/tmp/other",
      ]),
    ).toThrow("--profile cannot be combined");
    expect(() =>
      parseProbeCliArgs([
        "--profile",
        "profiles/dev/profile.yaml",
        "--env",
        "QWEN_API_KEY=override",
      ]),
    ).toThrow("--profile cannot be combined");
  });
});

describe("runProbeCli", () => {
  it("returns structured argument errors", async () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const code = await runProbeCli(["--unknown"], {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(code).toBe(2);
    expect(stdout.value()).toBe("");
    expect(JSON.parse(stderr.value())).toEqual({
      ok: false,
      error: {
        phase: "arguments",
        message: "Unknown option at argument 1",
      },
    });
  });

  it("does not echo an unknown argument that may contain a secret", async () => {
    const stdout = captureStream();
    const stderr = captureStream();
    await runProbeCli(["--token=must-not-leak"], {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(stderr.value()).not.toContain("must-not-leak");
  });

  it("dispatches Profile mode without exposing command overrides", async () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const calls: unknown[] = [];
    const code = await runProbeCli(
      [
        "--profile",
        "profiles/dev/profile.yaml",
        "--load-session",
        "session-1",
        "--timeout-ms",
        "2500",
      ],
      {
        stdout: stdout.stream,
        stderr: stderr.stream,
      },
      {
        probeProfile: async (profilePath, options) => {
          calls.push({ profilePath, options });
          return RESULT;
        },
      },
    );

    expect(code).toBe(0);
    expect(calls).toEqual([
      {
        profilePath: "profiles/dev/profile.yaml",
        options: {
          loadSessionId: "session-1",
          timeoutMs: 2500,
        },
      },
    ]);
    expect(JSON.parse(stdout.value())).toEqual({ ok: true, ...RESULT });
    expect(stderr.value()).toBe("");
  });

  it("returns structured Profile validation errors", async () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const code = await runProbeCli(
      ["--profile", "profiles/dev/profile.yaml"],
      {
        stdout: stdout.stream,
        stderr: stderr.stream,
      },
      {
        probeProfile: async () => {
          throw new ProfileValidationError(
            "Profile is missing required environment variables: QWEN_API_KEY",
          );
        },
      },
    );

    expect(code).toBe(1);
    expect(stdout.value()).toBe("");
    expect(JSON.parse(stderr.value())).toEqual({
      ok: false,
      error: {
        phase: "profile",
        message:
          "Profile is missing required environment variables: QWEN_API_KEY",
      },
    });
  });
});
