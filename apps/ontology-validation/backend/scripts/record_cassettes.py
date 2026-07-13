"""用真实后端（默认 claude CLI）跑 judge 并录制 cassette。

用法：.venv/bin/python scripts/record_cassettes.py [dataset ...]
录制后立刻做回放自检：AC-MUT-LLM 三缺陷必须被真实 judge 检出。
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import store                                    # noqa: E402
from app.datasets import load_bundle                     # noqa: E402
from app.judges.base import dump_cassette, load_cassette  # noqa: E402
from app.orchestrator import run_pipeline                # noqa: E402
from app.pipeline import build_registry                  # noqa: E402

CASSETTE_DIR = Path(__file__).resolve().parents[2] / "cassettes"


def record(dataset: str) -> None:
    conn = store.connect(":memory:")
    existing = CASSETTE_DIR / f"{dataset}.json"
    if existing.exists():
        load_cassette(conn, existing)      # 增量重录：已有响应直接命中
    cfg = {"no_cache": True, "judge": {"enabled": True, "backend": "cli"}}
    print(f"== {dataset}: 真实 judge 运行中（claude CLI / claude-opus-4-8）==")
    ctx = run_pipeline(load_bundle(dataset), build_registry(), conn, config=cfg)

    for vid in ("schema.semantic", "cross.faithfulness", "meta.review"):
        if vid in ctx.results:
            m = ctx.results[vid].metrics
            n = len(ctx.results[vid].findings)
            print(f"  {vid}: findings={n} metrics={m}")

    CASSETTE_DIR.mkdir(exist_ok=True)
    out = CASSETTE_DIR / f"{dataset}.json"
    n = dump_cassette(conn, out)
    print(f"  cassette → {out}（{n} 条）")

    if dataset == "loan":                                # 真实 judge 的 gold 自检
        j1 = ctx.results["schema.semantic"].findings
        j2 = ctx.results["cross.faithfulness"].findings
        checks = {
            "O9 (J1 语义)": any("TemporaryEmployee" in f.object_id for f in j1),
            "R11 (J2 忠实性)": any(f.object_id == "R11" for f in j2),
            "P-edge (J2 忠实性)": any(f.object_id == "loan_edge_unfaithful" for f in j2),
        }
        for k, ok in checks.items():
            print(f"  [{'✓' if ok else '✗'}] {k}")
        if not all(checks.values()):
            print("  !! 真实 judge 未全部命中 gold——检查 prompt 或模型配置")
            sys.exit(1)


if __name__ == "__main__":
    for ds in (sys.argv[1:] or ["loan"]):
        record(ds)
