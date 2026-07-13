export async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

export interface Finding {
  id: number;
  run_id: string;
  validator_id: string;
  severity: "violation" | "warning" | "info";
  object_type: string;
  object_id: string;
  finding_type: string;
  message: string;
  status: "open" | "accepted" | "dismissed";
  locus: any;
  evidence: any;
  judge_verdict: string | null;
  judge_confidence: number | null;
  judge_rationale: string | null;
  repair: { suggestion?: string | null; classification?: string | null } | null;
}

export interface RunSummary {
  run_id: string;
  dataset: string;
  validators: { validator_id: string; authority: string; verdict: string; cached: boolean; duration_ms: number }[];
  findings_by_severity: Record<string, number>;
  quarantine: { qid: number; object_id: string; reason: string }[];
  cost_card: { n_before: number; reviewed: number; folded: number; n_after: number; saving_pct: number };
  judge_stats: { cached_responses: number; tokens_in: number; tokens_out: number };
}
