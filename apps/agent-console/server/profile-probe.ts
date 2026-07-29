import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
} from "node:fs/promises";
import path from "node:path";
import {
  probeAcpCapabilities,
  type AcpProbeOptions,
  type AcpProbeResult,
} from "./acp-probe.js";
import {
  buildChildEnvironment,
  prepareRuntimeConfigOverlay,
} from "./bridge.js";
import {
  assertRequiredEnvironment,
  loadProfile,
  ProfileValidationError,
  type LoadedProfile,
} from "./profile.js";

export interface ProfileProbeOptions {
  loadSessionId?: string;
  timeoutMs?: number;
  maxFrameBytes?: number;
  maxStderrChars?: number;
  shutdownGraceMs?: number;
}

export interface ProfileProbeDependencies {
  environment?: NodeJS.ProcessEnv;
  probe?: (options: AcpProbeOptions) => Promise<AcpProbeResult>;
}

/**
 * Probe the exact runtime declared by an Agent Profile without making its
 * version-controlled bundle writable.
 *
 * The OpenCode database remains the Profile database so session/list and
 * session/load observe the same durable sessions as the Console. Only the
 * OpenCode configuration directory is unique and temporary.
 */
export async function probeAcpProfile(
  profilePath: string,
  options: ProfileProbeOptions = {},
  dependencies: ProfileProbeDependencies = {},
): Promise<AcpProbeResult> {
  const environment = dependencies.environment ?? process.env;
  const profile = await loadProbeProfile(profilePath);
  assertRequiredEnvironment(profile, environment);

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
      environment,
    );
    const runProbe = dependencies.probe ?? probeAcpCapabilities;
    return await runProbe({
      command: profile.runtime.command,
      args: profile.runtime.args,
      cwd: profile.runtime.cwd,
      env: runtimeEnvironment,
      inheritEnvironment: false,
      ...(options.loadSessionId !== undefined
        ? { loadSessionId: options.loadSessionId }
        : {}),
      ...(options.timeoutMs !== undefined
        ? { timeoutMs: options.timeoutMs }
        : {}),
      ...(options.maxFrameBytes !== undefined
        ? { maxFrameBytes: options.maxFrameBytes }
        : {}),
      ...(options.maxStderrChars !== undefined
        ? { maxStderrChars: options.maxStderrChars }
        : {}),
      ...(options.shutdownGraceMs !== undefined
        ? { shutdownGraceMs: options.shutdownGraceMs }
        : {}),
    });
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
 * Profile-only CLI mode intentionally has no second catalog-root argument.
 * Published and development bundles therefore have to live below the
 * repository's conventional `profiles/` catalog.
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
