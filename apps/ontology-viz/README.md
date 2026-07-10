# OntologyViz App

Generic Vite shell for `@ontology/viz`.

## Start

```bash
cd apps/ontology-viz
pnpm dev
```

The app opens the bundled NPD ontology by default. The Apache-2.0 license for the NPD benchmark asset is included in `public/NPD-LICENSE.txt`.

## Override Default Source

To use another ontology URL instead of the bundled NPD file:

```bash
VITE_ONTOLOGY_SOURCE_URL=/path/to/ontology.owl pnpm dev
```
