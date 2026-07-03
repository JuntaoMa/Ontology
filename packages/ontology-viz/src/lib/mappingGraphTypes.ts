export interface BilingualLabel {
  en: string;
  zh: string;
}

export type MappingGraphNodeKind = "ontologyObject" | "ontologyRelation" | "sourceTable";
export type MappingGraphEdgeKind =
  | "tableToObject"
  | "tableToRelation"
  | "objectToRelation"
  | "relationToObject";

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
  relations?: string[];
}

export interface MappingGraphRelationNode extends MappingGraphNodeBase {
  kind: "ontologyRelation";
  predicate: string;
  sourceObjectId: string;
  targetObjectId: string;
  sourceObjectName: string;
  targetObjectName: string;
  sourceColumns: string[];
  mappings: MappingGraphEdgeMapping[];
}

export interface MappingGraphSourceTableNode extends MappingGraphNodeBase {
  kind: "sourceTable";
  sourceColumns: string[];
}

export type MappingGraphNode =
  | MappingGraphObjectNode
  | MappingGraphRelationNode
  | MappingGraphSourceTableNode;

export interface MappingGraphEdge {
  id: string;
  kind: MappingGraphEdgeKind;
  source: string;
  target: string;
  label: BilingualLabel;
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
