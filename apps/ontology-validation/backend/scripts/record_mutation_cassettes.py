"""录制变异实验室 LLM 算子的 judge 响应（离线 demo 用）。"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import store                                    # noqa: E402
from app.datasets import load_bundle                     # noqa: E402
from app.judges.base import dump_cassette, load_cassette  # noqa: E402
from app.pipeline import build_registry                  # noqa: E402
from app.validators.mutation import run_mutation_lab     # noqa: E402

CASSETTE = Path(__file__).resolve().parents[2] / "cassettes" / "loan.json"

conn = store.connect(":memory:")
if CASSETTE.exists():
    load_cassette(conn, CASSETTE)          # 复用已录制的基线 judge 响应

results = run_mutation_lab(
    load_bundle("loan"), build_registry(), conn,
    ops=["mut_wrong_parent", "mut_guard_vs_evidence", "mut_edge_evidence_reverse"],
    judge_config={"backend": "cli"})

for r in results:
    ok = set(r.expected_layers) <= set(r.captured_layers)
    print(f"[{'✓' if ok else '✗'}] {r.op_id}: captured={r.captured_layers}")
    if not ok:
        print("    new:", json.dumps(r.new_findings[:5], ensure_ascii=False))

n = dump_cassette(conn, CASSETTE)
print(f"cassette 合并 → {CASSETTE}（共 {n} 条）")
sys.exit(0 if all(set(r.expected_layers) <= set(r.captured_layers) for r in results) else 1)
