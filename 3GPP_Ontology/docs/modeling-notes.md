# Modeling Notes — 3GPP 5G SA & 4G EPC Topology Ontology

Design rationale, competency questions, and example queries for
`ontology/3gpp-5gs-topology.ttl` (+ `3gpp-epc-topology.ttl` + `3gpp-pm-qoe-scaffold.ttl`).

## 1. Key design decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Generation | 5G SA (NG-RAN + 5GC) + 4G LTE/EPC | Two-generation coverage for hybrid deployment scenarios. 5G SA as the primary target; 4G EPC as extension. Spec-concentrated. |
| Release baseline | Rel-19 (`j`-series) | Latest *stable* release; Rel-20 (`k`) is early draft. Pinned for citation coherence. |
| Connectivity modelling | Shortcut properties **and** reified `Link` | Shortcut props (with domain/range) make the *standard topology* queryable and constrain valid connections; reified links give a place to hang KPIs/faults per connection. |
| Reference points | First-class individuals of `ReferencePoint` | Each interface (N2, F1, Uu, S1-MME, Sx…) is independently citable and re-usable by links. |
| Symmetry | `connectedTo` symmetric; specific props are sub-properties | Adjacency symmetry is inferred at the super-property; peer interfaces (Xn, N9, N14, N16, X2, S10) are themselves symmetric. |
| Direction | Separate **user-plane** and **control-plane** downstream/upstream property pairs (transitive) | Physical adjacency is symmetric, but propagation needs ordered paths. User-plane (UE→RAN→UPF→AS) and control-plane (UE→RAN→AMF/SMF→…) are fundamentally different chains. |
| Part-whole | `hasLogicalComponent` / `logicallyPartOf` (transitive) | gNB contains CU+DU; CUPS entities (SGW-C + SGW-U) form logical SGW. |
| Control dependency | `controlledBy` (UP→CP, subPropertyOf `dependsOn`) | User-plane functions (UPF, SGW-U, PGW-U) are controlled by control-plane functions (SMF, SGW-C, PGW-C) via PFCP (N4/Sx/Sxb). |
| 4G EPC modelling | CUPS (TS 23.214) split: SGW-C/U, PGW-C/U | Mirrors 5G SMF/UPF separation; enables consistent propagation model across generations. |
| Transport network | First-class with 3 segments (`FronthaulTransport`, `MidhaulTransport`, `BackhaulTransport`) | 3GPP treats transport as TNL/out-of-scope, yet it is a real fault source. Three segments have distinct latency/capacity/failure characteristics. |
| Cell | First-class radio service area (`Cell`) | Most radio-side KPIs are measured at Cell granularity; essential for degradation propagation. |
| Session layer | `PDUSession` → `QoSFlow` → `DRB` | Bridges topology entities to QoS/QoE metrics; provides concrete attachment points for performance indicators. |
| KPI/QoE | Separate module, imported | Keeps the topology TBox stable; lets the indicator layer evolve independently. |

## 2. Class taxonomy

### 2.1 5G SA (topology core)

```
NetworkEntity
├── UserEquipment                             (Terminal domain)
├── NgRanNode ── GNB, NgENB                   (Radio access domain)
├── GNB_CU ── GNB_CU_CP, GNB_CU_UP            (logicallyPartOf GNB)
├── GNB_DU,  RadioUnit*                       (logicallyPartOf GNB)
├── CoreNetworkFunction                       (Core domain)
│   ├── ControlPlaneFunction ── AMF, SMF, PCF, UDM, AUSF, NRF, NSSF,
│   │                            NEF, UDR, UDSF, NWDAF, CHF, BSF, LMF,
│   │                            SMSF, EASDF, NSACF
│   ├── UserPlaneFunction ── UPF
│   └── (proxies) SCP, SEPP
├── Non3GPPAccessGateway ── N3IWF             (Core domain)
├── AF                                         (Service domain — NOT a 5GC NF)
├── TransportNetworkElement                    (Transport domain)
│   ├── FronthaulTransport*
│   ├── MidhaulTransport*
│   └── BackhaulTransport*
├── Cell                                       (Radio access — KPI granularity)
├── DataNetwork                                (Service domain)
└── ServiceProvider ── EdgeApplicationServer   (Service domain)

Session layer (Measurable only, not NetworkEntity):
  ProtocolDataUnitSession ── QoSFlow ── DataRadioBearer

ReferencePoint
├── ControlPlaneReferencePoint  (N1,N2,N4,N5,N7,N8,N10–N16,N22,N23,N28,N33,N35–N37,N40,F1-C)
├── UserPlaneReferencePoint     (N3,N6,N9,F1-U)
├── RadioReferencePoint         (Uu,F1,E1,Xn,Fronthaul*)
└── ServiceBasedInterface       (Namf,Nsmf,Npcf,Nudm,Nnrf,…)

Link (reified)  ·  Service / ServiceSession / EndToEndPath / PathSegment
NetworkDomain (Terminal/RadioAccess/Transport/Core/Service)
```
`*` = non-normative deployment extension.

### 2.2 4G EPC (extension, imports 5G core)

```
NetworkEntity
├── EutranNode ── ENB                         (Radio access — hosts Cell)
├── ... (all 5G SA entities above)
├── ControlPlaneFunction
│   ├── ... (5GC NFs)
│   ├── MME                                   (Core domain)
│   ├── HSS                                   (Core domain)
│   ├── PCRF                                  (Core domain)
│   ├── SGW_C                                 (CUPS — controls SGW-U over Sx)
│   └── PGW_C                                 (CUPS — controls PGW-U over Sxb)
└── UserPlaneFunction
    ├── UPF (5G)
    ├── SGW_U                                 (CUPS — controlledBy SGW-C)
    └── PGW_U                                 (CUPS — controlledBy PGW-C)

4G Reference Points:
  Uu-LTE, S1-MME, S1-U, S11, S5/S8-C, S5/S8-U,
  S6a, SGi, X2, Gx, S10, Sx, Sxb
```

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
