/**
 * @ontology/viz — TTL/RDF parser
 *
 * Parses one or more Turtle (.ttl) files and produces OntologyGraphData.
 * Uses the `n3` library (RDF/JS-compliant) for reliable Turtle parsing.
 *
 * Spec: RDF 1.1 Turtle (W3C Recommendation)
 *       OWL 2 Web Ontology Language (W3C Recommendation)
 */

import { Parser, Store as N3Store } from "n3";
import type {
  OntologyGraphData,
  OntologyClass,
  OntologyObjectProperty,
  OntologyIndividual,
  Provenance,
  ProvenanceLevel,
} from "./types";

// n3 N3Store has issues querying blank node subjects via string IDs.
// Workaround: build a Map from blank node ID → { predicate → [object values] }
// by scanning all quads once.
type BNIndex = Map<string, Map<string, string[]>>;

function buildBlankNodeIndex(store: N3Store): BNIndex {
  const index: BNIndex = new Map();
  for (const q of store.getQuads(null, null, null, null)) {
    if (q.subject.termType === "BlankNode") {
      const bnId = q.subject.value;
      const pred = q.predicate.value;
      const objVal = q.object.value;
      if (!index.has(bnId)) index.set(bnId, new Map());
      const predMap = index.get(bnId)!;
      if (!predMap.has(pred)) predMap.set(pred, []);
      predMap.get(pred)!.push(objVal);
    }
  }
  return index;
}

function getFromBN(index: BNIndex, bnId: string, pred: string): string[] {
  return index.get(bnId)?.get(pred) ?? [];
}

function localName(iri: string): string {
  const hash = iri.lastIndexOf("#");
  if (hash >= 0) return iri.slice(hash + 1);
  const slash = iri.lastIndexOf("/");
  return iri.slice(slash + 1);
}

// ─── Namespace IRIs (as strings) ─────────────────────────────────

const NS = {
  FGS:  "http://3gpp-ontology.org/ns/5gs#",
  PM:   "http://3gpp-ontology.org/ns/pm#",
  RDF:  "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  RDFS: "http://www.w3.org/2000/01/rdf-schema#",
  OWL:  "http://www.w3.org/2002/07/owl#",
  SKOS: "http://www.w3.org/2004/02/skos/core#",
  DCT:  "http://purl.org/dc/terms/",
};

function iri(ns: keyof typeof NS, local: string): string {
  return NS[ns] + local;
}

// ─── Store helpers ───────────────────────────────────────────────

function getString(store: N3Store, subject: string, pred: string): string | undefined {
  const matches = store.getObjects(subject, pred, null);
  for (const obj of matches) {
    if (obj.termType === "Literal") return obj.value;
  }
  return undefined;
}

function getStrings(store: N3Store, subject: string, pred: string): string[] {
  return store.getObjects(subject, pred, null)
    .filter((o) => o.termType === "Literal")
    .map((o) => o.value);
}

function getLabel(store: N3Store, subject: string, lang?: string): string | undefined {
  const objects = store.getObjects(subject, iri("RDFS", "label"), null);
  for (const obj of objects) {
    if (obj.termType === "Literal") {
      if (!lang) return obj.value;
      if (obj.language === lang) return obj.value;
    }
  }
  // Fallback
  for (const obj of objects) {
    if (obj.termType === "Literal") return obj.value;
  }
  return undefined;
}

function getIRIs(store: N3Store, subject: string, pred: string): string[] {
  return store.getObjects(subject, pred, null)
    .filter((o) => o.termType === "NamedNode")
    .map((o) => o.value);
}

function getIRI(store: N3Store, subject: string, pred: string): string | undefined {
  const matches = store.getObjects(subject, pred, null);
  for (const obj of matches) {
    if (obj.termType === "NamedNode") return obj.value;
  }
  return undefined;
}

function getSubjects(store: N3Store, pred: string, obj: string): string[] {
  return store.getSubjects(pred, obj, null)
    .filter((s) => s.termType === "NamedNode")
    .map((s) => s.value);
}

// ─── Provenance extraction ──────────────────────────────────────

function extractProvenance(store: N3Store, subject: string): Provenance {
  const specRef = getString(store, subject, iri("FGS", "specRef"));
  const specClause = getString(store, subject, iri("FGS", "specClause"));
  const designRationale = getString(store, subject, iri("FGS", "designRationale"));
  const derivedFrom = getStrings(store, subject, iri("FGS", "derivedFrom"));
  const scopeNote = getString(store, subject, iri("SKOS", "scopeNote"));
  const source = getString(store, subject, iri("DCT", "source"));

  let level: ProvenanceLevel;
  if (specRef || specClause) {
    level = "L1";
  } else if (designRationale || derivedFrom.length > 0) {
    level = scopeNote ? "L3" : "L2";
  } else if (source) {
    level = "L1";
  } else {
    level = "L2";
  }

  return {
    level,
    specRef: specRef ?? undefined,
    specClause: specClause ?? undefined,
    designRationale: designRationale ?? undefined,
    derivedFrom: derivedFrom.length > 0 ? derivedFrom : undefined,
    scopeNote: scopeNote ?? undefined,
    source: source ?? undefined,
  };
}

// ─── Class extraction ───────────────────────────────────────────

function extractClasses(store: N3Store): OntologyClass[] {
  const classes: OntologyClass[] = [];
  const classIRIs = new Set<string>();
  const bnIndex = buildBlankNodeIndex(store);

  for (const s of getSubjects(store, iri("RDF", "type"), iri("OWL", "Class"))) {
    classIRIs.add(s);
  }
  for (const s of getSubjects(store, iri("RDF", "type"), iri("RDFS", "Class"))) {
    classIRIs.add(s);
  }

  for (const iriStr of classIRIs) {
    if (iriStr.includes("w3.org")) continue;

    const parents = getIRIs(store, iriStr, iri("RDFS", "subClassOf"))
      .filter((p) => !p.includes("w3.org"));
    const domainIRI = getIRI(store, iriStr, iri("FGS", "belongsToDomain"));

    // Resolve domain membership from owl:hasValue restrictions
    let resolvedDomain: string | undefined = domainIRI ?? undefined;
    if (!resolvedDomain) {
      // Find blank node restrictions: iriStr rdfs:subClassOf _:bn .
      // _:bn owl:onProperty fgs:belongsToDomain ; owl:hasValue fgs:XxxDomainInd .
      const superClassObjs = store.getObjects(iriStr, iri("RDFS", "subClassOf"), null);
      for (const scObj of superClassObjs) {
        if (scObj.termType !== "BlankNode") continue;
        const bnId = scObj.value;
        const onPropValues = getFromBN(bnIndex, bnId, iri("OWL", "onProperty"));
        if (onPropValues.includes(iri("FGS", "belongsToDomain"))) {
          const hasValValues = getFromBN(bnIndex, bnId, iri("OWL", "hasValue"));
          if (hasValValues.length > 0) {
            resolvedDomain = hasValValues[0];
            break;
          }
        }
      }
    }

    const genVal = getString(store, iriStr, iri("FGS", "generation"));

    classes.push({
      iri: iriStr,
      localName: localName(iriStr),
      kind: "class",
      label: getLabel(store, iriStr) ?? localName(iriStr),
      labelZh: getLabel(store, iriStr, "zh"),
      abbreviation: getString(store, iriStr, iri("FGS", "abbreviation")),
      comment: getString(store, iriStr, iri("RDFS", "comment")),
      provenance: extractProvenance(store, iriStr),
      parentIRIs: parents,
      domainIRI: resolvedDomain,
      generation: genVal ?? undefined,
    });
  }

  return inheritClassDomains(classes);
}

function inheritClassDomains(classes: OntologyClass[]): OntologyClass[] {
  const byIRI = new Map(classes.map((cls) => [cls.iri, cls]));
  const resolved = new Map<string, string | undefined>();
  const resolving = new Set<string>();

  const resolveDomain = (cls: OntologyClass): string | undefined => {
    if (resolved.has(cls.iri)) return resolved.get(cls.iri);
    if (cls.domainIRI) {
      resolved.set(cls.iri, cls.domainIRI);
      return cls.domainIRI;
    }
    if (resolving.has(cls.iri)) return undefined;

    resolving.add(cls.iri);
    let inherited: string | undefined;
    for (const parentIRI of cls.parentIRIs) {
      const parent = byIRI.get(parentIRI);
      if (!parent) continue;
      inherited = resolveDomain(parent);
      if (inherited) break;
    }
    resolving.delete(cls.iri);
    resolved.set(cls.iri, inherited);
    return inherited;
  };

  return classes.map((cls) => {
    const domainIRI = resolveDomain(cls);
    return domainIRI && domainIRI !== cls.domainIRI
      ? { ...cls, domainIRI }
      : cls;
  });
}

// ─── Object property extraction ─────────────────────────────────

function extractObjectProperties(store: N3Store): OntologyObjectProperty[] {
  const props: OntologyObjectProperty[] = [];
  const propIRIs = new Set<string>();

  for (const s of getSubjects(store, iri("RDF", "type"), iri("OWL", "ObjectProperty"))) {
    propIRIs.add(s);
  }

  for (const iriStr of propIRIs) {
    if (iriStr.includes("w3.org")) continue;

    const parents = getIRIs(store, iriStr, iri("RDFS", "subPropertyOf"))
      .filter((p) => !p.includes("w3.org"));

    // Check for owl:SymmetricProperty and owl:TransitiveProperty types
    const types = getIRIs(store, iriStr, iri("RDF", "type"));
    const symmetric = types.includes(iri("OWL", "SymmetricProperty"));
    const transitive = types.includes(iri("OWL", "TransitiveProperty"));

    // Determine direction from super-property assignments
    let direction: "userPlane" | "controlPlane" | "generic" | undefined;
    for (const p of parents) {
      if (p.includes("userPlane")) direction = "userPlane";
      else if (p.includes("controlPlane")) direction = "controlPlane";
    }
    if (!direction && (symmetric || parents.length === 0)) {
      direction = "generic";
    }

    props.push({
      iri: iriStr,
      localName: localName(iriStr),
      kind: "objectProperty",
      label: getLabel(store, iriStr) ?? localName(iriStr),
      labelZh: getLabel(store, iriStr, "zh"),
      abbreviation: getString(store, iriStr, iri("FGS", "abbreviation")),
      comment: getString(store, iriStr, iri("RDFS", "comment")),
      provenance: extractProvenance(store, iriStr),
      domainIRI: getIRI(store, iriStr, iri("RDFS", "domain")) ?? undefined,
      rangeIRI: getIRI(store, iriStr, iri("RDFS", "range")) ?? undefined,
      parentIRIs: parents,
      symmetric,
      transitive,
      direction,
    });
  }

  return props;
}

// ─── Individual extraction (Reference Points) ────────────────────

function extractIndividuals(store: N3Store): OntologyIndividual[] {
  const individuals: OntologyIndividual[] = [];

  // Find subjects that have rdf:type pointing to a ReferencePoint class
  for (const s of store.getSubjects(null, null, null)) {
    if (s.termType !== "NamedNode") continue;
    const types = store.getObjects(s.value, iri("RDF", "type"), null)
      .filter((o) => o.termType === "NamedNode")
      .map((o) => o.value);

    const isRefPt = types.some(
      (t) => t.includes("ReferencePoint") || t.includes("ServiceBasedInterface"),
    );
    if (!isRefPt) continue;

    individuals.push({
      iri: s.value,
      localName: localName(s.value),
      kind: "individual",
      label: getLabel(store, s.value) ?? localName(s.value),
      labelZh: getLabel(store, s.value, "zh"),
      comment: getString(store, s.value, iri("RDFS", "comment")),
      provenance: extractProvenance(store, s.value),
      typeIRIs: types,
    });
  }

  return individuals;
}

// ─── Main entry point ───────────────────────────────────────────

/**
 * Parse one or more Turtle (.ttl) files and return unified OntologyGraphData.
 *
 * Accepts either a single concatenated TTL string or an array of file contents.
 *
 * @param ttlContent — single TTL string, or array of TTL file contents
 * @returns OntologyGraphData ready for rendering
 */
export function parseTTLFiles(ttlContent: string | string[]): OntologyGraphData {
  const content = Array.isArray(ttlContent) ? ttlContent.join("\n") : ttlContent;

  const parser = new Parser({
    format: "text/turtle",
    baseIRI: "http://3gpp-ontology.org/ns/5gs",
  });
  const quads = parser.parse(content);
  const store = new N3Store(quads);

  // Detect ontology IRI
  let ontologyIRI = "http://3gpp-ontology.org/ns/5gs";
  let ontologyTitle: string | undefined;
  const ontSubjects = store.getSubjects(iri("RDF", "type"), iri("OWL", "Ontology"), null);
  for (const s of ontSubjects) {
    if (s.termType === "NamedNode") {
      ontologyIRI = s.value;
      ontologyTitle = getString(store, s.value, iri("DCT", "title"));
      break;
    }
  }

  const classes = extractClasses(store);
  const objectProperties = extractObjectProperties(store);
  const individuals = extractIndividuals(store);

  return {
    ontologyIRI,
    ontologyTitle: ontologyTitle ?? "3GPP Ontology",
    classes,
    objectProperties,
    individuals,
  };
}
