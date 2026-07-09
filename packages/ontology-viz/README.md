# @ontology/viz

G6-first ontology visualization package for parsing OWL/RDF ontology files and embedding graph views in React products.

## Standalone app

```tsx
import { OntologyVizApp } from "@ontology/viz/standalone";
import "@ontology/viz/styles";

export function App() {
  return <OntologyVizApp />;
}
```

## Core parser

```ts
import { parseOntology, type OntologyGraphData } from "@ontology/viz/core";

const data: OntologyGraphData = parseOntology(content, {
  contentType: "application/rdf+xml",
  ontologyTitleFallback: "Ontology",
});
```

## G6 adapter

```ts
import { createG6LayoutOptions, toG6GraphData } from "@ontology/viz/g6";

const graphData = toG6GraphData(data);
const layout = createG6LayoutOptions("force-atlas2");
```

## React components

```tsx
import {
  OntologyDetailPanel,
  OntologyGraphCanvas,
  OntologyLayoutControl,
} from "@ontology/viz/react";
import type { OntologyGraphData } from "@ontology/viz/core";

export function Viewer({ data }: { data: OntologyGraphData }) {
  return <OntologyGraphCanvas data={data} />;
}
```

## Data flow

```text
OWL/RDF/XML or Turtle content
  -> parseOntology
  -> OntologyGraphData
  -> toG6GraphData / createG6LayoutOptions
  -> OntologyGraphCanvas
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `@antv/g6` | Graph rendering, layout, behavior, and plugins |
| `n3` | Turtle parsing |
| `react` / `react-dom` | UI peer dependencies |
