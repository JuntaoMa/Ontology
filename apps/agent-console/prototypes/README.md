# Profile project sidebar prototype

This directory contains the isolated visual reference used to implement the
Vue application. It is not imported by the production bundle.

## What this prototype validates

- the three fixed Agent Profiles replace the global Profile selector and the
  separate open/history sections;
- each Profile behaves like a project containing its own conversations;
- Profile actions are limited to read-only information and new conversation;
- the entire sidebar and each Profile group can be collapsed independently;
- one conversation remains visible while other Profile conversations can show
  background states;
- each non-running conversation exposes a direct delete button with
  confirmation;
- a completed live answer can show the browser-local completion time and the
  end-to-end Prompt duration.

The page uses the existing Console visual direction: system fonts, neutral
surfaces, compact rows, existing status concepts, semantic buttons, keyboard
focus and dialog labels. It deliberately adds no UI framework.

## Open locally

From the repository root:

```bash
pnpm --filter ontology-agent-console exec vite \
  --host 127.0.0.1 \
  --port 4312
```

Then open:

```text
http://127.0.0.1:4312/prototypes/profile-sidebar.html
```

## Session deletion boundary

The prototype itself removes a row only in its in-page mock state. ACP SDK
`0.13.1` does not define `session/delete`, so production uses a narrow Bridge
extension.

The installed OpenCode CLI exposes:

```bash
opencode session delete <sessionID>
```

Production exposes `DELETE /agents/:profileId/sessions/:sessionId`. It rejects
running Profiles, closes the idle owning ACP process, executes the CLI without
a shell against the owning working directory and `OPENCODE_DB`, invalidates
stale list responses, and refreshes `session/list`.

## Mapping to the ACP UI

The visual structure is a low-risk replacement for the current Vue sidebar:

- the existing `showSidebar` state already owns desktop collapse and narrow
  drawer behavior;
- the Profile catalog already supplies the fixed groups;
- `openConversations` and `resumableSessions` can be merged and deduplicated by
  `agentName + sessionId`;
- Profile information and `createSession(profileId, cwd)` already have most of
  the required data and actions.

The public `/agents` response exposes only explicitly reviewed Model,
Retrieval and Ontology metadata for the information card. It still omits
endpoints, credentials, commands, environment variable names and state paths.

For a live turn, the client can record a monotonic start before
`session/prompt` and set `completedAt` plus `durationMs` when that request
resolves. The browser should format `completedAt` in local time. Historical
`session/load` replay currently does not expose authoritative per-turn timing,
so restored answers must hide this footer or explicitly show
`Timing unavailable`; the Session `updatedAt` value is not a substitute.
