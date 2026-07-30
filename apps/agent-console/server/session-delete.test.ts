import path from "node:path";
import { tmpdir } from "node:os";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { LoadedProfile } from "./profile.js";
import {
  deleteOpenCodeSession,
  isOpenCodeSessionId,
  SessionDeleteError,
  supportsSessionDelete,
} from "./session-delete.js";

function profileFixture(root: string): LoadedProfile {
  const profileDirectory = path.join(root, "profile");
  return {
    id: "test-profile",
    revision: "test",
    title: "Test Profile",
    description: "Test profile",
    profilePath: path.join(profileDirectory, "profile.yaml"),
    configPath: path.join(profileDirectory, "opencode.jsonc"),
    configAssets: [],
    skills: [],
    runtime: {
      command: path.join(root, "bin", "opencode"),
      args: ["acp"],
      cwd: path.join(root, "workspace"),
      stateDir: path.join(root, "state"),
      startupTimeoutMs: 15_000,
    },
    requiredEnv: ["CAPTURE_PATH"],
    model: {
      id: "test/model",
      source: "opencode",
      auth: { source: "opencode" },
    },
    ontology: { id: "test-ontology" },
  };
}

describe("OpenCode Session deletion", () => {
  it("accepts only the opaque OpenCode Session id shape", () => {
    expect(isOpenCodeSessionId("ses_0123abcXYZ")).toBe(true);
    expect(isOpenCodeSessionId("direct-1")).toBe(false);
    expect(isOpenCodeSessionId("--help")).toBe(false);
    expect(isOpenCodeSessionId("ses_../escape")).toBe(false);
  });

  it("executes without a shell against the owning Profile environment", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "session-delete-"));
    const profile = profileFixture(root);
    const capturePath = path.join(root, "capture.json");
    try {
      await mkdir(path.dirname(profile.runtime.command), { recursive: true });
      await mkdir(profile.runtime.cwd, { recursive: true });
      await mkdir(path.dirname(profile.configPath), { recursive: true });
      await writeFile(profile.configPath, "{}\n", "utf8");
      await writeFile(
        profile.runtime.command,
        [
          "#!/usr/bin/env node",
          "const fs = require('node:fs');",
          "fs.writeFileSync(process.env.CAPTURE_PATH, JSON.stringify({",
          "  argv: process.argv.slice(2),",
          "  cwd: process.cwd(),",
          "  db: process.env.OPENCODE_DB,",
          "  config: process.env.OPENCODE_CONFIG_DIR",
          "}));",
        ].join("\n"),
        "utf8",
      );
      await chmod(profile.runtime.command, 0o755);

      expect(supportsSessionDelete(profile)).toBe(true);
      await deleteOpenCodeSession(
        profile,
        "ses_0123abcXYZ",
        {
          PATH: process.env.PATH,
          CAPTURE_PATH: capturePath,
        },
      );

      const captured = JSON.parse(await readFile(capturePath, "utf8")) as {
        argv: string[];
        cwd: string;
        db: string;
        config: string;
      };
      expect(captured).toEqual({
        argv: ["session", "delete", "ses_0123abcXYZ", "--pure"],
        cwd: await realpath(profile.runtime.cwd),
        db: path.join(profile.runtime.stateDir, "opencode.db"),
        config: path.join(profile.runtime.stateDir, "config"),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("escalates an ignored SIGTERM and settles within a hard bound", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "session-delete-timeout-"));
    const profile = profileFixture(root);
    try {
      await mkdir(path.dirname(profile.runtime.command), { recursive: true });
      await mkdir(profile.runtime.cwd, { recursive: true });
      await mkdir(path.dirname(profile.configPath), { recursive: true });
      await writeFile(profile.configPath, "{}\n", "utf8");
      await writeFile(
        profile.runtime.command,
        [
          "#!/usr/bin/env node",
          "process.on('SIGTERM', () => {});",
          "setInterval(() => {}, 1000);",
        ].join("\n"),
        "utf8",
      );
      await chmod(profile.runtime.command, 0o755);

      const startedAt = performance.now();
      await expect(
        deleteOpenCodeSession(
          profile,
          "ses_timeout123",
          { PATH: process.env.PATH },
          { timeoutMs: 40, killGraceMs: 40 },
        ),
      ).rejects.toBeInstanceOf(SessionDeleteError);
      expect(performance.now() - startedAt).toBeLessThan(1_000);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
