"""数据感知仿真器 + mini-Declare 检查器（TP §2.9.1 交叉验证环的 demo 实现）。

数据感知仿真：随机生成 case 数据（与规则同一变量空间），在 IR 上走 token game，
XOR 分支按 condition 求值（按声明顺序首个为真者胜，均为假则 case 卡住记 stuck）。

mini-Declare 模板（语义对齐 Declare，便于后续替换 Declare4Py）：
  existence(A)                  : 每条 trace 必须包含活动 A
  absence(A)                    : 每条 trace 不得包含活动 A
  response(A,B)                 : A 出现后必须随后出现 B
  conditional_occurrence(cond,A): case 数据满足 cond 的 trace 必须包含 A
约束来源：从规则 IR 自动派生（hard 规则的 action 经 activity_action_map 绑定到活动）。
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field

from ..models import ProcessIR, RuleSet
from .guard_parser import eval_with, parse_guard


@dataclass
class Trace:
    case_id: int
    data: dict[str, float]
    activities: list[str] = field(default_factory=list)   # step id 序列
    completed: bool = False


def gen_case_data(ruleset: RuleSet, rng: random.Random) -> dict[str, float]:
    data: dict[str, float] = {}
    for name, spec in ruleset.variables.items():
        lo = spec.min if spec.min is not None else 0
        hi = spec.max if spec.max is not None else 1_000_000
        if spec.type == "int":
            data[name] = rng.randint(int(lo), int(hi))
        else:
            data[name] = round(rng.uniform(float(lo) + (1 if spec.min_exclusive else 0),
                                           float(hi)), 2)
    return data


def simulate(ir: ProcessIR, ruleset: RuleSet, n_cases: int = 300,
             seed: int = 42, max_steps: int = 200) -> list[Trace]:
    rng = random.Random(seed)
    kinds = ir.node_kinds()
    out_edges: dict[str, list] = {}
    for e in ir.edges:
        out_edges.setdefault(e.from_, []).append(e)
    cond_cache = {id(e): parse_guard(e.condition) for es in out_edges.values()
                  for e in es if e.condition}

    traces: list[Trace] = []
    for case_id in range(n_cases):
        data = gen_case_data(ruleset, rng)
        tr = Trace(case_id=case_id, data=data)
        node, steps = ir.start, 0
        while steps < max_steps:
            steps += 1
            if kinds.get(node) == "step":
                tr.activities.append(node)
                if node in ir.ends:
                    tr.completed = True
                    break
            edges = out_edges.get(node, [])
            if not edges:
                break                                   # 无出边且非 end → stuck
            if kinds.get(node) == "XOR" or any(e.condition for e in edges):
                nxt = None
                for e in edges:                          # 首个条件为真者胜
                    if e.condition is None or eval_with(cond_cache[id(e)], data):
                        nxt = e.to
                        break
                if nxt is None:
                    break                               # 所有条件为假 → stuck
                node = nxt
            else:
                # AND-split 的并行分支在数据感知仿真中按声明序串行展开（demo 简化，
                # 控制流级并发语义由 Petri/soundness 层负责）
                node = edges[0].to
        traces.append(tr)
    return traces


def activity_coverage(ir: ProcessIR, traces: list[Trace]) -> dict[str, int]:
    counts = {s.id: 0 for s in ir.steps}
    for tr in traces:
        for a in set(tr.activities):
            counts[a] += 1
    return counts


# ---------------- mini-Declare ----------------

@dataclass
class DeclareConstraint:
    constraint_id: str
    template: str                       # existence|absence|response|conditional_occurrence
    activity: str
    second_activity: str | None = None
    condition: str | None = None
    source_rule: str | None = None      # 回链规则 id（交叉验证环）

    def check(self, tr: Trace) -> bool:
        acts = tr.activities
        if self.template == "existence":
            return self.activity in acts
        if self.template == "absence":
            return self.activity not in acts
        if self.template == "response":
            ok = True
            for i, a in enumerate(acts):
                if a == self.activity:
                    ok = self.second_activity in acts[i + 1:]
            return ok
        if self.template == "conditional_occurrence":
            if not eval_with(parse_guard(self.condition), tr.data):
                return True
            return self.activity in acts
        raise ValueError(self.template)


def derive_constraints(ruleset: RuleSet, ir: ProcessIR) -> list[DeclareConstraint]:
    """从 hard 规则派生约束：action 经 activity_action_map 反查绑定的活动。"""
    action_to_activity = {v: k for k, v in ir.activity_action_map.items()}
    out: list[DeclareConstraint] = []
    for r in ruleset.rules:
        if r.tier != "hard":
            continue
        activity = action_to_activity.get(r.conclusion.action)
        if activity is None:
            continue
        out.append(DeclareConstraint(
            constraint_id=f"dc_{r.rule_id}", template="conditional_occurrence",
            activity=activity, condition=r.guard, source_rule=r.rule_id))
    return out


def check_constraints(constraints: list[DeclareConstraint],
                      traces: list[Trace]) -> dict[str, list[Trace]]:
    """约束 id → 违例 trace 列表（只看完整 trace）。"""
    violations: dict[str, list[Trace]] = {}
    for c in constraints:
        bad = [tr for tr in traces if tr.completed and not c.check(tr)]
        if bad:
            violations[c.constraint_id] = bad
    return violations
