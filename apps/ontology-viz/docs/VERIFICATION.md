# OntologyViz Verification

## Automated Gates

Run from the repository root:

```bash
pnpm typecheck
pnpm build
```

Both commands operate directly on `apps/ontology-viz`; no package build or
compatibility layer is involved.

## Browser Regression Matrix

| Requirement | Fixture | Expected result |
| --- | --- | --- |
| RDF/XML parsing and saved layout | Bundled NPD | 1,198 Class/Named Individual nodes and 2,909 visible relations; graph renders without initial force calculation |
| Turtle parsing and full details | `fixtures/complete-display.ttl` | 13 nodes and 19 edges |
| Hidden semantic resources | Complete fixture | Ontology, properties, datatypes, restrictions, and external references do not become main graph nodes |
| Attached semantics | Complete fixture, `Employee` | Basic metadata, grouped multilingual labels, three property kinds, restriction, and incoming/outgoing tables are present |
| Search and focus | NPD, `Facility` | Search returns typed results; selection opens details and focuses the node |
| Canvas tools | Any fixture | G6 toolbar exposes zoom, image export, fullscreen, and layout settings |
| Layouts | Complete fixture | ForceAtlas2, D3 Force, Dagre, and Circular can be selected without recreating the application |
| Pointer behavior | Any fixture | drag pans; plain wheel/two-finger scroll pans; pinch (`ctrlKey` wheel) zooms |
| Persistence | Imported complete fixture | Source appears in Recent; layout preference is keyed by source identity |
| Runtime health | NPD and complete fixture | No browser console errors after load, selection, detail, recent-source open, or layout switch |

## Deferred Gates

- Worker-based parsing and layout for very large ontologies
- Layout snapshot import UI
- Generated single-file `basic.html` from shared source
- npm package extraction after contracts stabilize
