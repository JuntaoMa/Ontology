/**
 * @ontology/viz — Default colour scheme
 *
 * All colours can be overridden per application via the DomainColorScheme type.
 */

import type { DomainColorScheme, ProvenanceLevel } from "./types";

/** Default domain → colour mapping. Override per application. */
export const DEFAULT_DOMAIN_COLORS: Record<string, string> = {
  TerminalDomain: "#ef4444",     // red — terminal
  RadioAccessDomain: "#22c55e",  // green — radio access
  TransportDomain: "#eab308",    // yellow — transport
  CoreNetworkDomain: "#3b82f6",  // blue — core network
  ServiceDomain: "#a855f7",      // purple — service
};

/** Provenance level → stroke colour */
export const DEFAULT_PROVENANCE_COLORS: Record<ProvenanceLevel, string> = {
  L1: "#15803d", // solid green — directly from spec
  L2: "#1d4ed8", // blue — ontologist inference
  L3: "#c2410c", // orange — non-normative extension
};

export const DEFAULT_COLOR_SCHEME: DomainColorScheme = {
  domainColors: DEFAULT_DOMAIN_COLORS,
  provenanceColors: DEFAULT_PROVENANCE_COLORS,
  defaultNodeColor: "#6b7280",   // gray
  defaultEdgeColor: "#9ca3af",   // lighter gray
};

/**
 * Resolve a domain IRI to a colour key.
 * Handles the pattern: .../5gs#CoreNetworkDomainInd → "CoreNetworkDomain"
 */
export function domainKeyFromIRI(domainIRI: string | undefined): string | undefined {
  if (!domainIRI) return undefined;
  // Trim trailing "Ind" suffix used for named individuals
  return domainIRI.split("#").pop()?.replace(/Ind$/, "");
}
