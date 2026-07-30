import { afterEach, describe, expect, it } from "vitest";
import {
  projectAgentMessage,
  rewriteClientMessage,
} from "./bridge.js";
import { buildChildEnvironment } from "./opencode-runtime.js";
import { RuntimeInitializer } from "./runtime-initializer.js";
import { RuntimeSupervisor } from "./runtime-supervisor.js";
import { createDemoFixture, type DemoFixture } from "./runtime.test-fixture.js";

describe("ACP Runtime boundary", () => {
  let fixture: DemoFixture | undefined;

  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
  });

  it("accepts only logical cwd and rewrites it to the managed workspace", () => {
    const workspace = "/managed/runtime/workspace";
    const logical = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "session/new",
      params: { cwd: ".", mcpServers: [] },
    });
    const rewritten = rewriteClientMessage(logical, workspace);
    expect(JSON.parse(rewritten!).params.cwd).toBe(workspace);

    expect(
      rewriteClientMessage(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "session/list",
          params: { cwd: workspace },
        }),
        workspace,
      ),
    ).toBeUndefined();
    expect(rewriteClientMessage(logical, workspace, false)).toBeUndefined();
  });

  it("projects session/list cwd to dot and filters sessions from other workspaces", () => {
    const workspace = "/managed/runtime/workspace";
    const projected = projectAgentMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        result: {
          sessions: [
            { sessionId: "ses_owned", cwd: workspace },
            { sessionId: "ses_foreign", cwd: "/private/other" },
            { sessionId: "ses_unknown" },
          ],
        },
      }),
      workspace,
      new Map([["number:7", "session/list"]]),
    );
    const parsed = JSON.parse(projected!);
    expect(parsed.result.sessions).toEqual([
      { sessionId: "ses_owned", cwd: "." },
    ]);
    expect(projected).not.toContain(workspace);
    expect(projected).not.toContain("/private/other");
  });

  it("turns a mismatched session response into a path-free protocol error", () => {
    const projected = projectAgentMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "load-1",
        result: { session: { sessionId: "ses_foreign", cwd: "/secret/path" } },
      }),
      "/managed/runtime/workspace",
      new Map([["string:load-1", "session/load"]]),
    );
    expect(JSON.parse(projected!)).toMatchObject({
      id: "load-1",
      error: { code: -32603, message: "Runtime workspace mismatch" },
    });
    expect(projected).not.toContain("/secret/path");
  });

  it("passes only explicit safe embedding tuning and derived retrieval settings", async () => {
    fixture = await createDemoFixture({ retrieval: true });
    const supervisor = new RuntimeSupervisor();
    const initializer = new RuntimeInitializer(fixture.catalog, supervisor, {});
    const accepted = initializer.start("test-profile", "test-dataset");
    await initializer.waitFor(accepted.id);
    const runtime = fixture.catalog.getLoaded(accepted.id)!;

    const environment = buildChildEnvironment(runtime, {
      PATH: process.env.PATH,
      HOME: "/safe/home",
      EMBEDDING_DEVICE: "cpu",
      EMBEDDING_BATCH_SIZE: "2",
      HF_HUB_DISABLE_XET: "1",
      TOKENIZERS_PARALLELISM: "false",
      HF_TOKEN: "must-not-pass",
      UNRELATED_INTERNAL_URL: "must-not-pass",
    });
    expect(environment).toMatchObject({
      HOME: "/safe/home",
      EMBEDDING_DEVICE: "cpu",
      EMBEDDING_BATCH_SIZE: "2",
      HF_HUB_DISABLE_XET: "1",
      TOKENIZERS_PARALLELISM: "false",
      ONTOLOGY_VECTOR_TOP_K: "5",
      ONTOLOGY_GRAPH_ALGORITHM: "minimum_connected_subgraph",
      ONTOLOGY_RUNTIME_ID: accepted.id,
      ONTOLOGY_WORKSPACE_DIR: runtime.paths.workspace,
      ONTOLOGY_MODEL_ID: "test/model",
      PYTHONDONTWRITEBYTECODE: "1",
    });
    expect(environment.HF_TOKEN).toBeUndefined();
    expect(environment.UNRELATED_INTERNAL_URL).toBeUndefined();
    await supervisor.close();
  });
});
