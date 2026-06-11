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
    validator_id: str
    layer: str                    # V0..V5
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


def _input_hash(bundle: Bundle, spec: ValidatorSpec, config: dict) -> str:
    raw = json.dumps({"content": bundle.content_hash, "validator": spec.validator_id,
                      "config": config.get(spec.validator_id, {})}, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _filter_quarantined(findings: list[Finding], quarantined: set[str]) -> list[Finding]:
    return [f for f in findings if f.object_id not in quarantined]


def run_pipeline(bundle: Bundle, registry: Registry, conn,
                 config: dict | None = None, run_id: str | None = None) -> Context:
    """跑全管线，返回带结果的 Context。"""
    ctx = Context(bundle=bundle, conn=conn, run_id=run_id or f"run_{uuid.uuid4().hex[:8]}",
                  config=config or {})
    executed: set[str] = set()

    for spec in registry.topo_order():
        if not spec.applicable(bundle):
            continue
        missing = [d for d in spec.depends_on if d not in executed]
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
