# @ontology/viz

Generic React ontology visualization package for importing and exploring OWL/RDF ontology files.

## Current API

For a complete generic app shell:

```tsx
import { OntologyVizApp } from "@ontology/viz";
import "@ontology/viz/styles";

export function App() {
  return <OntologyVizApp />;
}
```

For direct control over parsed data:

```tsx
import {
  ConfigurableOntologyViewer,
  parseExplicitOntology,
  type ExplicitOntologyGraphData,
} from "@ontology/viz";
import "@ontology/viz/styles";

const data: ExplicitOntologyGraphData = parseExplicitOntology(content, {
  contentType: "application/rdf+xml",
  ontologyTitleFallback: "Ontology",
});

export function App() {
  return <ConfigurableOntologyViewer data={data} />;
}
```

## Data Flow

```text
OWL/RDF/XML or Turtle file
  -> parseExplicitOntology
  -> ExplicitOntologyGraphData
  -> OntologyVizApp / ConfigurableOntologyViewer
```

## Components

- `OntologyVizApp`: complete generic app shell with optional default URL loading, file import, parser inference, loading/error states, and persisted viewer settings.
- `ConfigurableOntologyViewer`: complete ontology viewer with import-oriented configuration, layout controls, search, selection highlighting, details panel, and persisted settings.

## Parser

- `parseExplicitOntology`: parses explicit OWL/RDF ontology entities:
  - `owl:Class`
  - `owl:ObjectProperty`
  - `owl:DatatypeProperty`
  - `owl:AnnotationProperty`

## Dependencies

| Package | Purpose |
|---------|---------|
| `@xyflow/react` | Graph rendering |
| `@dagrejs/dagre` | Layered layout |
| `d3-force` | Force-directed layout |
| `n3` | Turtle parsing |
| `react` / `react-dom` | UI peer dependencies |
