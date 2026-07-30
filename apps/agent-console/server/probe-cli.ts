import { pathToFileURL } from "node:url";
import { AcpProbeError, type AcpSmokeResult } from "./acp-probe.js";
import { probeAcpRuntime } from "./profile-probe.js";
import { RuntimeManifestError } from "./runtime-manifest.js";

const HELP = `Usage: pnpm probe:acp --runtime <path>

Smoke-tests one created Runtime with ACP initialize and session/list.
It never creates, loads, resumes, prompts, or mutates a Session.

Options:
  --runtime <path>  Runtime manifest below .runtime/projects/
  -h, --help        Show this help
`;

export interface ProbeCliIo {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
}

export type ParsedProbeCli =
  | { help: true }
  | { help: false; runtimePath: string };

export interface ProbeCliDependencies {
  probeRuntime?: (runtimePath: string) => Promise<AcpSmokeResult>;
}

export function parseProbeCliArgs(argv: readonly string[]): ParsedProbeCli {
  let runtimePath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "-h":
      case "--help":
        return { help: true };
      case "--runtime":
        if (runtimePath !== undefined) {
          throw new Error("--runtime may only be provided once");
        }
        runtimePath = nextValue(argv, ++index, "--runtime");
        if (runtimePath.length === 0) {
          throw new Error("--runtime requires a non-empty path");
        }
        break;
      default:
        throw new Error(`Unknown option at argument ${index + 1}`);
    }
  }

  if (runtimePath === undefined) {
    throw new Error("--runtime is required");
  }
  return { help: false, runtimePath };
}

export async function runProbeCli(
  argv: readonly string[],
  io: ProbeCliIo = {
    stdout: process.stdout,
    stderr: process.stderr,
  },
  dependencies: ProbeCliDependencies = {},
): Promise<number> {
  let parsed: ParsedProbeCli;
  try {
    parsed = parseProbeCliArgs(argv);
  } catch (error) {
    writeJson(io.stderr, {
      ok: false,
      error: {
        phase: "arguments",
        message: error instanceof Error ? error.message : "Invalid arguments",
      },
    });
    return 2;
  }

  if (parsed.help) {
    io.stdout.write(HELP);
    return 0;
  }

  try {
    const result = await (dependencies.probeRuntime ?? probeAcpRuntime)(
      parsed.runtimePath,
    );
    writeJson(io.stdout, { ok: true, ...result });
    return 0;
  } catch (error) {
    if (error instanceof AcpProbeError) {
      writeJson(io.stderr, {
        ok: false,
        error: {
          phase: error.phase,
          message: error.message,
          ...(error.rpcCode !== undefined ? { rpcCode: error.rpcCode } : {}),
          ...(error.stderr ? { stderr: error.stderr } : {}),
        },
      });
    } else if (error instanceof RuntimeManifestError) {
      writeJson(io.stderr, {
        ok: false,
        error: {
          phase: "runtime",
          message: error.message,
        },
      });
    } else {
      writeJson(io.stderr, {
        ok: false,
        error: {
          phase: "unknown",
          message: "ACP Profile smoke test failed",
        },
      });
    }
    return 1;
  }
}

function nextValue(
  argv: readonly string[],
  index: number,
  option: string,
): string {
  const value = argv[index];
  if (value === undefined) throw new Error(`${option} requires a value`);
  return value;
}

function writeJson(
  stream: Pick<NodeJS.WriteStream, "write">,
  value: unknown,
): void {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

function isEntrypoint(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isEntrypoint()) {
  void runProbeCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
