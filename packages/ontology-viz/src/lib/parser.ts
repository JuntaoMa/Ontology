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
  OntologyParseOptions,
  OntologyVocabulary,
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
  RDF:  "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  RDFS: "http://www.w3.org/2000/01/rdf-schema#",
  OWL:  "http://www.w3.org/2002/07/owl#",
  SKOS: "http://www.w3.org/2004/02/skos/core#",
  DCT:  "http://purl.org/dc/terms/",
};

function iri(ns: keyof typeof NS, local: string): string {
  return NS[ns] + local;
}

const DEFAULT_VOCABULARY: OntologyVocabulary = {
  scopeNotePropertyIRI: iri("SKOS", "scopeNote"),
  sourcePropertyIRI: iri("DCT", "source"),
};

const DEFAULT_PARSE_OPTIONS: Required<
  Omit<OntologyParseOptions, "vocabulary" | "propertyDirectionMatchers">
> & {
  vocabulary: OntologyVocabulary;
  propertyDirectionMatchers: NonNullable<OntologyParseOptions["propertyDirectionMatchers"]>;
} = {
  baseIRI: "urn:ontology",
  ontologyTitleFallback: "Ontology",
  secondaryLabelLang: "zh",
  vocabulary: DEFAULT_VOCABULARY,
  individualTypeMatchers: [],
  propertyDirectionMatchers: {},
};

function resolveParseOptions(options: OntologyParseOptions = {}) {
  return {
    ...DEFAULT_PARSE_OPTIONS,
    ...options,
    vocabulary: {
      ...DEFAULT_PARSE_OPTIONS.vocabulary,
      ...options.vocabulary,
    },
    propertyDirectionMatchers: {
      ...DEFAULT_PARSE_OPTIONS.propertyDirectionMatchers,
      ...options.propertyDirectionMatchers,
    },
  };
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

function extractProvenance(
  store: N3Store,
  subject: string,
  vocabulary: OntologyVocabulary,
): Provenance {
  const specRef = vocabulary.specRefPropertyIRI
    ? getString(store, subject, vocabulary.specRefPropertyIRI)
    : undefined;
  const specClause = vocabulary.specClausePropertyIRI
    ? getString(store, subject, vocabulary.specClausePropertyIRI)
    : undefined;
  const designRationale = vocabulary.designRationalePropertyIRI
    ? getString(store, subject, vocabulary.designRationalePropertyIRI)
    : undefined;
  const derivedFrom = vocabulary.derivedFromPropertyIRI
    ? getStrings(store, subject, vocabulary.derivedFromPropertyIRI)
    : [];
  const scopeNote = vocabulary.scopeNotePropertyIRI
    ? getString(store, subject, vocabulary.scopeNotePropertyIRI)
    : undefined;
  const source = vocabulary.sourcePropertyIRI
    ? getString(store, subject, vocabulary.sourcePropertyIRI)
    : undefined;

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

function extractClasses(
  store: N3Store,
  options: ReturnType<typeof resolveParseOptions>,
): OntologyClass[] {
  const classes: OntologyClass[] = [];
  const classIRIs = new Set<string>();
  const bnIndex = buildBlankNodeIndex(store);
  const { vocabulary } = options;

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
    const domainIRI = vocabulary.domainPropertyIRI
      ? getIRI(store, iriStr, vocabulary.domainPropertyIRI)
      : undefined;

    // Resolve domain membership from owl:hasValue restrictions
    let resolvedDomain: string | undefined = domainIRI ?? undefined;
    if (!resolvedDomain && vocabulary.domainPropertyIRI) {
      // Find blank node restrictions: iriStr rdfs:subClassOf _:bn .
      // _:bn owl:onProperty <domainPropertyIRI> ; owl:hasValue <domainIndividual> .
      const superClassObjs = store.getObjects(iriStr, iri("RDFS", "subClassOf"), null);
      for (const scObj of superClassObjs) {
        if (scObj.termType !== "BlankNode") continue;
        const bnId = scObj.value;
        const onPropValues = getFromBN(bnIndex, bnId, iri("OWL", "onProperty"));
        if (onPropValues.includes(vocabulary.domainPropertyIRI)) {
          const hasValValues = getFromBN(bnIndex, bnId, iri("OWL", "hasValue"));
          if (hasValValues.length > 0) {
            resolvedDomain = hasValValues[0];
            break;
          }
        }
      }
    }

    const genVal = vocabulary.generationPropertyIRI
      ? getString(store, iriStr, vocabulary.generationPropertyIRI)
      : undefined;

    classes.push({
      iri: iriStr,
      localName: localName(iriStr),
      kind: "class",
      label: getLabel(store, iriStr) ?? localName(iriStr),
      labelZh: getLabel(store, iriStr, options.secondaryLabelLang),
      abbreviation: vocabulary.abbreviationPropertyIRI
        ? getString(store, iriStr, vocabulary.abbreviationPropertyIRI)
        : undefined,
      comment: getString(store, iriStr, iri("RDFS", "comment")),
      provenance: extractProvenance(store, iriStr, vocabulary),
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

function extractObjectProperties(
  store: N3Store,
  options: ReturnType<typeof resolveParseOptions>,
): OntologyObjectProperty[] {
  const props: OntologyObjectProperty[] = [];
  const propIRIs = new Set<string>();
  const { propertyDirectionMatchers, vocabulary } = options;

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
      if (propertyDirectionMatchers.userPlane?.some((matcher) => p.includes(matcher))) {
        direction = "userPlane";
      } else if (propertyDirectionMatchers.controlPlane?.some((matcher) => p.includes(matcher))) {
        direction = "controlPlane";
      }
    }
    if (!direction && (symmetric || parents.length === 0)) {
      direction = "generic";
    }

    props.push({
      iri: iriStr,
      localName: localName(iriStr),
      kind: "objectProperty",
      label: getLabel(store, iriStr) ?? localName(iriStr),
      labelZh: getLabel(store, iriStr, options.secondaryLabelLang),
      abbreviation: vocabulary.abbreviationPropertyIRI
        ? getString(store, iriStr, vocabulary.abbreviationPropertyIRI)
        : undefined,
      comment: getString(store, iriStr, iri("RDFS", "comment")),
      provenance: extractProvenance(store, iriStr, vocabulary),
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

// ─── Individual extraction ──────────────────────────────────────

function extractIndividuals(
  store: N3Store,
  options: ReturnType<typeof resolveParseOptions>,
): OntologyIndividual[] {
  const individuals: OntologyIndividual[] = [];
  const { individualTypeMatchers, vocabulary } = options;

  // Find subjects that have rdf:type pointing to an application-selected individual type.
  for (const s of store.getSubjects(null, null, null)) {
    if (s.termType !== "NamedNode") continue;
    const types = store.getObjects(s.value, iri("RDF", "type"), null)
      .filter((o) => o.termType === "NamedNode")
      .map((o) => o.value);

    const isRenderableIndividual = individualTypeMatchers.length > 0 &&
      types.some((t) => individualTypeMatchers.some((matcher) => t.includes(matcher)));
    if (!isRenderableIndividual) continue;

    individuals.push({
      iri: s.value,
      localName: localName(s.value),
      kind: "individual",
      label: getLabel(store, s.value) ?? localName(s.value),
      labelZh: getLabel(store, s.value, options.secondaryLabelLang),
      comment: getString(store, s.value, iri("RDFS", "comment")),
      provenance: extractProvenance(store, s.value, vocabulary),
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
export function parseTTLFiles(
  ttlContent: string | string[],
  options: OntologyParseOptions = {},
): OntologyGraphData {
  const content = Array.isArray(ttlContent) ? ttlContent.join("\n") : ttlContent;
  const resolvedOptions = resolveParseOptions(options);

  const parser = new Parser({
    format: "text/turtle",
    baseIRI: resolvedOptions.baseIRI,
  });
  const quads = parser.parse(content);
  const store = new N3Store(quads);

  // Detect ontology IRI
  let ontologyIRI = resolvedOptions.baseIRI;
  let ontologyTitle: string | undefined;
  const ontSubjects = store.getSubjects(iri("RDF", "type"), iri("OWL", "Ontology"), null);
  for (const s of ontSubjects) {
    if (s.termType === "NamedNode") {
      ontologyIRI = s.value;
      ontologyTitle = getString(store, s.value, iri("DCT", "title"));
      break;
    }
  }

  const classes = extractClasses(store, resolvedOptions);
  const objectProperties = extractObjectProperties(store, resolvedOptions);
  const individuals = extractIndividuals(store, resolvedOptions);

  return {
    ontologyIRI,
    ontologyTitle: ontologyTitle ?? resolvedOptions.ontologyTitleFallback,
    classes,
    objectProperties,
    individuals,
  };
}
