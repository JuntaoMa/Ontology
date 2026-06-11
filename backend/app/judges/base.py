"""Judge SOP 基座：结构化输出 + 证据引用强制 + 解析失败重试 + 缓存/cassette。

SOP（plan §4.5，TP §2.11.4 的 demo 子集）：
- 输出经 Pydantic 校验；首次解析失败 → 带错误反馈重试 1 次，再失败 → 整批 uncertain（AC-J-SCHEMA）；
- 每个 item 必须给 cited_evidence 且能在我们提供的源材料中找到（白名单比对），
  否则程序侧降级 uncertain（AC-J-EVIDENCE）——judge 不许凭空断言；
- 缓存：input-hash 命中即不调用（judge_cache 兼作 cassette，AC-J-CASSETTE）；
- advise 权限：本模块只产出 ItemVerdict / 更新 findings 的 judge 列，
  没有任何修改确定性 finding 本体字段的代码路径（AC-ORCH-3）。
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, Field, ValidationError

from .. import store
from .backends import DEFAULT_MODEL, BackendResponse, JudgeBackend, select_backend


class ItemVerdict(BaseModel):
    item_id: str
    verdict: Literal["issue_found", "no_issue", "uncertain",
                     "confirm", "likely_false_positive"]
    dimensions: dict[str, bool] = Field(default_factory=dict)
    confidence: float = 0.0
    cited_evidence: str = ""
    rationale: str = ""
    repair_suggestion: str | None = None
    classification: str | None = None      # J3 对 CQ 失败的三分类提议


class JudgeBatchOutput(BaseModel):
    items: list[ItemVerdict]


OUTPUT_SCHEMA_NOTE = """
你必须只输出一个 JSON 对象（不要 markdown 代码块、不要解释文字），形如：
{"items": [{"item_id": "...", "verdict": "...", "dimensions": {"维度名": true},
  "confidence": 0.0到1.0, "cited_evidence": "从输入材料中逐字引用的依据片段",
  "rationale": "判定理由", "repair_suggestion": "候选修复（无则为 null）",
  "classification": null}]}
verdict 取值按任务说明。cited_evidence 必须逐字复制输入材料中的片段，禁止改写。
对每个输入 item 都要给出一个结果；没把握就用 "uncertain"。
"""


@dataclass
class JudgeRunMeta:
    judge_id: str
    model: str
    cached: bool
    backend: str | None
    tokens_in: int = 0
    tokens_out: int = 0
    downgraded: int = 0
    parse_retries: int = 0


def _hash_input(judge_id: str, model: str, system: str, prompt: str) -> str:
    return hashlib.sha256(
        f"{judge_id}|{model}|{system}|{prompt}".encode()).hexdigest()[:16]


def _extract_json(text: str) -> str:
    """容忍 judge 把 JSON 包进代码块。"""
    m = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.DOTALL)
    if m:
        return m.group(1)
    start = text.find("{")
    end = text.rfind("}")
    return text[start:end + 1] if start >= 0 and end > start else text


_WS = re.compile(r"\s+")


def _normalize(s: str) -> str:
    return _WS.sub("", s)


def enforce_evidence(out: JudgeBatchOutput,
                     source_material: dict[str, str]) -> int:
    """cited_evidence 必须出现在该 item 的源材料中，否则降级 uncertain。"""
    downgraded = 0
    for item in out.items:
        if item.verdict in ("no_issue", "uncertain"):
            continue
        src = _normalize(source_material.get(item.item_id, ""))
        cited = _normalize(item.cited_evidence)
        if not cited or cited not in src:
            item.verdict = "uncertain"
            item.rationale = f"[程序降级：引用证据未在源材料中找到] {item.rationale}"
            downgraded += 1
    return downgraded


def run_judge(*, judge_id: str, system: str, prompt: str,
              source_material: dict[str, str], conn,
              config: dict | None = None) -> tuple[JudgeBatchOutput | None, JudgeRunMeta]:
    cfg = (config or {}).get("judge", {})
    model = cfg.get("model", DEFAULT_MODEL)
    key = _hash_input(judge_id, model, system, prompt)

    row = conn.execute("SELECT * FROM judge_cache WHERE input_hash=?", (key,)).fetchone()
    if row is not None:
        out = JudgeBatchOutput.model_validate_json(row["response_json"])
        meta = JudgeRunMeta(judge_id, row["model"], cached=True, backend="cache",
                            tokens_in=row["tokens_in"], tokens_out=row["tokens_out"])
        meta.downgraded = enforce_evidence(out, source_material)
        return out, meta

    backend = select_backend(config)
    if backend is None:                       # cassette-only 且未命中 → 弃权
        return None, JudgeRunMeta(judge_id, model, cached=False, backend=None)

    meta = JudgeRunMeta(judge_id, model, cached=False, backend=backend.name)
    full_prompt = prompt + "\n\n" + OUTPUT_SCHEMA_NOTE
    resp: BackendResponse = backend.complete(system, full_prompt, model)
    meta.tokens_in += resp.tokens_in
    meta.tokens_out += resp.tokens_out

    out: JudgeBatchOutput | None = None
    try:
        out = JudgeBatchOutput.model_validate_json(_extract_json(resp.text))
    except (ValidationError, json.JSONDecodeError) as e:
        meta.parse_retries = 1                # 带错误反馈重试一次（AC-J-SCHEMA）
        retry_prompt = (full_prompt
                        + f"\n\n上次输出无法解析（错误：{str(e)[:300]}）。"
                          "请严格按 schema 重新输出 JSON。")
        resp2 = backend.complete(system, retry_prompt, model)
        meta.tokens_in += resp2.tokens_in
        meta.tokens_out += resp2.tokens_out
        try:
            out = JudgeBatchOutput.model_validate_json(_extract_json(resp2.text))
        except (ValidationError, json.JSONDecodeError):
            return None, meta                 # 二次失败 → 整批弃权

    conn.execute(
        "INSERT OR REPLACE INTO judge_cache(input_hash,judge_id,model,response_json,"
        "tokens_in,tokens_out,created_at) VALUES(?,?,?,?,?,?,?)",
        (key, judge_id, model, out.model_dump_json(),
         meta.tokens_in, meta.tokens_out, store.now_iso()))
    conn.commit()
    meta.downgraded = enforce_evidence(out, source_material)
    return out, meta


# ---------------- cassette 装载/导出 ----------------

def load_cassette(conn, path) -> int:
    rows = json.loads(path.read_text())
    for r in rows:
        conn.execute(
            "INSERT OR IGNORE INTO judge_cache(input_hash,judge_id,model,response_json,"
            "tokens_in,tokens_out,created_at) VALUES(?,?,?,?,?,?,?)",
            (r["input_hash"], r["judge_id"], r["model"], r["response_json"],
             r.get("tokens_in", 0), r.get("tokens_out", 0), r.get("created_at", "")))
    conn.commit()
    return len(rows)


def dump_cassette(conn, path) -> int:
    rows = [dict(r) for r in conn.execute("SELECT * FROM judge_cache")]
    path.write_text(json.dumps(rows, ensure_ascii=False, indent=1))
    return len(rows)
