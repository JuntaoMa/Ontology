# 3GPP Specification Index — 5G SA Topology Ontology

**Baseline release:** Rel-19 (`j`-series) · pinned for citation coherence.
**Retrieved:** 2026-06-26 from `https://www.3gpp.org/ftp/Specs/archive/`.
**Download record:** `raw/fetch.log` (reproducible via `raw/fetch.sh`).

The ontology cites these via the `fgs:specRef` / `fgs:specClause` annotations and
`dcterms:source`. Letter→version: `f`=R15, `g`=R16, `h`=R17, `i`=R18, `j`=R19, `k`=R20.

---

## A. Downloaded specs (local: `raw/*.zip`, text: `txt/*.txt`)

| TS | Version | Title | Why it's in the model | Key clauses used |
|----|---------|-------|-----------------------|------------------|
| **23.501** | V19.8.0 (2026-06) | System architecture for the 5G System (5GS); Stage 2 | The 5GC architecture: NFs, reference points, QoS. Primary source. | 4.2.2–4.2.3 (architecture & reference points), 6.2 (NF descriptions), 5.6 (DN), 5.7 (QoS/5QI) |
| **38.300** | V19.2.0 (2026-03) | NR; NR and NG-RAN Overall Description; Stage 2 | NG-RAN overall: gNB/ng-eNB, Uu, Xn, NG. | 3, 4 (architecture), 11 (Xn) |
| **38.401** | V19.3.0 (2026-06) | NG-RAN; Architecture description | gNB functional split (CU/DU, CU-CP/CU-UP), F1, E1. | 6.1 (architecture), 6.1.2 (CU-CP/CU-UP separation) |
| **38.410** | V19.2.0 (2026-03) | NG-RAN; NG general aspects and principles | NG interface (NG-C=N2 / NG-U=N3) between NG-RAN and 5GC. | 5 (functions), 6 (services) |
| **38.420** | V19.1.0 (2025-12) | NG-RAN; Xn general aspects and principles | Xn interface between NG-RAN nodes. | 5, 6 |
| **38.460** | V19.0.0 (2025-09) | NG-RAN; E1 general aspects and principles | E1 between gNB-CU-CP and gNB-CU-UP. | 5, 6 |
| **38.470** | V19.2.0 (2026-06) | NG-RAN; F1 general aspects and principles | F1 between gNB-CU and gNB-DU (F1-C / F1-U). | 5, 6 |
| **23.503** | V19.8.0 (2026-06) | Policy and charging control framework for the 5GS; Stage 2 | PCF/policy context for the QoS layer. | 6 (framework) |
| **28.552** | V19.7.0 (2026-03) | Management and orchestration; 5G performance measurements | PM counter catalogue → `pm:Counter`. | 5 (measurements per NF) |
| **28.554** | V19.7.0 (2026-03) | Management and orchestration; 5G end-to-end KPIs | KPI category structure → `pm:KPI` subclasses. | 6.2–6.11 (Accessibility/Integrity/Latency/Utilization/Retainability/Mobility/Energy/Availability) |

## B. Referenced but NOT downloaded (cited in annotations; fetch on demand)

| TS | Title | Used for |
|----|-------|----------|
| 23.502 | Procedures for the 5G System (5GS); Stage 2 | Procedural detail (call flows) — future ABox/path work |
| 23.288 | Architecture enhancements for 5GS to support NWDAF | NWDAF analytics detail |
| 23.548 | 5G System Enhancements for Edge Computing; Stage 2 | EASDF, Edge Application Server |
| 28.404 | QoE measurement collection; Concepts, use cases, requirements | `pm:QoEMetric` grounding |
| 28.405 | QoE measurement collection; Control and reporting | `pm:QoEMetric` grounding |
| 29.244 | Interface between Control Plane and User Plane nodes (PFCP) | N4 detail |
| 29.281 | GTP-U | N3/N9 user-plane detail |
| 38.413 | NG-RAN; NG Application Protocol (NGAP) | N2 detail |
| 23.003 | Numbering, addressing and identification | Identifiers (future ABox) |
| 32.240 | Charging architecture | CHF / N40 context |

> To fetch any of the above, add its `series/spec/file.zip` line to `raw/fetch.sh` and re-run.
