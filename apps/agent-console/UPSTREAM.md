# Upstream provenance

The Web client in `src/` is derived from:

- project: [formulahendry/acp-ui](https://github.com/formulahendry/acp-ui)
- version: `0.1.16`
- commit: `cd9c3cb464a4b321bff652101953a64c07473e31`
- commit date: 2026-05-25
- license: MIT, retained in `LICENSE`

## Intentional changes

- The Web build receives its Agent Catalog from the local ACP Bridge.
- Browser users cannot add arbitrary commands, URLs, cwd values or environment variables.
- Agent-owned `session/list` replaces the browser Session index as the catalog authority.
- ACP Tool Call `rawInput`, `rawOutput` and content are retained for inspection and artifacts.
- `ontology.subgraph@v1` receives a lightweight inline SVG renderer.
- Azure Application Insights is removed. This internal test UI sends no product telemetry.
- Markdown is sanitized before `v-html`; raw Agent HTML is never trusted.
- Long-running `session/prompt` calls do not inherit the generic short request timeout.
- Tauri support is not a release target; retained host abstractions may be removed when doing so
  reduces the patch without changing ACP behavior.

Upstream upgrades must be deliberate. Re-run the ACP capability tests and review every item above
before changing the pinned commit.
