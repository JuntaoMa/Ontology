# OntologyViz Product Specification

## 1. Product Scope

OntologyViz is a browser application for opening ontology files and exploring their class and individual graph.

The development version is app-first:

- All runtime code lives under `apps/ontology-viz`.
- No compatibility requirement exists for the previous `@ontology/viz` package.
- Package extraction is deferred until the app API and data model are stable.
- G6 owns graph rendering, layouts, viewport behaviors, element states, legend, minimap, tooltip, and canvas tools.
- Application code owns ontology semantics, file lifecycle, settings, persistence, and detail presentation.

The shareable `basic.html` remains a separate single-file viewer. It follows the same visual language but may enable visually rich G6 behaviors that are unsuitable for large graphs.

## 2. Supported Inputs

### INPUT-01 File import

The app shall import local files with these extensions:

- Turtle family: `.ttl`, `.n3`, `.nt`, `.trig`, `.nq`
- RDF/XML family: `.owl`, `.rdf`, `.xml`

### INPUT-02 Default source

The app may load a configured default ontology URL on startup.

### INPUT-03 Source identity

Each source shall have a stable identity used to store view preferences and layout snapshots. File identity shall include content-derived information rather than a local path alone.

### INPUT-04 Parse errors

Unsupported or invalid input shall show a readable error without destroying the previously loaded ontology.

## 3. Ontology Model

### MODEL-01 Explicit semantics

The parser shall preserve explicitly declared resources without ontology-specific inference:

- `owl:Ontology`
- `owl:Class`, `rdfs:Class`, `owl:DeprecatedClass`
- `owl:ObjectProperty`
- `owl:DatatypeProperty`
- `owl:AnnotationProperty`
- `owl:NamedIndividual` and explicitly typed individuals
- `rdfs:Datatype`
- `owl:Restriction`
- referenced external resources

### MODEL-02 Main graph projection

The default main graph shall contain only:

- Class nodes
- Named Individual nodes
- Relations whose source and target are both visible graph nodes

Ontology, property, datatype, restriction, and external-reference resources shall not become default main-graph nodes.

### MODEL-03 Attached semantics

Properties, ranges, restrictions, labels, descriptions, traits, literal values, and annotations shall remain available to tooltip and detail views.

### MODEL-04 Indexes

The parsed document shall expose indexed access to resources, edges, adjacency, and properties by owner. Selecting an element must not scan the entire graph.

### MODEL-05 Stable IDs

Named resources use their IRI as ID. Blank nodes receive document-stable IDs. G6 edge IDs shall be deterministic within a document.

## 4. Graph Presentation

### GRAPH-01 G6-first implementation

Graph nodes, edges, layouts, interactions, states, legend, minimap, tooltip, and toolbar shall use G6 built-ins unless a verified requirement cannot be met by G6.

### GRAPH-02 Visual types

- Class uses Earl Orange `#e38c7a`.
- Named Individual uses Fantasy Blue `#99a4bc`.
- Remaining semantic colors stay defined for detail badges and future projections.
- Edges are straight lines with center-to-center endpoints.

### GRAPH-03 Node size

Node size shall use G6 degree centrality mapping with a logarithmic scale and configurable minimum and maximum sizes.

### GRAPH-04 Labels

Labels shall prefer Chinese, then English, then an untagged label, then local name.

Label visibility shall use semantic zoom:

- Overview: highest-priority Class labels.
- Browse: additional Class labels.
- Detail: lower-priority Class labels.
- Inspect: Named Individual labels.

Labels shall be one line with ellipsis.

### GRAPH-05 Selection

Selecting a node or edge shall highlight it and its one-hop neighborhood. Unrelated elements may be dimmed only below a configured graph-size threshold.

### GRAPH-06 Viewport behavior

- Pointer drag moves the canvas.
- Mouse wheel or two-finger scroll moves the canvas.
- Pinch gestures, represented by wheel events with `ctrlKey`, zoom the canvas.
- Toolbar zoom remains available.
- Zooming in may keep node key shapes visually stable; zooming out may reduce them to points.

### GRAPH-07 Layouts

The first release shall provide:

- ForceAtlas2 with a collision refinement pass
- D3 Force
- AntV Dagre
- Circular

Changing layout shall not recreate the entire application.

### GRAPH-08 Canvas tools

The canvas shall expose G6-native zoom in, zoom out, image export, fullscreen, legend, minimap, tooltip, and layout settings entry.

## 5. Details

### DETAIL-01 Visibility

The detail panel is hidden when no node or edge is selected.

### DETAIL-02 Node detail

Node detail shall show:

- Name and standard OWL type
- Basic metadata and multilingual labels
- Object, datatype, and annotation properties
- Outgoing and incoming graph relations
- Remaining annotations not already represented

All tabular sections use one consistent table component and column behavior.

### DETAIL-03 Edge detail

Edge detail shall show relation name, predicate, source, target, and available description.

### DETAIL-04 Tooltip

Tooltip shall be concise, remain above the detail panel, and show the name, type, compact IRI, property names, and available description.

## 6. Application Lifecycle

### APP-01 Recent sources

The formal app shall maintain recent URL and file sources. The basic viewer does not.

### APP-02 Preferences

Layout choice, visual settings, and layout snapshots shall be stored by source identity.

### APP-03 Import and export

The formal app shall support:

- Ontology file import
- PNG export through G6
- Normalized ontology JSON export
- G6 graph JSON export
- Layout snapshot export and import

Normalized and layout exports may follow after graph parity, but their data contracts must be defined before implementation.

## 7. Performance

### PERF-01 Stable graph instance

Selection, focus, tooltip, detail opening, and preference changes shall not recreate the G6 Graph instance.

### PERF-02 Derived data

Ontology parsing, graph projection, label levels, degree, and adjacency indexes shall be computed once per document revision.

### PERF-03 Large graph profile

The formal app shall disable or reduce expensive features by graph size, including unrelated-element dimming, arrows, animated layouts, dynamic force dragging, and frequent minimap refresh.

### PERF-04 Progressive work

Worker-based parsing/layout and advanced level-of-detail rendering are later optimizations. The architecture shall allow them without changing the public document model.

## 8. Acceptance Fixtures

The following fixtures form the regression set:

- `fixtures/complete-display.ttl`: complete semantic and detail presentation.
- NPD ontology: large, authoritative OWL/RDF ontology.
- 3GPP ontology: telecommunications domain labels and relations.
- Telecom Operations catalog: thousands of individuals and sparse/mixed relations.

Each fixture shall verify parse counts, graph projection counts, hidden property nodes, detail completeness, selection, layout switching, and absence of runtime errors.
