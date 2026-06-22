"""校验编排器：validator registry + 依赖 DAG + 三级权限（veto/score/advise）。

执行语义（specs AC-ORCH-*）：
- 拓扑序调度，depends_on 未完成不执行；
- veto 校验器失败 → 失败对象进 quarantine，后续校验器产出中涉及这些对象的
  finding 被过滤（对象粒度短路）；
- advise 校验器（judge）只能叠加 judge 列 / 新建 advise 级 finding，
  由 judges 模块自行约束，编排器不赋予其修改既有 finding 的通道；
- 同 input_hash + validator 重复运行 → 命中缓存，不重复执行。
"""
from __future__ import annotations

import hashlib
import json
import time
import uuid
from dataclasses import dataclass, field
from graphlib import TopologicalSorter
from typing import Any, Callable, Protocol

from . import store
from .datasets import Bundle
from .models import Authority, Finding, ValidationResult


@dataclass
class Context:
    bundle: Bundle
    conn: Any
    run_id: str
    quarantined: set[str] = field(default_factory=set)
    config: dict[str, Any] = field(default_factory=dict)
    results: dict[str, ValidationResult] = field(default_factory=dict)


class ValidatorFn(Protocol):
    def __call__(self, ctx: Context) -> ValidationResult: ...


@dataclass
class ValidatorSpec:
    validator_id: str             # 命名空间.目的，如 instance.required-fields（取代 V 编号）
    category: str                 # intake/schema/instance/rule/process/cross/meta（id 前缀=此）
    scope: frozenset[str]         # {schema,instance,rule,process} 子集；驱动分组展示+change-set 触发
    title: str                    # 界面用目的名（中文）
    authority: Authority
    fn: ValidatorFn
    depends_on: list[str] = field(default_factory=list)
    applicable: Callable[[Bundle], bool] = lambda b: True
    cacheable: bool = True


class Registry:
    def __init__(self) -> None:
        self._specs: dict[str, ValidatorSpec] = {}

    def register(self, spec: ValidatorSpec) -> None:
        if spec.validator_id in self._specs:
            raise ValueError(f"duplicate validator: {spec.validator_id}")
        self._specs[spec.validator_id] = spec

    def topo_order(self) -> list[ValidatorSpec]:
        graph = {vid: set(s.depends_on) for vid, s in self._specs.items()}
        return [self._specs[vid] for vid in TopologicalSorter(graph).static_order()]

    def get(self, vid: str) -> ValidatorSpec:
        return self._specs[vid]

    def all(self) -> list[ValidatorSpec]:
        return list(self._specs.values())

    def scoped_run_set(self, change_set: set[str]) -> set[str]:
        """change-set 触发集（spec §4）：scope 命中 change_set 的直接触发。

        每个校验器的 scope 已诚实列出它（含读取的）全部制品类型，所以直接命中即可
        正确级联（如 process.simulation 读规则 guard，scope 含 rule，改规则会直接触发）。
        额外只对**纯聚合节点**（scope 为空，如 meta.review 复判所有 findings）做下游闭包：
        任一输入被触发就纳入复判。不做全量下游闭包——否则 intake.structure 因含 rule 被触发，
        会把它下游的 process.soundness 等无关节点一并拉起（改规则不该重跑流程健全性）。"""
        run_set = {s.validator_id for s in self._specs.values()
                   if s.scope & change_set}
        changed = True
        while changed:
            changed = False
            for s in self._specs.values():
                if s.validator_id in run_set or s.scope:   # 仅空 scope 的聚合节点做闭包
                    continue
                if any(d in run_set for d in s.depends_on):
                    run_set.add(s.validator_id)
                    changed = True
        return run_set


def _input_hash(bundle: Bundle, spec: ValidatorSpec, config: dict) -> str:
    raw = json.dumps({"content": bundle.content_hash, "validator": spec.validator_id,
                      "config": config.get(spec.validator_id, {})}, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _filter_quarantined(findings: list[Finding], quarantined: set[str]) -> list[Finding]:
    return [f for f in findings if f.object_id not in quarantined]


def run_pipeline(bundle: Bundle, registry: Registry, conn,
                 config: dict | None = None, run_id: str | None = None,
                 change_set: set[str] | None = None) -> Context:
    """跑全管线，返回带结果的 Context。

    change_set 不为 None 时按作用对象选择性触发（spec §4）：只跑 scope 命中
    change_set 的校验器及其 DAG 下游；其余记 verdict='scope_skip'、视作已满足依赖。
    """
    ctx = Context(bundle=bundle, conn=conn, run_id=run_id or f"run_{uuid.uuid4().hex[:8]}",
                  config=config or {})
    executed: set[str] = set()
    inapplicable: set[str] = set()
    run_set = registry.scoped_run_set(change_set) if change_set is not None else None

    for spec in registry.topo_order():
        if not spec.applicable(bundle):
            inapplicable.add(spec.validator_id)
            continue
        # change-set 之外的校验器：记 scope_skip，并视作已满足依赖（同 inapplicable），
        # 让被触发的下游（如仅实例变更时的 meta.review）不被卡（spec §4）
        if run_set is not None and spec.validator_id not in run_set:
            inapplicable.add(spec.validator_id)
            store.record_run(conn, run_id=ctx.run_id, dataset=bundle.dataset_id,
                             validator_id=spec.validator_id, authority=spec.authority,
                             verdict="scope_skip", input_hash=None, cached=False,
                             started_at=store.now_iso(), duration_ms=0)
            continue
        # 对该数据集不适用的依赖视为已满足（如 pizza 无 minimal shapes）
        missing = [d for d in spec.depends_on
                   if d not in executed and d not in inapplicable]
        if missing:   # 依赖未执行（如对该数据集不适用）→ 跳过但不报错
            store.record_run(conn, run_id=ctx.run_id, dataset=bundle.dataset_id,
                             validator_id=spec.validator_id, authority=spec.authority,
                             verdict="skip", input_hash=None, cached=False,
                             started_at=store.now_iso(), duration_ms=0)
            continue

        ihash = _input_hash(bundle, spec, ctx.config) if spec.cacheable else None
        started = store.now_iso()
        t0 = time.monotonic()

        cached_rows = store.cached_findings(conn, ihash, spec.validator_id) if ihash else None
        if cached_rows is not None and not ctx.config.get("no_cache"):
            findings = [Finding(validator_id=r["validator_id"], severity=r["severity"],
                                object_type=r["object_type"], object_id=r["object_id"],
                                finding_type=r["finding_type"], message=r["message"],
                                locus=json.loads(r["locus_json"] or "{}"),
                                evidence=json.loads(r["evidence_json"]) if r["evidence_json"] else None)
                        for r in cached_rows]
            result = ValidationResult(
                verdict="fail" if any(f.severity == "violation" for f in findings) else "pass",
                findings=findings,
                quarantined={f.object_id for f in findings} if spec.authority == "veto" and findings else set())
            cached = True
        else:
            result = spec.fn(ctx)
            cached = False

        # 对象粒度短路：过滤已 quarantine 对象的 finding（AC-ORCH-1）
        kept = _filter_quarantined(result.findings, ctx.quarantined)
        # 稳定排序后入库：pySHACL/rdflib 的图遍历顺序跨进程不稳定，
        # 不排序则 finding 行 id 漂移 → j3 复判输入漂移 → cassette 失配
        kept.sort(key=lambda f: (f.object_id, f.finding_type, f.message))
        store.record_findings(conn, ctx.run_id, kept)

        if spec.authority == "veto" and result.quarantined:
            newly = result.quarantined - ctx.quarantined
            ctx.quarantined |= newly
            store.record_quarantine(conn, ctx.run_id, bundle.dataset_id, newly,
                                    reason=spec.validator_id)

        store.record_run(conn, run_id=ctx.run_id, dataset=bundle.dataset_id,
                         validator_id=spec.validator_id, authority=spec.authority,
                         verdict=result.verdict, input_hash=ihash, cached=cached,
                         started_at=started,
                         duration_ms=int((time.monotonic() - t0) * 1000))
        ctx.results[spec.validator_id] = ValidationResult(
            verdict=result.verdict, findings=kept,
            quarantined=result.quarantined, metrics=result.metrics)
        executed.add(spec.validator_id)

    return ctx
