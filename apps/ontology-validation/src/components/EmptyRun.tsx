import { Play } from "lucide-react";
import { useStore } from "../store";
import { Button } from "./ui/Button";

export function EmptyRun({ hint }: { hint?: string }) {
  const { triggerRun, running } = useStore();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="text-sm text-[var(--fg-muted)]">{hint ?? "尚未运行校验管线"}</div>
      <Button variant="primary" onClick={triggerRun} disabled={running}>
        <Play size={15} /> 运行全管线
      </Button>
      <div className="max-w-sm text-xs text-[var(--fg-subtle)]">
        首次 judge 调用走缓存/cassette 时秒级完成；live 后端首跑约数十秒。
      </div>
    </div>
  );
}
