import path from "node:path";
import { realpath } from "node:fs/promises";
import {
  smokeAcpRuntime,
  type AcpSmokeResult,
} from "./acp-probe.js";
import {
  buildChildEnvironment,
  prepareRuntimeConfigOverlay,
} from "./opencode-runtime.js";
import { assertRequiredEnvironment } from "./profile.js";
import {
  loadRuntime,
  RuntimeManifestError,
  type LoadedRuntime,
} from "./runtime-manifest.js";

export interface RuntimeProbeDependencies {
  environment?: NodeJS.ProcessEnv;
  smoke?: (
    runtime: LoadedRuntime,
    environment: NodeJS.ProcessEnv,
  ) => Promise<AcpSmokeResult>;
}

/**
 * Read-only ACP smoke for an already-created Runtime. It initializes ACP and
 * lists Session metadata, but never creates or loads a Session.
 */
export async function probeAcpRuntime(
  manifestPath: string,
  dependencies: RuntimeProbeDependencies = {},
): Promise<AcpSmokeResult> {
  const sourceEnvironment = dependencies.environment ?? process.env;
  const runtime = await loadProbeRuntime(manifestPath);
  assertRequiredEnvironment(runtime.profile, sourceEnvironment);
  prepareRuntimeConfigOverlay(
    runtime.profile,
    runtime.paths.opencodeConfig,
  );
  const environment = buildChildEnvironment(runtime, sourceEnvironment);
  return (dependencies.smoke ?? smokeAcpRuntime)(runtime, environment);
}

export async function loadProbeRuntime(
  manifestPath: string,
): Promise<LoadedRuntime> {
  const absoluteManifest = path.resolve(manifestPath);
  if (path.basename(absoluteManifest) !== "runtime.yaml") {
    throw new RuntimeManifestError("Probe target must be runtime.yaml");
  }
  const runtimeRoot = path.dirname(absoluteManifest);
  const projectsRoot = path.dirname(runtimeRoot);
  if (
    path.basename(projectsRoot) !== "projects" ||
    path.basename(path.dirname(projectsRoot)) !== ".runtime"
  ) {
    throw new RuntimeManifestError(
      "runtime.yaml must be below .runtime/projects/<runtime-id>",
      absoluteManifest,
    );
  }
  const demoRoot = path.dirname(path.dirname(projectsRoot));
  return loadRuntime(
    runtimeRoot,
    await realpath(projectsRoot),
    "projects",
    await realpath(demoRoot),
  );
}
