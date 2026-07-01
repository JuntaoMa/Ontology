# @ontology/viz — Ontology Visualization Component Library

Generic, domain-neutral React components for visualizing OWL/RDF ontology graphs with provenance evidence.

## Spec

- OWL 2 Web Ontology Language (W3C Recommendation)
- RDF Schema 1.1 (W3C Recommendation)
- RDF 1.1 Turtle (W3C Recommendation)

## Architecture

```
@ontology/viz
├── src/
│   ├── lib/
│   │   ├── types.ts      ← Core data model (domain-neutral)
│   │   ├── parser.ts      ← TTL → OntologyGraphData
│   │   └── colors.ts      ← Default colour scheme
│   ├── components/
│   │   ├── OntologyGraph.tsx   ← Main graph (React Flow)
│   │   ├── ProvenancePanel.tsx ← Provenance detail panel
│   │   └── FilterBar.tsx       ← Domain/gen/prov filters
│   ├── styles/
│   │   └── index.css      ← Base styles (CSS variables)
│   └── index.ts           ← Public API
```

## Data flow

```
TTL files (.ttl)
    │
    ▼
parser.ts (rdflib)
    │
    ▼
OntologyGraphData
    │  ├─ classes:        OntologyClass[]
    │  ├─ objectProperties: OntologyObjectProperty[]
    │  └─ individuals:    OntologyIndividual[]
    │
    ▼
OntologyGraph (React Flow)
    │  Nodes = classes + individuals
    │  Edges = objectProperty domain→range
    │
    ▼
User clicks node/edge
    │
    ▼
ProvenancePanel shows:
    │  L1: specRef + specClause
    │  L2: designRationale + derivedFrom
    │  L3: scopeNote + designRationale
```

## Provenance model

| Level | Meaning | Annotation |
|-------|---------|------------|
| **L1** | Direct spec reference | `specRef` + `specClause` |
| **L2** | Ontologist inference/abstraction | `designRationale` + `derivedFrom` |
| **L3** | Non-normative extension | `scopeNote` + `designRationale` |

## Usage

```tsx
import {
  parseTTLFiles,
  OntologyGraph,
  ProvenancePanel,
  FilterBar,
} from "@ontology/viz";
import "@ontology/viz/styles";

// 1. Parse ontology files
const data = parseTTLFiles([ttlContent1, ttlContent2]);

// 2. Render
function App() {
  const [selectedIRI, setSelectedIRI] = useState("");
  const [filters, setFilters] = useState<GraphFilters>({
    domains: [], generations: [], provenanceLevels: [], search: "",
  });

  const selected = /* find entity by IRI */;

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <div style={{ flex: 1 }}>
        <FilterBar
          filters={filters}
          onChange={setFilters}
          availableDomains={["TerminalDomain", "RadioAccessDomain", ...]}
          availableGenerations={["4G", "5G"]}
        />
        <OntologyGraph
          data={data}
          selectedIRI={selectedIRI}
          filters={filters}
          onSelect={setSelectedIRI}
        />
      </div>
      <div style={{ width: 380 }}>
        <ProvenancePanel
          entity={selected}
          onClose={() => setSelectedIRI("")}
        />
      </div>
    </div>
  );
}
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `@xyflow/react` (^12) | Graph rendering engine |
| `@dagrejs/dagre` | Layout algorithm (LR tree) |
| `rdflib` (^2) | RDF/Turtle parser |
| `react` / `react-dom` (^19) | UI framework (peer) |
