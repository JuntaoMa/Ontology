"""数据集加载：把 loan / pizza 目录装配成统一 Bundle。"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path

from rdflib import Graph

DATASETS_DIR = Path(__file__).resolve().parents[2] / "datasets"


@dataclass
class Bundle:
    dataset_id: str
    root: Path
    ontology: Graph
    data: Graph                       # ontology + instances 合并图（校验输入）
    shapes_minimal: Graph | None
    shapes_trusted: Graph | None
    rules: dict | None                # rules.json 原始 dict（结构校验后转 RuleSet）
    processes: dict[str, dict] = field(default_factory=dict)   # process_id -> 原始 dict
    cqs: dict | None = None
    content_hash: str = ""


def _read_graph(*paths: Path) -> Graph:
    g = Graph()
    for p in paths:
        if p.exists():
            g.parse(str(p))
    return g


def _hash_files(*paths: Path) -> str:
    h = hashlib.sha256()
    for p in sorted(paths):
        if p.exists():
            h.update(p.name.encode())
            h.update(p.read_bytes())
    return h.hexdigest()[:16]


def load_bundle(dataset_id: str, root: Path | None = None) -> Bundle:
    base = (root or DATASETS_DIR) / dataset_id
    if not base.exists():
        raise FileNotFoundError(f"dataset not found: {base}")

    if dataset_id == "pizza":
        onto = _read_graph(base / "pizza.owl")
        data = _read_graph(base / "pizza.owl", base / "seeded_inconsistency.ttl")
        shapes_min = None
        shapes_tru = _read_graph(base / "shapes.ttl") if (base / "shapes.ttl").exists() else None
    else:
        onto = _read_graph(base / "ontology.ttl")
        data = _read_graph(base / "ontology.ttl", base / "instances.ttl")
        shapes_min = _read_graph(base / "shapes" / "minimal.ttl") if (base / "shapes" / "minimal.ttl").exists() else None
        shapes_tru = _read_graph(base / "shapes" / "trusted.ttl") if (base / "shapes" / "trusted.ttl").exists() else None

    rules = None
    rules_path = base / "rules.json"
    if rules_path.exists():
        rules = json.loads(rules_path.read_text())

    processes: dict[str, dict] = {}
    for p in sorted(base.glob("process_*.json")):
        d = json.loads(p.read_text())
        processes[d["process_id"]] = d

    cqs = None
    cq_path = base / "cqs.json"
    if cq_path.exists():
        cqs = json.loads(cq_path.read_text())

    content_hash = _hash_files(*base.rglob("*.*"))
    return Bundle(dataset_id=dataset_id, root=base, ontology=onto, data=data,
                  shapes_minimal=shapes_min, shapes_trusted=shapes_tru,
                  rules=rules, processes=processes, cqs=cqs, content_hash=content_hash)


def list_datasets(root: Path | None = None) -> list[str]:
    base = root or DATASETS_DIR
    return sorted(p.name for p in base.iterdir() if p.is_dir())
