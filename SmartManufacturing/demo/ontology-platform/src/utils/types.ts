export type ResourceType = "Object" | "Link" | "Function" | "Action";
export type PageKind = "about" | "import" | "ontology" | "qa";
export type GraphMode = "all" | "semantic" | "capability";

export interface DomainMeta {
  id: string;
  name: string;
  summary: string;
  manifest: string;
  resourceLayout: string;
  status: string;
}

export interface ManifestFile {
  id: string;
  name: string;
  summary: string;
  entryActions?: string[];
  questionPatterns?: string[];
  ontology: {
    objects: string;
    links: string;
    functions: string;
    actions: string;
  };
  runtime: {
    entrypoints: string;
    pathTemplates: string;
    capabilityGraph: string;
  };
  logic: {
    functionDir: string;
    actionDir: string;
  };
}

export interface ObjectResource {
  id: string;
  name: string;
  summary: string;
  identityFields: string[];
  mainDisplayFields: string[];
  properties: string[];
}

export interface LinkResource {
  id: string;
  name: string;
  summary: string;
  fromObject: string;
  toObject: string;
  cardinality: string;
}

export interface Boundary {
  responsibleFor: string[];
  notResponsibleFor: string[];
}

export interface FunctionResource {
  id: string;
  name: string;
  summary: string;
  inputs: string[];
  outputs: string[];
  readsObjects: string[];
  traversesLinks: string[];
  writesObjects: string[];
  callsFunctions: string[];
  capabilityBoundary: Boundary;
  logicRef: string;
  logicStatus: string;
}

export interface ActionResource {
  id: string;
  name: string;
  summary: string;
  inputs: string[];
  outputs: string[];
  anchorObjects: string[];
  readsObjects: string[];
  traversesLinks: string[];
  writesObjects: string[];
  dependsOnFunctions: string[];
  dependsOnActions: string[];
  capabilityBoundary: Boundary;
  logicRef: string;
  logicStatus: string;
}

export interface RuntimeEntrypoint {
  id: string;
  kind: string;
  summary: string;
}

export interface PathTemplate {
  id: string;
  startObject: string;
  targetObject: string;
  goal: string;
  path: string[];
  returns?: string[];
  expansionMode?: string;
}

export interface CapabilityGraphNode {
  id: string;
  resourceType: string;
  ref: string;
  name: string;
}

export interface CapabilityGraphEdge {
  from: string;
  to: string;
  type: string;
  via?: string;
}

export interface CapabilityGraph {
  domain: string;
  nodes: CapabilityGraphNode[];
  edges: CapabilityGraphEdge[];
}

export interface DomainBundle {
  domainMeta: DomainMeta;
  manifest: ManifestFile;
  objects: ObjectResource[];
  links: LinkResource[];
  functions: FunctionResource[];
  actions: ActionResource[];
  entrypoints: RuntimeEntrypoint[];
  pathTemplates: PathTemplate[];
  capabilityGraph: CapabilityGraph;
  logicTexts: Record<string, string>;
}

export interface ResourceReference {
  type: ResourceType;
  id: string;
}

export interface ResourceDraft {
  metadata?: Record<string, unknown>;
  logicText?: string;
}

export interface PlatformState {
  currentDomainId: string;
  selectedResource: ResourceReference;
  drafts: Record<string, ResourceDraft>;
  recentCaseId: string | null;
}

export interface DemoCase {
  id: string;
  domainId: string;
  title: string;
  question: string;
  hints: string[];
  problemClass: string;
  capabilityAssessment: string;
  conclusions: string[];
  matched: {
    objects: string[];
    links: string[];
    functions: string[];
    actions: string[];
  };
  steps: Array<{
    tool: string;
    purpose: string;
    result: string;
  }>;
  summary: {
    domain: string;
    anchors: string[];
    resultHeadline: string;
  };
  proposedCapabilities?: Array<{
    type: string;
    id: string;
    name: string;
    summary: string;
    logic: string[];
  }>;
}
