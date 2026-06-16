import { LayoutDashboard, Inbox, Network, Scale, GitBranch, FlaskConical, DoorOpen, X } from "lucide-react";
import { useStore, type Section } from "../store";
import { cn } from "../lib/cn";

const NAV: { id: Section; label: string; Icon: any }[] = [
  { id: "overview", label: "总览", Icon: LayoutDashboard },
  { id: "inbox", label: "收件箱", Icon: Inbox },
  { id: "ontology", label: "本体校验", Icon: Network },
  { id: "rules", label: "规则校验", Icon: Scale },
  { id: "process", label: "流程校验", Icon: GitBranch },
  { id: "lab", label: "错误注入", Icon: FlaskConical },
  { id: "gate", label: "写入闸门", Icon: DoorOpen },
];

/** 悬浮抽屉式侧栏：覆盖在内容上方，开合不改变内容区布局（不触发重排）。 */
export function Sidebar() {
  const { section, setSection, navOpen, setNavOpen, run, findings } = useStore();
  const openCount = findings.filter((f) => f.status === "open").length;

  return (
    <>
      {/* 背景遮罩：点击关闭 */}
      <div onClick={() => setNavOpen(false)}
        className={cn("fixed inset-0 z-40 bg-slate-900/15 transition-opacity",
          navOpen ? "opacity-100" : "pointer-events-none opacity-0")} />
      <aside className={cn(
        "fixed left-0 top-0 z-50 flex h-full w-[212px] flex-col border-r border-[var(--border)]",
        "bg-[var(--surface)] shadow-[var(--shadow-md)] transition-transform duration-200",
        navOpen ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-fg)] text-sm font-bold">✓</div>
          <div className="text-sm font-semibold leading-tight">知识校验<br />
            <span className="font-normal text-[var(--fg-subtle)]">Validation Studio</span></div>
          <button onClick={() => setNavOpen(false)} title="收起"
            className="ml-auto rounded p-1 text-[var(--fg-subtle)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]">
            <X size={16} />
          </button>
        </div>
        <nav className="flex flex-col gap-0.5 px-2 py-2">
          {NAV.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => { setSection(id); setNavOpen(false); }}
              className={cn("flex items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 text-sm transition-colors",
                section === id
                  ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                  : "text-[var(--fg-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]")}>
              <Icon size={16} className="shrink-0" />
              <span className="flex-1 text-left">{label}</span>
              {id === "inbox" && run && openCount > 0 && (
                <span className="rounded-full bg-[var(--fg-subtle)]/15 px-1.5 text-[11px] tabular-nums text-[var(--fg-muted)]">{openCount}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="mt-auto px-4 py-3 text-[11px] text-[var(--fg-subtle)]">
          确定性引擎 + LLM judge<br />混合校验 demo
        </div>
      </aside>
    </>
  );
}
