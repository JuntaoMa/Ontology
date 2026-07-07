# ConfigurableOntologyViewer Redesign

## Overview

Redesign the ontology visualization component with a clean three-zone layout: app header, canvas with floating toolbar, and status bar. Nodes rendered as compact dots with acronym-based labels. Settings moved to a centered modal.

---

## Layout Architecture

```
┌────────────────────────────────────────────────────────┐
│ ⬡ OntologyViz │ NPD v2.owl     [Recent ▾] [Import]    │  App Header (48px)
├────────────────────────────────────────────────────────┤
│          ┌───────────────────────────────────┐         │
│          │ 🔍 search │ Dagre ▾ │ ⊡ − 100% + │  Tools  │
│          └───────────────────────────────────┘         │
│                                                        │
│               ● ●  ●  ●         ●                      │  Canvas
│              ●    ●    ●    ●     ●                    │  (ReactFlow)
│                ●  ●        ●  ●                       │
│                                                        │
│                                        ┌──────┐        │
│                                        │MiniMap│       │
├────────────────────────────────────────────────────────┤
│ Nodes: 124  │  Edges: 386                              │  Status Bar (28px)
└────────────────────────────────────────────────────────┘
```

---

## Component Tree

```
ConfigurableOntologyViewer (page-level)
├── AppHeader
│   ├── Logo "OntologyViz"
│   ├── Ontology name
│   ├── Recent files dropdown
│   └── Import button
├── Canvas (ReactFlow + ConfigurableOntologyGraph)
│   ├── FloatingToolbar (ReactFlow child, absolute positioned)
│   │   ├── Search input
│   │   ├── Layout dropdown (Dagre / D3 Force)
│   │   ├── Zoom controls (fit / - / % / + / 1:1)
│   │   └── Settings button
│   ├── ExplicitOntologyNode (compact dot)
│   ├── MiniMap
│   ├── Controls (hidden, replaced by custom toolbar)
│   └── SettingsModal (overlay)
│       ├── Card fields config
│       ├── Color scheme
│       ├── Edge display
│       ├── Visible types
│       └── Reset / Apply buttons
└── StatusBar
    ├── Node count
    └── Edge count
```

---

## Node Design

### Compact Dot (only mode for now)

```
┌────┐
│UPF │  36×36 circle, entity type color background
└────┘  white acronym text, 10px bold
```

Label generation: `compactLabel(entity)` extracts uppercase letters from camelCase `localName`, falls back to first 4 chars.

### Removed Modes

- Intermediate card and expanded card (mock only, not implemented)
- Type Groups layout (removed entirely)

---

## Layout Modes

| Mode | Value | Description |
|------|-------|-------------|
| Dagre | `"layered"` | Left-to-right hierarchical (Sugiyama) |
| D3 Force | `"force"` | Force-directed with d3-force |

`ExplicitOntologyLayoutMode` type reduces to `"layered" | "force"`.

---

## Floating Toolbar Controls

| Control | Implementation |
|---------|---------------|
| Search input | `onChange` → set search state → filters nodes via existing `matchesSearch` |
| Layout dropdown | `<select>` → updates `config.layoutMode`, triggers layout recompute |
| Fit view (⊡) | `fitView({ padding: 0.08 })` |
| Zoom in (+) | `zoomIn({ duration: 200 })` |
| Zoom out (−) | `zoomOut({ duration: 200 })` |
| 1:1 | `setViewport({ x: 0, y: 0, zoom: 1 })` |
| Settings (⚙) | Opens modal overlay |

All zoom controls use ReactFlow's `useReactFlow()` API.

---

## Settings Modal

Centered overlay with backdrop. Sections:

1. **Card fields** — title field, subtitle field, badge fields (for future expanded mode)
2. **Color scheme** — by type / by field radio
3. **Edge display** — show labels checkbox, show arrows checkbox
4. **Visible types** — per-entity-kind checkboxes with counts

Footer: Reset defaults + Apply buttons.

---

## Status Bar

Fixed bottom bar showing: `Nodes: {count}  |  Edges: {count}`.

---

## Data Model Changes

- `ExplicitOntologyLayoutMode` → remove `"typeGroups"`
- `ExplicitOntologyVisualConfig.layoutMode` → default changed from `"layered"` to `"force"`
- `DEFAULT_EXPLICIT_ONTOLOGY_CONFIG.layoutMode` → `"force"`
- Remove `layoutTypeGroups` function
- Remove `layoutForce` (d3-force card version), keep existing `layoutForce` (dot version)
- Add `compactLabel(entity)` utility

---

## Files Changed

| File | Change |
|------|--------|
| `lib/explicitOntologyTypes.ts` | Remove `"typeGroups"` from `ExplicitOntologyLayoutMode` |
| `components/ConfigurableOntologyViewer.tsx` | Full rewrite of component shell + toolbar + settings modal |
| `styles/index.css` | Add toolbar, modal, dot-node styles |

---

## Consumer Impact

`NpdOwlExplorer.tsx` — imports `ConfigurableOntologyViewer` as before, no API change. The "分组" button in the old config panel will disappear (typeGroups removed). Existing localStorage config with `layoutMode: "typeGroups"` should gracefully fall back to `"force"`.
