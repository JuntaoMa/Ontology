# Ontology Agent Console

ACP-native Web UI and a thin WebSocket-to-stdio bridge for the ontology RAG demo.

The UI is a focused derivative of `acp-ui`; OpenCode remains the owner of sessions, history,
Agent behavior, Skills and tools. See:

- [`UPSTREAM.md`](UPSTREAM.md)
- [`../../ontology-rag-demo/docs/agent-console/system-design.md`](../../ontology-rag-demo/docs/agent-console/system-design.md)
- [`../../ontology-rag-demo/docs/agent-console/development.md`](../../ontology-rag-demo/docs/agent-console/development.md)

The single page keeps one fixed, project-like group per Agent Profile. Each group owns its
new-conversation action and merged OpenCode Session list; the one visible `ChatView` can switch
between Sessions without stopping a turn running under another Profile. Each Profile reuses one
ACP connection. The first version permits concurrent turns across Profiles and serializes turns
within the same Profile.

The sidebar also exposes sanitized Profile information and permanent conversation deletion.
Deletion is not an ACP operation: the loopback Bridge closes the idle owning Profile, runs
`opencode session delete` against that Profile's isolated `OPENCODE_DB`, and refreshes
`session/list`. A Profile-level maintenance lock excludes reconnects, in-flight ACP requests and
other deletes until the bounded CLI subprocess exits; the UI then reconnects the prior visible
conversation. A successful live response shows the browser-local completion time and
client-observed end-to-end duration; loaded history omits that footer because ACP does not
provide authoritative per-turn timing.

The conversation projection deliberately distinguishes execution semantics instead of rendering
every event as a terminal: Thinking, Skill loading, Execute/Bash and other Tool calls use separate
icons. Tool calls, ACP plans and assistant query JSON are collapsible. A complete object/array
message, or a valid object/array in a trailing `json`/`application-json` fence, is shown as a
formatted code block under `查询Plan`; Markdown before a trailing fence remains visible and the
stored message is unchanged. Formal-card titles stay on one line with ellipsis and expose the
full title on hover. Tool input and output remain inspectable, while the generic
`ACP content` panel is not rendered; the underlying ACP `content` field is retained for artifact
extraction. Desktop Session rows use compact vertical spacing, while the mobile layout keeps a
minimum 44 px touch row.

## Local verification and baseline acceptance

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm --filter ontology-agent-console typecheck
pnpm --filter ontology-agent-console test
pnpm --filter ontology-agent-console build
```

For the authoritative two-baseline check, first start the BGE-M3/LanceDB OAG service by
following the exact commands in the
[`development guide`](../../ontology-rag-demo/docs/agent-console/development.md#阶段-b8010-oag).
Confirm that the current OpenCode user can see the required model:

```bash
opencode models deepseek
# Must include: deepseek/deepseek-v4-flash
```

Then build and start the loopback-only Console from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm --filter ontology-agent-console build
OAG_BASE_URL=http://127.0.0.1:8010 \
  pnpm --filter ontology-agent-console start
```

Open `http://127.0.0.1:4310` and run both `baseline-direct-context` and `baseline-oag`
with the same question. Start one turn, create the other Profile's conversation before it
finishes, and switch through the Profile groups to verify that events remain isolated. A CLI
run or ACP probe is preflight only; it does not replace the browser acceptance procedure in the
development guide.

The `dev` Profile can be checked without creating a Session or sending a Prompt after loading
its ignored environment:

```bash
set -a
source ontology-rag-demo/.env
set +a
pnpm --filter ontology-agent-console probe:acp -- \
  --profile ontology-rag-demo/profiles/dev/profile.yaml
```

The full deployment and Profile publication procedure lives in the development guide linked
above.
