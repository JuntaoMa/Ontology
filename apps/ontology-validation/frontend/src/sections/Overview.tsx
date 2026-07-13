import { useStore } from "../store";
import { Card, CardHeader, CardBody, Stat } from "../components/ui/Card";
import { Table, Th, Td } from "../components/ui/Table";
import { AuthorityBadge } from "../components/ui/Badge";
import { EmptyRun } from "../components/EmptyRun";
import { DagView } from "../components/DagView";
import { categoryOf, CATEGORY_NAME, LABEL, type Authority } from "../lib/semantics";

export function Overview() {
  const { run, findings } = useStore();
  if (!run) return <EmptyRun />;
  const sev = run.findings_by_severity || {};
  const cost = run.cost_card;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-3">
        <Stat label="quarantine（veto 拒收）" value={run.quarantine.length} sub="对象进入隔离区" />
        <Stat label="violation" value={sev.violation || 0} accent="var(--sev-violation)" />
        <Stat label="warning" value={sev.warning || 0} accent="var(--sev-warning)" />
        <Stat label="info" value={sev.info || 0} accent="var(--sev-info)" />
        <Stat label="人工成本节约（judge 复判）"
              value={<span>{cost.n_before}<span className="text-[var(--fg-subtle)]"> → </span>{cost.n_after}</span>}
              accent="var(--ok)"
              sub={`折叠 ${cost.folded} 条 · 降低 ${cost.saving_pct}%（折叠≠通过，可展开复核）`} />
        <Stat label="judge 缓存响应" value={run.judge_stats.cached_responses}
              sub={`tokens ${run.judge_stats.tokens_in}↑ ${run.judge_stats.tokens_out}↓`} />
      </div>

      <Card>
        <CardHeader title="校验流水线 DAG"
          sub="节点=校验器（按目的命名·拓扑序调度）· 边=依赖（depends_on）· 蓝粗框=汇聚节点（cross.rule-process 规则×流程 / meta.review 复判收口）· 半透明虚线=作用对象未变更未触发" />
        <CardBody><DagView run={run} /></CardBody>
      </Card>

      <Card>
        <CardHeader title="校验器执行" sub="registry + DAG + 三级权限（veto / score / advise）的拓扑线性化" />
        <CardBody className="px-0 pb-0">
          <Table>
            <thead>
              <tr><Th>类别</Th><Th>校验器</Th><Th>权限</Th><Th>verdict</Th><Th>缓存</Th><Th>耗时</Th><Th>findings</Th></tr>
            </thead>
            <tbody>
              {run.validators.map((v) => {
                const pruned = v.verdict === "scope_skip";
                return (
                <tr key={v.validator_id} className="hover:bg-[var(--surface-2)]" style={pruned ? { opacity: 0.5 } : undefined}>
                  <Td className="text-[var(--fg-muted)]">{CATEGORY_NAME[categoryOf(v.validator_id)] || categoryOf(v.validator_id)}</Td>
                  <Td><span className="mono">{v.validator_id}</span>
                      <span className="ml-1.5 text-[var(--fg-subtle)]">{LABEL[v.validator_id] || ""}</span></Td>
                  <Td><AuthorityBadge authority={v.authority as Authority} /></Td>
                  <Td>{pruned ? <span className="text-[var(--fg-subtle)]">未触发（作用对象未变更）</span> : v.verdict}</Td>
                  <Td className="text-[var(--fg-subtle)]">{v.cached ? "✓" : ""}</Td>
                  <Td className="text-[var(--fg-subtle)] tabular-nums">{pruned ? "" : `${v.duration_ms}ms`}</Td>
                  <Td className="tabular-nums">{findings.filter((f) => f.validator_id === v.validator_id).length}</Td>
                </tr>
                );
              })}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}
