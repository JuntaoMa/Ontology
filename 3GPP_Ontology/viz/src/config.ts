/**
 * 3GPP Ontology Visualization — Application Configuration
 *
 * Defines TTL file paths, colour scheme, domain/generation mappings,
 * and other 3GPP-specific settings.
 */

import type {
  DomainColorScheme,
  FilterBarLabels,
  OntologyParseOptions,
  ProvenancePanelLabels,
  ProvenanceLevel,
} from "@ontology/viz";

const FGS_NS = "http://3gpp-ontology.org/ns/5gs#";
const DCT_NS = "http://purl.org/dc/terms/";
const SKOS_NS = "http://www.w3.org/2004/02/skos/core#";

/** Paths to TTL ontology files (served by vite plugin from /ontology/) */
export const TTL_FILES = [
  "/ontology/3gpp-5gs-topology.ttl",
  "/ontology/3gpp-epc-topology.ttl",
  "/ontology/3gpp-pm-qoe-scaffold.ttl",
];

/** 3GPP-specific domain colour scheme */
export const G3PP_COLOR_SCHEME: DomainColorScheme = {
  domainColors: {
    TerminalDomain: "#ef4444",       // red — terminal (UE)
    RadioAccessDomain: "#22c55e",    // green — radio access (gNB, eNB, Cell)
    TransportDomain: "#eab308",      // yellow — transport (fronthaul/midhaul/backhaul)
    CoreNetworkDomain: "#3b82f6",    // blue — core network (5GC + EPC NFs)
    ServiceDomain: "#a855f7",        // purple — service (DN, AF, ServiceProvider)
  },
  provenanceColors: {
    L1: "#15803d",  // solid green — directly from 3GPP spec
    L2: "#1d4ed8",  // blue — ontologist inference/abstraction
    L3: "#c2410c",  // orange — non-normative operational extension
  },
  defaultNodeColor: "#6b7280",
  defaultEdgeColor: "#9ca3af",
};

/** 3GPP-specific RDF vocabulary mapping for the generic parser */
export const G3PP_PARSE_OPTIONS: OntologyParseOptions = {
  baseIRI: "http://3gpp-ontology.org/ns/5gs",
  ontologyTitleFallback: "3GPP Ontology",
  secondaryLabelLang: "zh",
  vocabulary: {
    domainPropertyIRI: `${FGS_NS}belongsToDomain`,
    generationPropertyIRI: `${FGS_NS}generation`,
    abbreviationPropertyIRI: `${FGS_NS}abbreviation`,
    specRefPropertyIRI: `${FGS_NS}specRef`,
    specClausePropertyIRI: `${FGS_NS}specClause`,
    designRationalePropertyIRI: `${FGS_NS}designRationale`,
    derivedFromPropertyIRI: `${FGS_NS}derivedFrom`,
    scopeNotePropertyIRI: `${SKOS_NS}scopeNote`,
    sourcePropertyIRI: `${DCT_NS}source`,
  },
  individualTypeMatchers: [
    "ReferencePoint",
    "ServiceBasedInterface",
  ],
  propertyDirectionMatchers: {
    userPlane: ["userPlane"],
    controlPlane: ["controlPlane"],
  },
};

/** Domain display names (Chinese) */
export const DOMAIN_LABELS: Record<string, string> = {
  TerminalDomain: "终端域",
  RadioAccessDomain: "无线接入域",
  TransportDomain: "传输网域",
  CoreNetworkDomain: "核心网域",
  ServiceDomain: "服务域",
};

/** Chinese UI labels for the generic filter bar */
export const FILTER_LABELS: FilterBarLabels = {
  search: "搜索",
  searchPlaceholder: "类名、缩写、描述...",
  domains: "域",
  generations: "代际",
  provenanceLevels: "溯源层级",
  all: "全部",
};

/** Chinese UI labels for the generic provenance panel */
export const PROVENANCE_PANEL_LABELS: ProvenancePanelLabels = {
  closeTitle: "关闭",
  basicInfo: "基本信息",
  iri: "IRI",
  abbreviation: "缩写",
  type: "类型",
  classType: "类 (owl:Class)",
  objectPropertyType: "对象属性 (owl:ObjectProperty)",
  individualType: "个体 (NamedIndividual)",
  secondaryName: "中文名",
  description: "描述",
  provenance: "溯源证据",
  specRef: "Spec 引用",
  specClause: "条款",
  source: "数据源",
  derivedFrom: "推导自",
  designRationale: "设计理由",
  scopeNote: "范围说明",
  topology: "拓扑约束",
  domain: "domain",
  range: "range",
  subPropertyOf: "subPropertyOf",
};

export const PROVENANCE_LEVEL_LABELS: Record<ProvenanceLevel, string> = {
  L1: "L1 · spec 直接引用",
  L2: "L2 · 本体推导",
  L3: "L3 · 非规范扩展",
};

/** Available generations in the 3GPP ontology */
export const AVAILABLE_GENERATIONS = ["4G", "5G"];

/** Available domains (from NetworkDomain subclasses) */
export const AVAILABLE_DOMAINS = [
  "TerminalDomain",
  "RadioAccessDomain",
  "TransportDomain",
  "CoreNetworkDomain",
  "ServiceDomain",
];
