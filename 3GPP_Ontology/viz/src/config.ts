/**
 * 3GPP Ontology Visualization — Application Configuration
 *
 * Defines TTL file paths, colour scheme, domain/generation mappings,
 * and other 3GPP-specific settings.
 */

import type { DomainColorScheme } from "@ontology/viz";

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

/** Domain display names (Chinese) */
export const DOMAIN_LABELS: Record<string, string> = {
  TerminalDomain: "终端域",
  RadioAccessDomain: "无线接入域",
  TransportDomain: "传输网域",
  CoreNetworkDomain: "核心网域",
  ServiceDomain: "服务域",
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
