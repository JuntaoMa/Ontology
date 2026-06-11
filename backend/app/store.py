"""SQLite 存储：validation_runs / findings / judge_cache / review_actions / quarantine。"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from .models import Finding

SCHEMA = """
CREATE TABLE IF NOT EXISTS validation_runs(
  id INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL, dataset TEXT NOT NULL,
  validator_id TEXT NOT NULL, authority TEXT NOT NULL,
  verdict TEXT NOT NULL, input_hash TEXT, cached INTEGER DEFAULT 0,
  started_at TEXT NOT NULL, duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_vr_cache ON validation_runs(input_hash, validator_id);
CREATE TABLE IF NOT EXISTS findings(
  id INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL, validator_id TEXT NOT NULL, severity TEXT NOT NULL,
  object_type TEXT NOT NULL, object_id TEXT NOT NULL,
  finding_type TEXT NOT NULL, message TEXT NOT NULL,
  locus_json TEXT, evidence_json TEXT, status TEXT DEFAULT 'open',
  judge_verdict TEXT, judge_confidence REAL, judge_rationale TEXT, repair_json TEXT
);
CREATE TABLE IF NOT EXISTS judge_cache(
  input_hash TEXT PRIMARY KEY, judge_id TEXT, model TEXT,
  response_json TEXT, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS review_actions(
  id INTEGER PRIMARY KEY, finding_id INTEGER NOT NULL,
  action TEXT NOT NULL, note TEXT, repair_snapshot TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quarantine(
  id INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL, dataset TEXT NOT NULL,
  object_id TEXT NOT NULL, reason TEXT, restored INTEGER DEFAULT 0
);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect(db_path: str | Path = ":memory:") -> sqlite3.Connection:
    # check_same_thread=False：FastAPI 同步端点跑在线程池；demo 单用户场景下
    # 由 SQLite 自身的串行化保证安全
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def record_run(conn, *, run_id: str, dataset: str, validator_id: str, authority: str,
               verdict: str, input_hash: str | None, cached: bool,
               started_at: str, duration_ms: int) -> None:
    conn.execute(
        "INSERT INTO validation_runs(run_id,dataset,validator_id,authority,verdict,"
        "input_hash,cached,started_at,duration_ms) VALUES(?,?,?,?,?,?,?,?,?)",
        (run_id, dataset, validator_id, authority, verdict,
         input_hash, int(cached), started_at, duration_ms))
    conn.commit()


def record_findings(conn, run_id: str, findings: list[Finding]) -> None:
    conn.executemany(
        "INSERT INTO findings(run_id,validator_id,severity,object_type,object_id,"
        "finding_type,message,locus_json,evidence_json) VALUES(?,?,?,?,?,?,?,?,?)",
        [(run_id, f.validator_id, f.severity, f.object_type, f.object_id,
          f.finding_type, f.message, json.dumps(f.locus, ensure_ascii=False),
          json.dumps(f.evidence, ensure_ascii=False) if f.evidence else None)
         for f in findings])
    conn.commit()


def record_quarantine(conn, run_id: str, dataset: str, objects: set[str], reason: str) -> None:
    conn.executemany(
        "INSERT INTO quarantine(run_id,dataset,object_id,reason) VALUES(?,?,?,?)",
        [(run_id, dataset, o, reason) for o in sorted(objects)])
    conn.commit()


def quarantined_objects(conn, run_id: str) -> set[str]:
    rows = conn.execute(
        "SELECT object_id FROM quarantine WHERE run_id=? AND restored=0", (run_id,))
    return {r["object_id"] for r in rows}


def cached_findings(conn, input_hash: str, validator_id: str) -> list[sqlite3.Row] | None:
    """命中缓存则返回上一次该 validator 的 findings 行（AC-ORCH-4）。"""
    prev = conn.execute(
        "SELECT run_id FROM validation_runs WHERE input_hash=? AND validator_id=? "
        "AND cached=0 ORDER BY id DESC LIMIT 1", (input_hash, validator_id)).fetchone()
    if prev is None:
        return None
    return conn.execute(
        "SELECT * FROM findings WHERE run_id=? AND validator_id=?",
        (prev["run_id"], validator_id)).fetchall()
