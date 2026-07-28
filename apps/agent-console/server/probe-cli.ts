import { pathToFileURL } from "node:url";
import {
  AcpProbeError,
  probeAcpCapabilities,
  type AcpProbeOptions,
} from "./acp-probe.js";
import {
  probeAcpProfile,
  type ProfileProbeOptions,
} from "./profile-probe.js";
import { ProfileValidationError } from "./profile.js";

const HELP = `Usage: pnpm probe:acp [options]

Safely probes an ACP subprocess with initialize and session/list. It never
creates a session or sends a prompt.

Options:
  --profile <path>       Probe an Agent Profile using its fixed runtime
  --command <path>       ACP executable (default: opencode)
  --arg <value>          Executable argument; repeatable (default: acp)
  --cwd <path>           Child and ACP working directory
  --env <NAME=VALUE>     Child environment override; repeatable
  --load-session <id>    Read-only load; count update types without printing bodies
  --timeout-ms <number>  Timeout per ACP request (default: 15000)
  -h, --help             Show this help
`;

export interface ProbeCliIo {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
}

export interface ParsedProbeCli {
  help: boolean;
  options: AcpProbeOptions;
  profilePath?: string;
}

export interface ProbeCliDependencies {
  probeCommand?: (options: AcpProbeOptions) => ReturnType<typeof probeAcpCapabilities>;
  probeProfile?: (
    profilePath: string,
    options: ProfileProbeOptions,
  ) => ReturnType<typeof probeAcpProfile>;
}

export function parseProbeCliArgs(argv: readonly string[]): ParsedProbeCli {
  let profilePath: string | undefined;
  let command: string | undefined;
  let cwd: string | undefined;
  let loadSessionId: string | undefined;
  let timeoutMs: number | undefined;
  const args: string[] = [];
  const env: Record<string, string> = {};
  let explicitArgs = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "-h":
      case "--help":
        return { help: true, options: {} };
      case "--profile":
        profilePath = nextValue(argv, ++index, "--profile");
        break;
      case "--command":
        command = nextValue(argv, ++index, "--command");
        break;
      case "--arg":
        explicitArgs = true;
        args.push(nextValue(argv, ++index, "--arg"));
        break;
      case "--cwd":
        cwd = nextValue(argv, ++index, "--cwd");
        break;
      case "--env": {
        const entry = nextValue(argv, ++index, "--env");
        const separator = entry.indexOf("=");
        if (separator <= 0) {
          throw new Error("--env must use NAME=VALUE");
        }
        const name = entry.slice(0, separator);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
          throw new Error("--env contains an invalid variable name");
        }
        env[name] = entry.slice(separator + 1);
        break;
      }
      case "--load-session":
        loadSessionId = nextValue(argv, ++index, "--load-session");
        break;
      case "--timeout-ms": {
        const raw = nextValue(argv, ++index, "--timeout-ms");
        timeoutMs = Number(raw);
        if (!Number.isInteger(timeoutMs)) {
          throw new Error("--timeout-ms must be an integer");
        }
        break;
      }
      default:
        throw new Error(`Unknown option at argument ${index + 1}`);
    }
  }

  if (
    profilePath !== undefined &&
    (
      command !== undefined ||
      explicitArgs ||
      cwd !== undefined ||
      Object.keys(env).length > 0
    )
  ) {
    throw new Error(
      "--profile cannot be combined with --command, --arg, --cwd, or --env",
    );
  }

  return {
    help: false,
    ...(profilePath !== undefined ? { profilePath } : {}),
    options: {
      ...(command !== undefined ? { command } : {}),
      ...(explicitArgs ? { args } : {}),
      ...(cwd !== undefined ? { cwd } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
      ...(loadSessionId !== undefined ? { loadSessionId } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    },
  };
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
    const result = parsed.profilePath
      ? await (dependencies.probeProfile ?? probeAcpProfile)(
          parsed.profilePath,
          {
            ...(parsed.options.loadSessionId !== undefined
              ? { loadSessionId: parsed.options.loadSessionId }
              : {}),
            ...(parsed.options.timeoutMs !== undefined
              ? { timeoutMs: parsed.options.timeoutMs }
              : {}),
          },
        )
      : await (dependencies.probeCommand ?? probeAcpCapabilities)(
          parsed.options,
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
          message: "ACP capability probe failed",
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
