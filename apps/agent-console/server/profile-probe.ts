import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
} from "node:fs/promises";
import path from "node:path";
import {
  smokeAcpProfile,
  type AcpSmokeResult,
} from "./acp-probe.js";
import {
  buildChildEnvironment,
  prepareRuntimeConfigOverlay,
} from "./opencode-runtime.js";
import {
  assertRequiredEnvironment,
  loadProfile,
  ProfileValidationError,
  type LoadedProfile,
} from "./profile.js";

export interface ProfileProbeDependencies {
  environment?: NodeJS.ProcessEnv;
  smoke?: (
    profile: LoadedProfile,
    environment: NodeJS.ProcessEnv,
  ) => Promise<AcpSmokeResult>;
}

/**
 * Smoke-test the exact runtime declared by one Agent Profile. The command only
 * initializes ACP and lists Session metadata; it never creates, loads, resumes,
 * prompts, or mutates a Session.
 */
export async function probeAcpProfile(
  profilePath: string,
  dependencies: ProfileProbeDependencies = {},
): Promise<AcpSmokeResult> {
  const sourceEnvironment = dependencies.environment ?? process.env;
  const profile = await loadProbeProfile(profilePath);
  assertRequiredEnvironment(profile, sourceEnvironment);

  await mkdir(profile.runtime.stateDir, { recursive: true, mode: 0o700 });
  const probeRuntimeDir = await mkdtemp(
    path.join(profile.runtime.stateDir, "probe-"),
  );

  try {
    const runtimeConfigDir = path.join(probeRuntimeDir, "config");
    prepareRuntimeConfigOverlay(profile, runtimeConfigDir);
    const runtimeEnvironment = buildChildEnvironment(
      profile,
      runtimeConfigDir,
      sourceEnvironment,
    );
    return await (dependencies.smoke ?? smokeAcpProfile)(
      profile,
      runtimeEnvironment,
    );
  } finally {
    await rm(probeRuntimeDir, { recursive: true, force: true });
  }
}

export async function loadProbeProfile(
  profilePath: string,
): Promise<LoadedProfile> {
  const absoluteProfilePath = path.resolve(profilePath);
  const profilesRoot = await inferProfilesRoot(absoluteProfilePath);
  return loadProfile(absoluteProfilePath, profilesRoot);
}

/**
 * The Profile-only CLI intentionally has no catalog-root override. Profiles
 * must live below the repository's conventional `profiles/` catalog.
 */
export async function inferProfilesRoot(profilePath: string): Promise<string> {
  let current = path.dirname(path.resolve(profilePath));
  while (true) {
    if (path.basename(current) === "profiles") {
      return realpath(current);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new ProfileValidationError(
    "Could not infer the Profile catalog root; profile.yaml must be below a profiles/ directory",
    profilePath,
  );
}
