# OntologyViz Architecture

## 1. Development Shape

During product development, `apps/ontology-viz` is the only implementation unit:

```text
apps/ontology-viz/
  docs/
  fixtures/
  public/
  src/
    app/
    ontology/
    graph/
    components/
    storage/
    styles/
```

The previous `packages/ontology-viz` implementation has been removed. There is
no compatibility wrapper during the app-first development phase.

Future package extraction shall move stable modules out of the app without redesigning their contracts.

## 2. Module Ownership

### `src/ontology`

Pure ontology data code:

- Parser selection and format detection
- RDF quad normalization
- Resource classification
- Labels and descriptions
- Properties and restrictions
- Main graph projection
- Immutable indexes and selectors

It must not import React or G6.

### `src/graph`

G6-specific code:

- GraphData adapter
- Visual tokens
- Label priority and semantic zoom
- Layout factories
- G6 behaviors, plugins, transforms, and states
- Layout snapshot conversion

It must not read files, localStorage, or application DOM outside G6 plugin content callbacks.

### `src/components`

Application UI:

- Header and import controls
- Layout/settings dialog
- Search
- Tooltip content factories
- Detail panel and shared tables
- Empty, loading, and error states

### `src/storage`

Browser persistence:

- Recent source metadata and file content
- Source-keyed preferences
- Layout snapshots
- Versioned migrations

### `src/app`

Composition and lifecycle:

- Load source
- Commit parsed document atomically
- Coordinate selection and focus
- Connect storage and export services
- Keep the G6 instance stable

## 3. Data Flow

```text
File / URL
  -> parser registry
  -> normalized RDF quads
  -> OntologyDocument
  -> graph projection + indexes
  -> G6 GraphData
  -> stable Graph instance

Selection
  -> indexed selector
  -> detail view
  -> optional graph focus/state update
```

## 4. Core Contracts

```ts
type ResourceKind =
  | "Ontology"
  | "Class"
  | "ObjectProperty"
  | "DatatypeProperty"
  | "AnnotationProperty"
  | "NamedIndividual"
  | "Datatype"
  | "Restriction"
  | "External";

interface OntologyDocument {
  source: OntologySource;
  ontologyIri?: string;
  displayName: string;
  prefixes: Map<string, string>;
  resources: OntologyResource[];
  graph: OntologyGraphProjection;
  indexes: OntologyIndexes;
}

interface OntologyGraphProjection {
  nodeIds: string[];
  edges: OntologyGraphEdge[];
}
```

Indexes are constructed once with the document. UI components consume selectors rather than filtering all resources or edges.

## 5. G6 Boundary

Use G6 built-ins for:

- Node and edge rendering
- `map-node-size`
- ForceAtlas2, D3 Force, AntV Dagre, Circular
- `drag-canvas`, `scroll-canvas`, `zoom-canvas`
- `fix-element-size`
- `drag-element` and optional `drag-element-force`
- `hover-activate`, `click-select`, `focus-element`
- `optimize-viewport-transform`
- Legend, Minimap, Tooltip, Toolbar, Fullscreen

Custom implementation is justified for:

- OWL/RDF semantic extraction
- Semantic label tiers
- HTML detail tables
- File/recent-source lifecycle
- Persistence and export orchestration

The graph adapter returns declarative G6 configuration. It does not draw shapes manually or implement layout mathematics.

## 6. Runtime Profiles

### Formal app profile

- Stable Graph instance
- No animated initial layout
- Normal node dragging
- Size-based feature thresholds
- Source-keyed layout snapshots
- Complete import/export lifecycle

### Basic profile

- Single generated HTML artifact
- D3 `drag-element-force`
- Optional `auto-adapt-label` and Fisheye
- No recent files or persistence
- No large-graph performance guarantee

Both profiles share semantic rules and visual tokens once the single-file build replaces the current hand-maintained basic source.

## 7. Implementation Order

1. Lock product and architecture specs.
2. Implement ontology contracts and parser tests.
3. Implement graph projection and selector tests.
4. Implement declarative G6 adapter and layouts.
5. Implement stable graph controller/component.
6. Port detail and tooltip presentation from basic.
7. Add application source lifecycle and persistence.
8. Add export formats and performance profiles.
9. Generate the shareable basic artifact from shared source.
10. Extract an npm package only after contracts stabilize.

## 8. Package Policy

- All active implementation remains in `apps/ontology-viz`.
- No forwarding exports or compatibility wrappers are retained.
- Package extraction starts only after the model and graph contracts stabilize.
