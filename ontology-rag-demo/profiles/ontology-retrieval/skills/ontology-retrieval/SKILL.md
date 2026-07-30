---
name: ontology-retrieval
description: Retrieve entity vector hits and an approximate Steiner connecting ontology subgraph from the current Runtime Dataset.
compatibility: opencode
metadata:
  protocol: ontology-artifact.v1
---

# Ontology retrieval

Use this Skill when query planning should be grounded in the current Runtime
Dataset ontology. The wrapper returns vector hits and an approximate Steiner
connecting subgraph in one call. There is no mandatory tool-call count.

Run the wrapper through the project environment:

```bash
uv run --project "$ONTOLOGY_DEMO_ROOT" --locked --no-sync python \
  "$ONTOLOGY_SKILLS_ROOT/ontology-retrieval/scripts/retrieve.py" \
  --question "<original user question>" \
  --keyword "<candidate ontology term>"
```

Extract a small set of ontology terms and make one combined call:

```bash
uv run --project "$ONTOLOGY_DEMO_ROOT" --locked --no-sync python \
  "$ONTOLOGY_SKILLS_ROOT/ontology-retrieval/scripts/retrieve.py" \
  --question "<original user question>" \
  --keyword "<term 1>" \
  --keyword "<term 2>"
```

The wrapper prints one `ONTOLOGY_ARTIFACT:` line for the Web UI followed by the
retrieval JSON. Top-K comes from the Runtime index metadata prepared from
`profile.yaml`; do not add `--top-k` unless explicitly testing an override.
Treat tool errors or empty hits as observations: revise the
keywords or continue without claiming that a missing hit proves the ontology
lacks the concept.

Do not print environment values, ontology source material, or Runtime paths.
