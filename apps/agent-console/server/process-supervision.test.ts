import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { terminateProcessTree } from "./runtime-supervisor.js";

describe.skipIf(process.platform === "win32")("POSIX process supervision", () => {
  it("does not settle until the detached process group is gone", async () => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        [
          "const { spawn } = require('node:child_process');",
          "spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],",
          "  { stdio: 'ignore' });",
          "process.stdout.write('ready\\n');",
          "setInterval(() => {}, 1000);",
        ].join("\n"),
      ],
      {
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const pid = child.pid;
    expect(pid).toBeTypeOf("number");
    await once(child.stdout, "data");

    await terminateProcessTree(child, {
      terminateGraceMs: 100,
      forceSettleMs: 1_000,
    });

    expect(processGroupExists(pid!)).toBe(false);
  });
});

function processGroupExists(pid: number): boolean {
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
