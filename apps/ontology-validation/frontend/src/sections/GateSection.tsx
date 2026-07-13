import { Download, RotateCcw } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { EmptyRun } from "../components/EmptyRun";
import { Card, CardHeader, CardBody } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Table, Td } from "../components/ui/Table";

export function GateSection() {
  const { dataset, run, refresh } = useStore();
  if (!run) return <EmptyRun />;

  async function restore(qid: number) {
    await api(`/api/quarantine/${qid}/restore`, { method: "POST" });
    await refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="写入闸门（Action Gate）"
          sub="通过闸门 = 非 quarantine ∧ 无 open violation；导出仅含可信对象"
          right={
            <a href={`/api/export/${dataset}/trusted.ttl?run_id=${run.run_id}`} target="_blank" rel="noreferrer">
              <Button size="sm" variant="primary"><Download size={14} /> 导出可信图谱</Button>
            </a>
          } />
        <CardBody className="text-xs text-[var(--fg-subtle)]">
          findings 的逐条 triage 在「收件箱」完成（按类型聚合打包审 + judge 折叠 + 修复采纳）；
          此处管 quarantine 恢复与可信导出。
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Quarantine（veto 拒收）" sub="可见、可审、可恢复——不丢弃" />
        <CardBody className="px-0 pb-0">
          {run.quarantine.length === 0 ? (
            <div className="px-4 pb-4 text-xs text-[var(--fg-subtle)]">无隔离对象</div>
          ) : (
            <Table>
              <tbody>
                {run.quarantine.map((q) => (
                  <tr key={q.qid} className="hover:bg-[var(--surface-2)]">
                    <Td className="mono">{q.object_id.split("#").pop()}</Td>
                    <Td className="text-xs text-[var(--fg-subtle)]">拒收原因：{q.reason}</Td>
                    <Td className="w-24">
                      <Button size="sm" onClick={() => restore(q.qid)}><RotateCcw size={13} /> 恢复</Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
