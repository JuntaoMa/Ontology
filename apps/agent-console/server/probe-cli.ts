import { pathToFileURL } from "node:url";
import { AcpProbeError, type AcpSmokeResult } from "./acp-probe.js";
import { probeAcpProfile } from "./profile-probe.js";
import { ProfileValidationError } from "./profile.js";

const HELP = `Usage: pnpm probe:acp --profile <path>

Smoke-tests one validated Agent Profile with ACP initialize and session/list.
It never creates, loads, resumes, prompts, or mutates a Session.

Options:
  --profile <path>  Profile declaration below a profiles/ catalog
  -h, --help        Show this help
`;

export interface ProbeCliIo {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
}

export type ParsedProbeCli =
  | { help: true }
  | { help: false; profilePath: string };

export interface ProbeCliDependencies {
  probeProfile?: (profilePath: string) => Promise<AcpSmokeResult>;
}

export function parseProbeCliArgs(argv: readonly string[]): ParsedProbeCli {
  let profilePath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "-h":
      case "--help":
        return { help: true };
      case "--profile":
        if (profilePath !== undefined) {
          throw new Error("--profile may only be provided once");
        }
        profilePath = nextValue(argv, ++index, "--profile");
        if (profilePath.length === 0) {
          throw new Error("--profile requires a non-empty path");
        }
        break;
      default:
        throw new Error(`Unknown option at argument ${index + 1}`);
    }
  }

  if (profilePath === undefined) {
    throw new Error("--profile is required");
  }
  return { help: false, profilePath };
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
    const result = await (dependencies.probeProfile ?? probeAcpProfile)(
      parsed.profilePath,
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
    } else if (error instanceof ProfileValidationError) {
      writeJson(io.stderr, {
        ok: false,
        error: {
          phase: "profile",
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
