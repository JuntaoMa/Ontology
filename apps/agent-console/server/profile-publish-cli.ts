import path from "node:path";
import { publishProfile } from "./profile-publish.js";

interface CliOptions {
  sourceProfilePath: string;
  profilesRoot?: string;
  releaseId: string;
  revision?: string;
  ontologySha256?: string;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const published = await publishProfile(options);
  process.stdout.write(
    `${JSON.stringify({
      profile_id: published.profile.id,
      revision: published.profile.revision,
      files: published.lock.files.length,
      bundle: path.relative(process.cwd(), published.bundlePath) || ".",
    })}\n`,
  );
}

function parseArguments(arguments_: string[]): CliOptions {
  if (arguments_.includes("--help") || arguments_.includes("-h")) {
    process.stdout.write(
      [
        "Publish a mutable Agent Profile as an immutable release.",
        "",
        "Usage:",
        "  pnpm profile:publish -- --profile <profile.yaml> --release-id <id>",
        "    [--revision <revision>] [--profiles-root <dir>]",
        "    [--ontology-sha256 <64 lowercase hex characters>]",
        "",
      ].join("\n"),
    );
    process.exit(0);
  }

  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Invalid argument near "${key ?? ""}"`);
    }
    if (values.has(key)) {
      throw new Error(`Duplicate argument "${key}"`);
    }
    values.set(key, value);
  }

  const allowed = new Set([
    "--profile",
    "--profiles-root",
    "--release-id",
    "--revision",
    "--ontology-sha256",
  ]);
  for (const key of values.keys()) {
    if (!allowed.has(key)) throw new Error(`Unknown argument "${key}"`);
  }

  const sourceProfilePath = values.get("--profile");
  const releaseId = values.get("--release-id");
  if (!sourceProfilePath || !releaseId) {
    throw new Error("--profile and --release-id are required");
  }
  return {
    sourceProfilePath,
    releaseId,
    profilesRoot: values.get("--profiles-root"),
    revision: values.get("--revision"),
    ontologySha256: values.get("--ontology-sha256"),
  };
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Profile publication failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
