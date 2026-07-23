import { Parser, type Quad, type Term } from "n3";
import { RdfXmlParser } from "rdfxml-streaming-parser";

import type {
  LocalizedValue,
  OntologyDocument,
  OntologyFormat,
  OntologyGraphEdge,
  OntologyIndexes,
  OntologyResource,
  OntologyRestriction,
  OntologyValue,
  ParseOntologyInput,
  PropertyAssociation,
  PropertyKind,
  ResourceKind,
} from "./types";
import {
  DESCRIPTION_PREDICATES,
  DCTERMS,
  EDGE_DEFINITION_BY_PREDICATE,
  GRAPH_KINDS,
  LABEL_PREDICATES,
  META_TYPES,
  OWL,
  PROPERTY_KIND_ORDER,
  PROPERTY_KINDS,
  PROPERTY_TRAIT_BY_TYPE,
  RDF_TYPE,
  RDFS,
  RESTRICTION_OPERATOR_BY_PREDICATE,
  RESTRICTION_OWNER_PREDICATES,
  RESOURCE_KIND_BY_TYPE,
  RESOURCE_KIND_PRIORITY,
  XSD,
} from "./vocabulary";

const LABEL_LANGUAGE_PRIORITY = ["zh", "en", ""];

function termId(term?: Term) {
  if (!term) return undefined;
  if (term.termType === "NamedNode") return term.value;
  if (term.termType === "BlankNode") return `_:${term.value}`;
  return undefined;
}

export function localName(value: string) {
  if (!value) return "";
  if (value.startsWith("_:")) return value;
  const index = Math.max(
    value.lastIndexOf("#"),
    value.lastIndexOf("/"),
    value.lastIndexOf(":"),
  );
  const raw = index >= 0 ? value.slice(index + 1) : value;
  try {
    return decodeURIComponent(raw) || value;
  } catch {
    return raw || value;
  }
}

export function collectPrefixes(text: string) {
  const prefixes = new Map<string, string>();
  const patterns = [
    /@prefix\s+([A-Za-z][\w-]*)?:\s*<([^>]+)>\s*\./gi,
    /PREFIX\s+([A-Za-z][\w-]*)?:\s*<([^>]+)>/gi,
    /xmlns(?::([A-Za-z][\w-]*))?=["']([^"']+)["']/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      prefixes.set(match[2], match[1] || "");
    }
  }
  return prefixes;
}

export function compactIri(value: string, prefixes: Map<string, string>) {
  if (!value || value.startsWith("_:")) return value || "";
  let best: { namespace: string; prefix: string } | undefined;
  for (const [namespace, prefix] of prefixes) {
    if (!value.startsWith(namespace)) continue;
    if (!best || namespace.length > best.namespace.length) {
      best = { namespace, prefix };
    }
  }
  if (!best) return value;
  const suffix = value.slice(best.namespace.length);
  return `${best.prefix ? `${best.prefix}:` : ":"}${suffix}`;
}

export function detectOntologyFormat(
  name: string,
  text: string,
  explicit?: OntologyFormat,
): OntologyFormat {
  if (explicit) return explicit;
  const extension = name.toLowerCase().split(".").pop();
  if (extension === "nt") return "N-Triples";
  if (extension === "nq") return "N-Quads";
  if (extension === "trig") return "TriG";
  if (/^\s*(<\?xml|<rdf:RDF|<[^>]+\s+xmlns(?::rdf)?=)/i.test(text)) {
    return "application/rdf+xml";
  }
  if (["rdf", "xml"].includes(extension ?? "")) return "application/rdf+xml";
  return "text/turtle";
}

function parseRdfXml(text: string, baseIRI: string) {
  return new Promise<Quad[]>((resolve, reject) => {
    const quads: Quad[] = [];
    const parser = new RdfXmlParser({ baseIRI });
    parser.on("data", (quad: Quad) => quads.push(quad));
    parser.on("error", reject);
    parser.on("end", () => resolve(quads));
    parser.end(text);
  });
}

async function parseQuads(text: string, name: string, format: OntologyFormat) {
  const baseIRI = `urn:ontology-file:${encodeURIComponent(name)}:`;
  if (format === "application/rdf+xml") return parseRdfXml(text, baseIRI);
  return new Parser({ baseIRI, format }).parse(text);
}

function addLocalizedValue(
  target: Map<string, LocalizedValue[]>,
  id: string | undefined,
  object: Term,
  predicate: string,
) {
  if (!id || object.termType !== "Literal") return;
  const values = target.get(id) ?? [];
  values.push({
    predicate,
    value: object.value,
    language: (object.language || "").toLowerCase(),
    datatype: object.datatype?.value,
  });
  target.set(id, values);
}

function chooseLocalizedEntry(values?: LocalizedValue[]) {
  if (!values?.length) return undefined;
  for (const language of LABEL_LANGUAGE_PRIORITY) {
    const entry = values.find((item) => (
      language ? item.language.startsWith(language) : !item.language
    ));
    if (entry) return entry;
  }
  return values[0];
}

function chooseKind(kinds: Set<ResourceKind>) {
  return RESOURCE_KIND_PRIORITY.find((kind) => kinds.has(kind)) ?? "External";
}

function valueFromTerm(term: Term): OntologyValue | undefined {
  if (term.termType === "Literal") {
    return {
      kind: "literal",
      value: term.value,
      language: term.language || "",
      datatype: term.datatype?.value,
    };
  }
  const id = termId(term);
  return id ? { kind: "resource", id } : undefined;
}

function addIndexedEdge(map: Map<string, OntologyGraphEdge[]>, id: string, edge: OntologyGraphEdge) {
  const edges = map.get(id) ?? [];
  edges.push(edge);
  map.set(id, edges);
}

function createIndexes(
  resources: OntologyResource[],
  edges: OntologyGraphEdge[],
): OntologyIndexes {
  const resourceById = new Map(resources.map((resource) => [resource.id, resource]));
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
  const outgoingById = new Map<string, OntologyGraphEdge[]>();
  const incomingById = new Map<string, OntologyGraphEdge[]>();
  const adjacentIdsById = new Map<string, Set<string>>();

  for (const edge of edges) {
    addIndexedEdge(outgoingById, edge.source, edge);
    addIndexedEdge(incomingById, edge.target, edge);
    const sourceAdjacent = adjacentIdsById.get(edge.source) ?? new Set<string>();
    const targetAdjacent = adjacentIdsById.get(edge.target) ?? new Set<string>();
    sourceAdjacent.add(edge.target);
    targetAdjacent.add(edge.source);
    adjacentIdsById.set(edge.source, sourceAdjacent);
    adjacentIdsById.set(edge.target, targetAdjacent);
  }

  return {
    resourceById,
    edgeById,
    outgoingById,
    incomingById,
    adjacentIdsById,
  };
}

function shortHash(text: string) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export async function parseOntology(input: ParseOntologyInput): Promise<OntologyDocument> {
  const path = input.path || input.name;
  const format = detectOntologyFormat(input.name, input.text, input.format);
  const source = {
    key: input.key || `file:${input.name}:${input.text.length}:${shortHash(input.text)}`,
    name: input.name,
    path,
    format,
  };
  const quads = await parseQuads(input.text, input.name, format);
  const prefixes = collectPrefixes(input.text);
  const kindsById = new Map<string, Set<ResourceKind>>();
  const traitsById = new Map<string, Set<string>>();
  const labelsById = new Map<string, LocalizedValue[]>();
  const descriptionsById = new Map<string, LocalizedValue[]>();
  const annotationsById = new Map<string, LocalizedValue[]>();
  const objectPropertyIds = new Set<string>();

  const addKind = (id: string | undefined, kind: ResourceKind) => {
    if (!id) return;
    const kinds = kindsById.get(id) ?? new Set<ResourceKind>();
    kinds.add(kind);
    kindsById.set(id, kinds);
  };

  for (const quad of quads) {
    const subject = termId(quad.subject);
    const predicate = quad.predicate.value;
    const object = termId(quad.object);

    if (predicate === RDF_TYPE && object) {
      const declaredKind = RESOURCE_KIND_BY_TYPE.get(object);
      const trait = PROPERTY_TRAIT_BY_TYPE.get(object);
      if (declaredKind) {
        addKind(subject, declaredKind);
        if (declaredKind === "ObjectProperty") objectPropertyIds.add(subject!);
      }
      if (trait && subject) {
        const traits = traitsById.get(subject) ?? new Set<string>();
        traits.add(trait);
        traitsById.set(subject, traits);
        if (!declaredKind) addKind(subject, "External");
      } else if (!declaredKind && !META_TYPES.has(object)) {
        addKind(subject, "NamedIndividual");
      }
    }

    if (LABEL_PREDICATES.has(predicate)) {
      addLocalizedValue(labelsById, subject, quad.object, predicate);
    }
    if (
      DESCRIPTION_PREDICATES.has(predicate)
      || ["comment", "definition", "description"].includes(localName(predicate).toLowerCase())
    ) {
      addLocalizedValue(descriptionsById, subject, quad.object, predicate);
    }
    if (quad.object.termType === "Literal" && subject) {
      addLocalizedValue(annotationsById, subject, quad.object, predicate);
    }
  }

  const resourceById = new Map<string, OntologyResource>();
  const ensureResource = (id: string | undefined, suggestedKind: ResourceKind = "External") => {
    if (!id) return undefined;
    const existing = resourceById.get(id);
    if (existing) return existing;
    if (!kindsById.has(id)) addKind(id, id.startsWith(XSD) ? "Datatype" : suggestedKind);
    const kinds = kindsById.get(id) ?? new Set<ResourceKind>([suggestedKind]);
    const descriptions = descriptionsById.get(id) ?? [];
    const descriptionEntry = chooseLocalizedEntry(descriptions);
    const resource: OntologyResource = {
      id,
      iri: id,
      compactIri: compactIri(id, prefixes),
      localName: localName(id),
      kind: chooseKind(kinds),
      label: chooseLocalizedEntry(labelsById.get(id))?.value || localName(id),
      labels: labelsById.get(id) ?? [],
      description: descriptionEntry?.value || "",
      descriptionEntry,
      traits: [...(traitsById.get(id) ?? [])],
      annotations: annotationsById.get(id) ?? [],
      domains: [],
      ranges: [],
      properties: [],
      graphDegree: 0,
    };
    resourceById.set(id, resource);
    return resource;
  };

  for (const id of kindsById.keys()) ensureResource(id);

  const propertyById = new Map(
    [...resourceById].filter(([, resource]) => PROPERTY_KINDS.has(resource.kind)),
  );
  const associationsByOwner = new Map<string, Map<string, PropertyAssociation>>();
  const ensureAssociation = (ownerId: string, propertyId: string) => {
    const owner = resourceById.get(ownerId);
    const property = propertyById.get(propertyId);
    if (!owner || !GRAPH_KINDS.has(owner.kind) || !property) return undefined;
    const associations = associationsByOwner.get(ownerId) ?? new Map<string, PropertyAssociation>();
    let association = associations.get(propertyId);
    if (!association) {
      association = { propertyId, values: [], restrictions: [] };
      associations.set(propertyId, association);
      associationsByOwner.set(ownerId, associations);
    }
    return association;
  };

  const restrictionById = new Map<string, OntologyRestriction>();
  for (const [id, resource] of resourceById) {
    if (resource.kind === "Restriction") {
      restrictionById.set(id, { id, conditions: [] });
    }
  }

  for (const quad of quads) {
    const subject = termId(quad.subject);
    const target = termId(quad.object);
    if (!subject) continue;
    const predicate = quad.predicate.value;
    const property = propertyById.get(subject);

    if (property && predicate === `${RDFS}domain` && target && !property.domains.includes(target)) {
      property.domains.push(target);
    }
    if (property && predicate === `${RDFS}range` && target && !property.ranges.includes(target)) {
      property.ranges.push(target);
      ensureResource(target, target.startsWith(XSD) ? "Datatype" : "External");
    }

    const restriction = restrictionById.get(subject);
    if (restriction && predicate === `${OWL}onProperty` && target) {
      restriction.propertyId = target;
    } else if (restriction && RESTRICTION_OPERATOR_BY_PREDICATE.has(predicate)) {
      const value = valueFromTerm(quad.object);
      if (value) {
        restriction.conditions.push({
          operator: RESTRICTION_OPERATOR_BY_PREDICATE.get(predicate)!,
          value,
        });
      }
    }
  }

  for (const property of propertyById.values()) {
    for (const domainId of property.domains) ensureAssociation(domainId, property.id);
  }

  for (const quad of quads) {
    const subject = termId(quad.subject);
    const target = termId(quad.object);
    if (!subject) continue;
    const predicate = quad.predicate.value;

    if (propertyById.has(predicate)) {
      const association = ensureAssociation(subject, predicate);
      const value = valueFromTerm(quad.object);
      if (association && value) association.values.push(value);
    }

    if (RESTRICTION_OWNER_PREDICATES.has(predicate) && target) {
      const restriction = restrictionById.get(target);
      if (restriction?.propertyId) {
        ensureAssociation(subject, restriction.propertyId)?.restrictions.push(restriction);
      }
    }
  }

  const propertyOrder = new Map(PROPERTY_KIND_ORDER.map((kind, index) => [kind, index]));
  for (const [ownerId, associations] of associationsByOwner) {
    const owner = resourceById.get(ownerId);
    if (!owner) continue;
    owner.properties = [...associations.values()].sort((left, right) => {
      const leftKind = resourceById.get(left.propertyId)?.kind as PropertyKind | undefined;
      const rightKind = resourceById.get(right.propertyId)?.kind as PropertyKind | undefined;
      const kindDelta = (propertyOrder.get(leftKind!) ?? 99) - (propertyOrder.get(rightKind!) ?? 99);
      return kindDelta
        || (resourceById.get(left.propertyId)?.label ?? "").localeCompare(
          resourceById.get(right.propertyId)?.label ?? "",
        );
    });
  }

  const graphResources = new Map(
    [...resourceById].filter(([, resource]) => GRAPH_KINDS.has(resource.kind)),
  );
  const graphEdges: OntologyGraphEdge[] = [];
  for (const quad of quads) {
    const sourceId = termId(quad.subject);
    const targetId = termId(quad.object);
    if (!sourceId || !targetId || !graphResources.has(sourceId) || !graphResources.has(targetId)) {
      continue;
    }

    const predicate = quad.predicate.value;
    const targetResource = graphResources.get(targetId)!;
    const isInstanceType = (
      predicate === RDF_TYPE
      && targetResource.kind === "Class"
      && graphResources.get(sourceId)?.kind === "NamedIndividual"
    );
    const structural = EDGE_DEFINITION_BY_PREDICATE.get(predicate);
    const isObjectAssertion = objectPropertyIds.has(predicate);
    if (!structural && !isInstanceType && !isObjectAssertion) continue;

    const property = resourceById.get(predicate);
    const definition = structural ?? {
      kind: isInstanceType ? "instanceOf" as const : "objectRelation" as const,
      label: isInstanceType ? "type" : property?.label || localName(predicate),
      description: isInstanceType ? "类断言：源实体是目标类的实例。" : property?.description || "对象属性关系。",
      color: isInstanceType ? "#6f9184" : "#887f9f",
    };
    const edge: OntologyGraphEdge = {
      id: `edge-${graphEdges.length}`,
      source: sourceId,
      target: targetId,
      predicate,
      predicateIri: compactIri(predicate, prefixes),
      label: definition.label,
      kind: definition.kind,
      description: property?.description || definition.description,
      color: definition.color,
    };
    graphEdges.push(edge);
    graphResources.get(sourceId)!.graphDegree += 1;
    if (targetId !== sourceId) graphResources.get(targetId)!.graphDegree += 1;
  }

  const resources = [...resourceById.values()].sort((left, right) => (
    RESOURCE_KIND_PRIORITY.indexOf(left.kind) - RESOURCE_KIND_PRIORITY.indexOf(right.kind)
    || left.label.localeCompare(right.label)
  ));
  const ontology = resources.find((resource) => resource.kind === "Ontology");
  const ontologyTitle = ontology?.labels.find((label) => label.predicate === `${DCTERMS}title`)?.value;
  const displayName = ontologyTitle
    || (ontology?.labels.length ? ontology.label : "")
    || (ontology?.localName && ontology.localName !== ontology.iri ? ontology.localName : "")
    || input.name;

  return {
    source,
    ontologyIri: ontology?.iri,
    displayName,
    prefixes,
    resources,
    graph: {
      nodeIds: [...graphResources.keys()],
      edges: graphEdges,
    },
    indexes: createIndexes(resources, graphEdges),
  };
}
