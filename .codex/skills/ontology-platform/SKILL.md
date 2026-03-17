---
name: ontology-platform
description: Ontology-based business platform skill. Use when an agent needs to handle ontology-grounded business questions by first inspecting ontology resources, routing the question type, checking whether existing function/action capabilities are sufficient, and then either querying data, orchestrating known business flows, drafting missing capabilities, or generating normalized function/action definitions.
---

Use this skill as the main entry for an ontology-based business QA system.

## Read Order

Read the smallest useful context first:
- Read `domains/index.json` to discover available domains.
- Read `references/system-overview.md` for the generic ontology model and expression rules.
- Read `references/problem-routing.md` to classify the incoming question.
- Read `references/unified-entrypoints.md` to decide which high-level entry function to use first.
- Read `references/logic-layer-format.md` only when you need to inspect, draft, or revise a function/action logic body.
- After selecting a domain, read that domain's `manifest.json`.
- Then read `ontology/objects.json` and `ontology/links.json` before reading `ontology/functions.json` and `ontology/actions.json`.
- Read `runtime/entrypoints.json` and `runtime/path-templates.json` only when you need discovery or query help.
- Read `runtime/capability-graph.json` when you need to move from an object to related functions/actions, or from a capability back to the objects and links it depends on.

## Ontology Model

Treat the ontology as three clearly separated parts:
- `语义面`: `Object` and `Link` only. Use this part to understand what business objects exist and how they connect.
- `能力面`: `Function` and `Action` only. Use this part to understand what the system can compute, evaluate, orchestrate, or report.
- `运行时辅助层`: query entrypoints, path templates, and the capability graph. Use this part to discover paths and match capabilities, but do not treat it as ontology core.
- `逻辑层`: detailed logic bodies for functions and actions. This part stays in markdown files, not in ontology JSON.

Do not mix the parts:
- Do not treat ontology metadata as executable logic.
- Do not hide business conclusions inside runtime assets.
- Do not invent capabilities that are not present in metadata unless you are explicitly drafting a new one.
- Do not confuse semantic links with capability dependency edges; they belong to the same discovery view but carry different meanings.

## Problem Classes

Route each user question into one of these classes before doing domain work:

1. `查询类问题`
   Use when the user asks for existing instances, related objects, paths, or property values already present in the ontology-backed data.

2. `已知业务流程类问题`
   Use when the user asks a business question that can be satisfied by existing function/action metadata after combining query, calculation, and orchestration.

3. `能力缺口业务流程类问题`
   Use when the user asks a business question that requires business flow orchestration, but the current function/action metadata is insufficient.

4. `新能力定义类问题`
   Use when the user directly describes a new function or action in natural language and wants a normalized capability definition.

## High-Level Workflow

Always follow this sequence:
1. Classify the problem.
2. Discover the relevant domain.
3. Inspect semantic resources through unified entrypoints.
4. Ground the question to explicit objects, links, properties, functions, and actions.
5. Decide whether existing capabilities are sufficient.
6. Use runtime helpers only when needed for path discovery, capability discovery, or instance reads.
7. Produce one of the allowed outputs below.

Allowed outputs by problem class:
- `查询类问题` -> query plan + result or dry-run result
- `已知业务流程类问题` -> decomposition + matched capabilities + orchestration plan + report
- `能力缺口业务流程类问题` -> decomposition + gap analysis + new capability drafts + provisional orchestration + review-ready report
- `新能力定义类问题` -> normalized FunctionSpec or ActionSpec draft + logic-body draft template

## Expression Rules

Use strict references everywhere:
- Properties must use `Class.property`.
- Link traversal must use `Class -LINK-> Class`.
- Function calls must use `func(arg1, arg2, ...)`.
- Action calls must use `action(arg1, arg2, ...)`.
- Bound values should use `binding_name.field`.

Never use fuzzy references such as:
- “库存够不够”
- “这个物料的一些属性”
- “调用那个周期函数”

Rewrite them into explicit ontology-aligned forms such as:
- `SampleObject.status = "active"`
- `SampleContext.priority >= threshold`
- `assess(...)`

## Guardrails

- Keep `Object/Link`, `Function/Action`, and `runtime` responsibilities separated.
- Query steps may read, bind, and traverse, but may not produce business conclusions.
- Functions may compute, normalize, rank, and transform, but may not silently expand beyond their declared dependency scope.
- Actions may orchestrate query/function/action calls and control flow, but may not skip ontology grounding.
- Use the capability graph to accelerate discovery, but confirm capability fit against function/action metadata before answering.
- When data is missing, stop at the highest-fidelity partial result and state the missing ontology fields or missing capabilities.
- When current capabilities are insufficient, draft new metadata and logic placeholders instead of pretending the system already supports them.

## Sample Assets

This skill includes a sample domain pack:
- `domains/index.json`
- `domains/sample-generic/manifest.json`
- `domains/sample-generic/ontology/*.json`
- `domains/sample-generic/runtime/*.json`
- `domains/sample-generic/logic/**`

Use it as a template for how to package a real business domain into one self-contained folder.

## Expected Output Shape

Always make these items explicit:
- problem class
- ontology objects, links, and properties involved
- matched existing functions
- matched existing actions
- missing capabilities, if any
- whether the answer is based on real data, metadata inspection, runtime discovery, or a draft logic plan
- review points that require human confirmation
