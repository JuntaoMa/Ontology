# @ontology/viz

G6-first ontology visualization package for parsing OWL/RDF ontology files and embedding graph views in React products.

## Install

```sh
pnpm add @ontology/viz
```

```sh
npm install @ontology/viz
```

The package expects React and ReactDOM 19 from the host application.

## Package entry points

| Import | Purpose |
|--------|---------|
| `@ontology/viz/core` | Ontology data types and OWL/RDF parser |
| `@ontology/viz/g6` | G6 data adapter, layouts, and plugin options |
| `@ontology/viz/react` | Embeddable graph canvas and optional React controls |
| `@ontology/viz/standalone` | Complete app shell with import, recent files, and local preferences |
| `@ontology/viz/styles` | Component stylesheet |

## Build

```sh
pnpm --filter @ontology/viz build
```

The package builds unbundled ESM, type declarations, and `dist/styles.css` for frontend bundlers.

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
import {
  createG6DegreeNodeSizeTransform,
  createG6FisheyePlugin,
  createG6LayoutOptions,
  createG6StandalonePlugins,
  toG6GraphData,
} from "@ontology/viz/g6";

const graphData = toG6GraphData(data);
const layout = createG6LayoutOptions("force-atlas2");
const incomingDegreeSize = createG6DegreeNodeSizeTransform({ direction: "in" });
const plugins = createG6StandalonePlugins();
const optionalFisheye = createG6FisheyePlugin();
```

`OntologyGraphCanvas` uses G6's `map-node-size` transform by default. It maps total degree to `24-44px` with a logarithmic scale. Pass `transforms={[]}` to disable it, or pass a memoized transform list to use incoming or outgoing degree instead.

The default canvas behaviors use G6's `fix-element-size` while zoomed above 100%, so nodes and labels remain stable while graph distances expand. `createG6StandalonePlugins()` includes the native tooltip, toolbar, and fullscreen plugins. Fisheye is opt-in because it updates graph geometry and can conflict with click selection on dense graphs.

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
