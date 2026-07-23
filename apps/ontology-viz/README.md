# OntologyViz App

The formal G6-first ontology visualization application. Runtime code and product
features are self-contained in this directory while the application contracts
are still evolving.

## Start

```bash
pnpm --filter ontology-viz-app dev
```

Open `http://127.0.0.1:5173/`. The app loads the bundled NPD ontology and its
saved ForceAtlas2 coordinates by default.

## Verification

```bash
pnpm --filter ontology-viz-app typecheck
pnpm --filter ontology-viz-app build
```

## Structure

- `src/ontology`: ontology parsing and normalized semantic model
- `src/graph`: G6 data adaptation, layouts, behaviors, and graph lifecycle
- `src/components`: application UI and detail presentation
- `src/storage`: recent sources and per-source layout preferences
- `docs/SPEC.md`: product behavior and acceptance requirements
- `docs/ARCHITECTURE.md`: module boundaries and design decisions
- `docs/VERIFICATION.md`: build gates and browser regression matrix
- `basic.html`: separate single-file viewer for easy sharing

The Apache-2.0 license for the NPD benchmark asset is included in
`public/NPD-LICENSE.txt`.
