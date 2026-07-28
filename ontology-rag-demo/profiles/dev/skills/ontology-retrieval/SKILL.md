---
name: ontology-retrieval
description: Query the configured ontology RAG service for vector hits, ontology subgraphs, or an end-to-end answer when ontology grounding can improve a response.
compatibility: opencode
metadata:
  protocol: ontology-artifact.v1
---

# Ontology retrieval

Use this Skill when the user asks about concepts, properties, relations, or paths
that should be grounded in the configured ontology. Decide autonomously whether
vector retrieval, graph retrieval, both, or the end-to-end answer endpoint is
useful. There is no mandatory tool-call order.

Run the wrapper through the project environment:

```bash
uv run --project . --locked --no-sync python "$ONTOLOGY_PROFILE_DIR/skills/ontology-retrieval/scripts/retrieve.py" --mode graph --question "<question or candidate ontology terms>"
```

Available modes:

- `vector`: return semantic hits; optionally pass `--top-k 5`.
- `graph`: return the anchor-based minimum connected subgraph.
- `answer`: return the current service's end-to-end answer and trace.

The wrapper prints the service JSON. When a graph is present, it additionally
prints one `ONTOLOGY_ARTIFACT:` line for the Web UI. Treat tool errors or empty
hits as observations: revise the query or continue without claiming that a
missing hit proves the ontology lacks the concept.

Do not print environment values or add credentials, endpoints, ontology source
material, or runtime state to the conversation.
