import domainsIndex from "../../../../.codex/skills/ontology-platform/domains/index.json";
import manufactureManifest from "../../../../.codex/skills/ontology-platform/domains/manufacture-design-change/manifest.json";
import manufactureObjects from "../../../../.codex/skills/ontology-platform/domains/manufacture-design-change/ontology/objects.json";
import manufactureLinks from "../../../../.codex/skills/ontology-platform/domains/manufacture-design-change/ontology/links.json";
import manufactureFunctions from "../../../../.codex/skills/ontology-platform/domains/manufacture-design-change/ontology/functions.json";
import manufactureActions from "../../../../.codex/skills/ontology-platform/domains/manufacture-design-change/ontology/actions.json";
import manufactureEntrypoints from "../../../../.codex/skills/ontology-platform/domains/manufacture-design-change/runtime/entrypoints.json";
import manufacturePathTemplates from "../../../../.codex/skills/ontology-platform/domains/manufacture-design-change/runtime/path-templates.json";
import manufactureCapabilityGraph from "../../../../.codex/skills/ontology-platform/domains/manufacture-design-change/runtime/capability-graph.json";
import sampleManifest from "../../../../.codex/skills/ontology-platform/domains/sample-generic/manifest.json";
import sampleObjects from "../../../../.codex/skills/ontology-platform/domains/sample-generic/ontology/objects.json";
import sampleLinks from "../../../../.codex/skills/ontology-platform/domains/sample-generic/ontology/links.json";
import sampleFunctions from "../../../../.codex/skills/ontology-platform/domains/sample-generic/ontology/functions.json";
import sampleActions from "../../../../.codex/skills/ontology-platform/domains/sample-generic/ontology/actions.json";
import sampleEntrypoints from "../../../../.codex/skills/ontology-platform/domains/sample-generic/runtime/entrypoints.json";
import samplePathTemplates from "../../../../.codex/skills/ontology-platform/domains/sample-generic/runtime/path-templates.json";
import sampleCapabilityGraph from "../../../../.codex/skills/ontology-platform/domains/sample-generic/runtime/capability-graph.json";
import buildReportLogic from "../../../../.codex/skills/ontology-platform/domains/manufacture-design-change/logic/functions/build_report.md?raw";
import buildScopeLogic from "../../../../.codex/skills/ontology-platform/domains/manufacture-design-change/logic/functions/build_scope.md?raw";
import calcAssemblyReadyLogic from "../../../../.codex/skills/ontology-platform/domains/manufacture-design-change/logic/functions/calc_assembly_ready.md?raw";
import calcLeafReadyLogic from "../../../../.codex/skills/ontology-platform/domains/manufacture-design-change/logic/functions/calc_leaf_ready.md?raw";
import calcReadyLogic from "../../../../.codex/skills/ontology-platform/domains/manufacture-design-change/logic/functions/calc_ready.md?raw";
import checkInventoryLogic from "../../../../.codex/skills/ontology-platform/domains/manufacture-design-change/logic/functions/check_inventory.md?raw";
import createReportLogic from "../../../../.codex/skills/ontology-platform/domains/manufacture-design-change/logic/actions/create_report.md?raw";
import sampleActionLogic from "../../../../.codex/skills/ontology-platform/domains/sample-generic/logic/actions/resolve.md?raw";
import sampleFunctionAssessLogic from "../../../../.codex/skills/ontology-platform/domains/sample-generic/logic/functions/assess.md?raw";
import sampleFunctionNormalizeLogic from "../../../../.codex/skills/ontology-platform/domains/sample-generic/logic/functions/normalize.md?raw";
import sampleFunctionSummarizeLogic from "../../../../.codex/skills/ontology-platform/domains/sample-generic/logic/functions/summarize.md?raw";
import type { DomainBundle, DomainMeta } from "../utils/types";

const logicTextsByDomain: Record<string, Record<string, string>> = {
  "manufacture-design-change": {
    "Function:build_scope": buildScopeLogic,
    "Function:check_inventory": checkInventoryLogic,
    "Function:calc_leaf_ready": calcLeafReadyLogic,
    "Function:calc_assembly_ready": calcAssemblyReadyLogic,
    "Function:calc_ready": calcReadyLogic,
    "Function:build_report": buildReportLogic,
    "Action:create_report": createReportLogic,
  },
  "sample-generic": {
    "Function:normalize": sampleFunctionNormalizeLogic,
    "Function:assess": sampleFunctionAssessLogic,
    "Function:summarize": sampleFunctionSummarizeLogic,
    "Action:resolve": sampleActionLogic,
  },
};

const bundleFiles = {
  "manufacture-design-change": {
    manifest: manufactureManifest,
    objects: manufactureObjects,
    links: manufactureLinks,
    functions: manufactureFunctions,
    actions: manufactureActions,
    entrypoints: manufactureEntrypoints,
    pathTemplates: manufacturePathTemplates,
    capabilityGraph: manufactureCapabilityGraph,
  },
  "sample-generic": {
    manifest: sampleManifest,
    objects: sampleObjects,
    links: sampleLinks,
    functions: sampleFunctions,
    actions: sampleActions,
    entrypoints: sampleEntrypoints,
    pathTemplates: samplePathTemplates,
    capabilityGraph: sampleCapabilityGraph,
  },
} as const;

const domainMetaIndex = new Map<string, DomainMeta>(
  (domainsIndex.domains as DomainMeta[]).map((item) => [item.id, item]),
);

export const DOMAIN_BUNDLES: DomainBundle[] = Object.entries(bundleFiles).map(([domainId, files]) => ({
  domainMeta: domainMetaIndex.get(domainId)!,
  manifest: files.manifest,
  objects: files.objects.objects,
  links: files.links.links,
  functions: files.functions.functions,
  actions: files.actions.actions,
  entrypoints: files.entrypoints.entrypoints,
  pathTemplates: files.pathTemplates.templates,
  capabilityGraph: files.capabilityGraph,
  logicTexts: logicTextsByDomain[domainId] || {},
}));

export function getDomainBundle(domainId: string): DomainBundle {
  return DOMAIN_BUNDLES.find((bundle) => bundle.domainMeta.id === domainId) || DOMAIN_BUNDLES[0];
}

export function getDomains(): DomainMeta[] {
  return domainsIndex.domains as DomainMeta[];
}
