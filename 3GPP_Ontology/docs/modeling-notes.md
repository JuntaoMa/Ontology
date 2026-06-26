# Modeling Notes — 3GPP 5G SA Topology Ontology

Design rationale, competency questions, and example queries for
`ontology/3gpp-5gs-topology.ttl` (+ `3gpp-pm-qoe-scaffold.ttl`).

## 1. Key design decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Generation | 5G SA (NG-RAN + 5GC) | Cleanest, most modern, self-contained architecture; spec-concentrated (23.501 / 38.300 / 38.401). |
| Release baseline | Rel-19 (`j`-series) | Latest *stable* release; Rel-20 (`k`) is early draft. Pinned for citation coherence. |
| Connectivity modelling | Shortcut properties **and** reified `Link` | Shortcut props (with domain/range) make the *standard topology* queryable and constrain valid connections; reified links give a place to hang KPIs/faults per connection. |
| Reference points | First-class individuals of `ReferencePoint` | Each interface (N2, F1, Uu…) is independently citable and re-usable by links. |
| Symmetry | `connectedTo` symmetric; specific props are sub-properties | Adjacency symmetry is inferred at the super-property; peer interfaces (Xn, N9, N14, N16) are themselves symmetric. |
| Direction | Separate `downstreamOf`/`upstreamOf` (transitive) | Physical adjacency is symmetric, but propagation needs an ordered data path. Keep the two concerns distinct. |
| Transport network | Modelled as first-class (`TransportNetworkElement`, fronthaul/midhaul/backhaul) but marked non-normative | 3GPP treats transport as TNL/out-of-scope, yet it is a real fault source the propagation model must see. |
| KPI/QoE | Separate module, imported | Keeps the topology TBox stable; lets the indicator layer evolve independently (user requirement: topology first, KPI/QoE as mount points). |

## 2. Class taxonomy (topology core)

```
NetworkEntity
├── UserEquipment                         (Terminal domain)
├── NgRanNode ── GNB, NgENB               (Radio access domain)
│   GNB_CU ── GNB_CU_CP, GNB_CU_UP
│   GNB_DU,  RadioUnit*
├── CoreNetworkFunction                   (Core domain)
│   ├── ControlPlaneFunction ── AMF, SMF, PCF, UDM, AUSF, NRF, NSSF,
│   │                            NEF, UDR, UDSF, NWDAF, CHF, BSF, LMF,
│   │                            SMSF, EASDF, NSACF
│   ├── UserPlaneFunctionClass ── UPF
│   └── (proxies) SCP, SEPP ; AF ; N3IWF
├── TransportNetworkElement*              (Transport domain)
├── DataNetwork                           (Service domain)
└── ServiceProvider ── EdgeApplicationServer

ReferencePoint
├── ControlPlaneReferencePoint  (N1,N2,N4,N5,N7,N8,N10–N16,N22,N23,N28,N33,N35–N37,N40,F1-C)
├── UserPlaneReferencePoint     (N3,N6,N9,F1-U)
├── RadioReferencePoint         (Uu,F1,E1,Xn,Fronthaul*)
└── ServiceBasedInterface       (Namf,Nsmf,Npcf,Nudm,Nnrf,…)

Link (reified)  ·  Service / ServiceSession / EndToEndPath / PathSegment
NetworkDomain (Terminal/RadioAccess/Transport/Core/Service)
```
`*` = non-normative deployment extension.

## 3. Competency questions

The ontology is built to answer (via SPARQL now over the schema; over an ABox later):

1. Which network entities does a service flow traverse from UE to the application server?
2. For a given reference point (e.g. N3), which entity types does it connect?
3. Which entities are downstream of a given entity on the user-plane path?
4. Which links realise user-plane vs control-plane reference points?
5. What is the full set of interfaces a UPF terminates? (N3, N4, N6, N9)
6. Which network domain does each entity belong to?
7. *(with KPI layer)* Which KPIs are measured on a link, and which QoE metric do they impact?
8. *(with propagation)* If a link degrades, which downstream entities / sessions / QoE metrics are affected?

## 4. Example SPARQL (run against the TBox today)

**Q2 — endpoints of every reference point:**
```sparql
PREFIX fgs: <http://3gpp-ontology.org/ns/5gs#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?rp ?endpoints WHERE {
  ?rp a/rdfs:subClassOf* fgs:ReferencePoint ;
      fgs:connectsEntityType ?endpoints .
} ORDER BY ?rp
```

**Q5 — all interfaces a UPF terminates (shortcut props whose domain or range is UPF):**
```sparql
PREFIX fgs: <http://3gpp-ontology.org/ns/5gs#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?prop ?domain ?range WHERE {
  ?prop rdfs:subPropertyOf fgs:connectedTo ;
        rdfs:domain ?domain ; rdfs:range ?range .
  FILTER(?domain = fgs:UPF || ?range = fgs:UPF)
}
```

**Q6 — entity → domain (schema-level membership via hasValue restriction):**
```sparql
PREFIX fgs: <http://3gpp-ontology.org/ns/5gs#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
SELECT ?cls ?domainInd WHERE {
  ?cls rdfs:subClassOf ?r .
  ?r owl:onProperty fgs:belongsToDomain ; owl:hasValue ?domainInd .
} ORDER BY ?domainInd ?cls
```

## 5. How quality-degradation propagation will work (next phases)

1. Bind concrete KPIs/counters (28.552/28.554) to entities/links via
   `pm:hasPerformanceIndicator` and `pm:aggregatesFrom`.
2. A `pm:QualityDegradation` instance `pm:occursAt` a `fgs:Measurable` and
   `pm:affectsIndicator` some KPI.
3. Propagation rule (SWRL/SHACL sketch): a degradation at entity `X` propagates to a
   degradation at entity `Y` when `Y fgs:downstreamOf X` and `Y` depends on the
   affected indicator → materialize `pm:propagatesTo`.
4. Network-to-user bridge: `pm:impactsQoE` carries the chain to a `pm:QoEMetric`,
   attributing degraded user experience to a root-cause network element/link.

## 6. Known limitations

- Transport (fronthaul/midhaul/backhaul) and RadioUnit are **non-normative** w.r.t.
  3GPP; included for fault realism and clearly flagged with `skos:scopeNote`.
- Reference-point coverage is the topology-relevant subset (data path + main control +
  data repositories); roaming (N24/N27/N31/N32), positioning, and exposure-edge
  reference points can be added as needed (all listed in 23.501 §4.2.3).
- No ABox yet; schema-level membership uses `owl:hasValue` restrictions so reasoning
  can still classify instances by domain.
- DL consistency not yet machine-checked (no JRE in the build env); structural
  validation (parse + domain/range integrity) passed.
