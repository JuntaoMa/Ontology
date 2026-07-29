# Ontology Agent Console

ACP-native Web UI and a thin WebSocket-to-stdio bridge for the ontology RAG demo.

The UI is a focused derivative of `acp-ui`; OpenCode remains the owner of sessions, history,
Agent behavior, Skills and tools. See:

- [`UPSTREAM.md`](UPSTREAM.md)
- [`../../ontology-rag-demo/docs/agent-console/system-design.md`](../../ontology-rag-demo/docs/agent-console/system-design.md)
- [`../../ontology-rag-demo/docs/agent-console/development.md`](../../ontology-rag-demo/docs/agent-console/development.md)

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
with the same question. A CLI run or ACP probe is preflight only; it does not replace the
browser acceptance procedure in the development guide.

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
