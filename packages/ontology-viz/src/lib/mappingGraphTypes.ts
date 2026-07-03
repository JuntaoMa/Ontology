export interface BilingualLabel {
  en: string;
  zh: string;
}

export type MappingGraphNodeKind = "ontologyObject" | "sourceTable";
export type MappingGraphEdgeKind =
  | "tableToObject"
  | "objectRelation";

export interface MappingGraphClassMapping {
  mappingId: string;
  sourceTables: string[];
  sourceColumns: string[];
  targetColumns: string[];
  targetSubject: string;
  abstraction: string;
  condition?: string;
}

export interface MappingGraphProperty {
  mappingId: string;
  name: string;
  label: BilingualLabel;
  predicate: string;
  sourceTables: string[];
  sourceColumns: string[];
  targetColumns: string[];
  targetSubject: string;
  targetObject: string;
  abstraction: string;
  condition?: string;
}

export interface MappingGraphEdgeMapping {
  mappingId: string;
  sourceTables?: string[];
  sourceColumns: string[];
  targetColumns?: string[];
  targetSubject?: string;
  targetObject?: string;
  targetProperty?: string;
  targetLabel?: BilingualLabel;
  abstraction: string;
  condition?: string;
}

interface MappingGraphNodeBase {
  id: string;
  kind: MappingGraphNodeKind;
  name: string;
  label: BilingualLabel;
  sourceTables: string[];
  sourceColumns?: string[];
  mappingIds: string[];
}

export interface MappingGraphObjectNode extends MappingGraphNodeBase {
  kind: "ontologyObject";
  uriTemplates: string[];
  classMappings: MappingGraphClassMapping[];
  properties: MappingGraphProperty[];
  /** Relation edge ids where this object is source or target. */
  relations?: string[];
}

export interface MappingGraphSourceTableNode extends MappingGraphNodeBase {
  kind: "sourceTable";
  sourceColumns: string[];
}

export type MappingGraphNode =
  | MappingGraphObjectNode
  | MappingGraphSourceTableNode;

export interface MappingGraphEdge {
  id: string;
  kind: MappingGraphEdgeKind;
  name?: string;
  predicate?: string;
  source: string;
  target: string;
  label: BilingualLabel;
  sourceObjectName?: string;
  targetObjectName?: string;
  sourceTables: string[];
  sourceColumns: string[];
  targetProperties: string[];
  mappingIds: string[];
  mappings: MappingGraphEdgeMapping[];
}

export interface MappingGraphData {
  schemaVersion: number;
  source: string;
  generatedFrom: string;
  stats: {
    mappingCount: number;
    ontologyObjectCount: number;
    ontologyRelationCount: number;
    sourceTableCount: number;
    dataPropertyMappingCount: number;
    classMappingCount: number;
  };
  nodes: MappingGraphNode[];
  edges: MappingGraphEdge[];
}

export type MappingGraphLayoutMode = "dagre" | "force";

export interface MappingGraphNodeData extends Record<string, unknown> {
  node: MappingGraphNode;
  selected: boolean;
}

export interface MappingGraphEdgeData extends Record<string, unknown> {
  edge: MappingGraphEdge;
}
