# Ontology Agent Console

ACP-native Web UI and a thin WebSocket-to-stdio bridge for the ontology RAG demo.

The UI is a focused derivative of `acp-ui`; OpenCode remains the owner of sessions, history,
Agent behavior, Skills and tools. See:

- [`UPSTREAM.md`](UPSTREAM.md)
- [`../../ontology-rag-demo/docs/agent-console/system-design.md`](../../ontology-rag-demo/docs/agent-console/system-design.md)
- [`../../ontology-rag-demo/docs/agent-console/development.md`](../../ontology-rag-demo/docs/agent-console/development.md)

## Local verification

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm --filter ontology-agent-console typecheck
pnpm --filter ontology-agent-console test
pnpm --filter ontology-agent-console build
```

Load the ignored Demo environment, then start the loopback-only Console:

```bash
set -a
source ontology-rag-demo/.env
set +a
pnpm --filter ontology-agent-console start
```

Open `http://127.0.0.1:4310`. The same environment can be checked without creating a
Session or sending a Prompt:

```bash
pnpm --filter ontology-agent-console probe:acp -- \
  --profile ontology-rag-demo/profiles/dev/profile.yaml
```

The full deployment and Profile publication procedure lives in the development guide linked
above.
