import { access, chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RuntimeInitializer } from "./runtime-initializer.js";
import { RuntimeSupervisor } from "./runtime-supervisor.js";
import {
  SessionDeleteError,
  SessionDeleteManager,
} from "./session-delete.js";
import { createDemoFixture, type DemoFixture } from "./runtime.test-fixture.js";

describe("Runtime-local OpenCode Session deletion", () => {
  let fixture: DemoFixture | undefined;
  let supervisor: RuntimeSupervisor | undefined;
  let sessionDeletes: SessionDeleteManager | undefined;

  afterEach(async () => {
    await sessionDeletes?.close();
    await supervisor?.close();
    await fixture?.cleanup();
    fixture = undefined;
    supervisor = undefined;
    sessionDeletes = undefined;
  });

  it(
    "uses the Runtime cwd/database and does not inherit unrelated secrets",
    async () => {
      const runtime = await createRuntime();
      const marker = path.join(runtime.paths.state, "delete-invocation.json");
      const command = await writeOpenCodeExecutable(
        runtime.paths.generated,
        [
          "const fs = process.getBuiltinModule('node:fs');",
          `fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({`,
          "  args: process.argv.slice(2),",
          "  cwd: process.cwd(),",
          "  db: process.env.OPENCODE_DB,",
          "  leaked: process.env.HF_TOKEN,",
          "}));",
        ].join("\n"),
      );
      runtime.profile.agent.command = command;

      sessionDeletes = new SessionDeleteManager();
      await sessionDeletes.delete(
        runtime,
        "ses_test123",
        {
          PATH: process.env.PATH,
          HF_TOKEN: "must-not-pass",
        },
        { timeoutMs: 10_000, killGraceMs: 50 },
      );

      expect(JSON.parse(await readFile(marker, "utf8"))).toEqual({
        args: ["session", "delete", "ses_test123", "--pure"],
        cwd: runtime.paths.workspace,
        db: runtime.paths.opencodeDb,
      });
    },
    15_000,
  );

  it.skipIf(process.platform === "win32")(
    "reports timeout only after the complete process group is gone",
    async () => {
      const runtime = await createRuntime();
      const marker = path.join(runtime.paths.state, "delete-pid.txt");
      const command = await writeOpenCodeExecutable(
        runtime.paths.generated,
        [
          "const fs = process.getBuiltinModule('node:fs');",
          "const { spawn } = process.getBuiltinModule('node:child_process');",
          `fs.writeFileSync(${JSON.stringify(marker)}, String(process.pid));`,
          "spawn(process.execPath, [",
          "  '-e',",
          "  \"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)\",",
          "], { stdio: 'ignore' });",
          "process.on('SIGTERM', () => {});",
          "setInterval(() => {}, 1000);",
        ].join("\n"),
      );
      runtime.profile.agent.command = command;

      await expect(
        (sessionDeletes = new SessionDeleteManager()).delete(
          runtime,
          "ses_timeout",
          { PATH: process.env.PATH },
          { timeoutMs: 3_000, killGraceMs: 25 },
        ),
      ).rejects.toMatchObject({
        kind: "timeout",
        processTreeStopped: true,
      } satisfies Partial<SessionDeleteError>);

      const pid = Number(await readFile(marker, "utf8"));
      expect(processGroupExists(pid)).toBe(false);
    },
    15_000,
  );

  it.skipIf(process.platform === "win32")(
    "reaps an in-flight delete during manager shutdown",
    async () => {
      const runtime = await createRuntime();
      const marker = path.join(runtime.paths.state, "shutdown-pid.txt");
      const command = await writeOpenCodeExecutable(
        runtime.paths.generated,
        [
          "const fs = process.getBuiltinModule('node:fs');",
          `fs.writeFileSync(${JSON.stringify(marker)}, String(process.pid));`,
          "process.on('SIGTERM', () => {});",
          "setInterval(() => {}, 1000);",
        ].join("\n"),
      );
      runtime.profile.agent.command = command;
      sessionDeletes = new SessionDeleteManager();

      const deletion = sessionDeletes.delete(
        runtime,
        "ses_shutdown",
        { PATH: process.env.PATH },
        { timeoutMs: 10_000, killGraceMs: 25 },
      );
      const rejectedDeletion = expect(deletion).rejects.toMatchObject({
        kind: "failed",
        processTreeStopped: true,
      } satisfies Partial<SessionDeleteError>);
      await waitForFile(marker);
      const pid = Number(await readFile(marker, "utf8"));
      await sessionDeletes.close();

      await rejectedDeletion;
      expect(processGroupExists(pid)).toBe(false);
    },
    15_000,
  );

  async function createRuntime() {
    fixture = await createDemoFixture();
    supervisor = new RuntimeSupervisor();
    const initializer = new RuntimeInitializer(fixture.catalog, supervisor, {});
    const accepted = initializer.start("test-profile", "test-dataset");
    await initializer.waitFor(accepted.id);
    return fixture.catalog.getLoaded(accepted.id)!;
  }
});

async function writeOpenCodeExecutable(
  directory: string,
  body: string,
): Promise<string> {
  const command = path.join(directory, "opencode");
  await writeFile(command, `#!${process.execPath}\n${body}\n`, "utf8");
  await chmod(command, 0o700);
  return command;
}

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await access(filePath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

function processGroupExists(pid: number): boolean {
  if (process.platform === "win32") return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return !(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
}
