import { describe, expect, it } from "vitest";
import type { AcpSmokeResult } from "./acp-probe.js";
import { parseProbeCliArgs, runProbeCli } from "./probe-cli.js";
import { ProfileValidationError } from "./profile.js";

const RESULT: AcpSmokeResult = {
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
  it("accepts only one Profile path", () => {
    expect(
      parseProbeCliArgs([
        "--profile",
        "ontology-rag-demo/profiles/baseline-oag/profile.yaml",
      ]),
    ).toEqual({
      help: false,
      profilePath: "ontology-rag-demo/profiles/baseline-oag/profile.yaml",
    });
  });

  it.each([
    ["--command", "/usr/local/bin/opencode"],
    ["--cwd", "/tmp/project"],
    ["--env", "QWEN_API_KEY=must-not-leak"],
    ["--load-session", "session-1"],
    ["--timeout-ms", "2500"],
  ])("rejects the removed %s override", (option, value) => {
    expect(() =>
      parseProbeCliArgs([
        "--profile",
        "profiles/baseline-oag/profile.yaml",
        option,
        value,
      ]),
    ).toThrow(/unknown option/i);
  });

  it("requires Profile mode", () => {
    expect(() => parseProbeCliArgs([])).toThrow("--profile is required");
  });
});

describe("runProbeCli", () => {
  it("returns structured argument errors without echoing unknown values", async () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const code = await runProbeCli(["--token=must-not-leak"], {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(code).toBe(2);
    expect(stdout.value()).toBe("");
    expect(stderr.value()).not.toContain("must-not-leak");
    expect(JSON.parse(stderr.value())).toEqual({
      ok: false,
      error: {
        phase: "arguments",
        message: "Unknown option at argument 1",
      },
    });
  });

  it("dispatches only the declared Profile", async () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const calls: string[] = [];
    const code = await runProbeCli(
      ["--profile", "profiles/baseline-oag/profile.yaml"],
      {
        stdout: stdout.stream,
        stderr: stderr.stream,
      },
      {
        probeProfile: async (profilePath) => {
          calls.push(profilePath);
          return RESULT;
        },
      },
    );

    expect(code).toBe(0);
    expect(calls).toEqual(["profiles/baseline-oag/profile.yaml"]);
    expect(JSON.parse(stdout.value())).toEqual({ ok: true, ...RESULT });
    expect(stderr.value()).toBe("");
  });

  it("returns structured Profile validation errors", async () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const code = await runProbeCli(
      ["--profile", "profiles/baseline-oag/profile.yaml"],
      {
        stdout: stdout.stream,
        stderr: stderr.stream,
      },
      {
        probeProfile: async () => {
          throw new ProfileValidationError(
            "Profile is missing required environment variables: OAG_BASE_URL",
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
          "Profile is missing required environment variables: OAG_BASE_URL",
      },
    });
  });
});
