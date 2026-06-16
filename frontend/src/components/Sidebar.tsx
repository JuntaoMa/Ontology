import { useState } from "react";
import { LayoutDashboard, Inbox, Network, Scale, GitBranch, FlaskConical, DoorOpen,
         PanelLeftClose, PanelLeftOpen } from "lucide-react";
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

export function Sidebar() {
  const { section, setSection, run, findings } = useStore();
  const [collapsed, setCollapsed] = useState(false);
  const openCount = findings.filter((f) => f.status === "open").length;

  return (
    <aside className={cn("flex shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] transition-[width]",
      collapsed ? "w-[60px]" : "w-[200px]")}>
      <div className={cn("flex items-center py-4", collapsed ? "justify-center px-0" : "gap-2 px-4")}>
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-fg)] text-sm font-bold">✓</div>
        {!collapsed && (
          <div className="text-sm font-semibold leading-tight">知识校验<br />
            <span className="font-normal text-[var(--fg-subtle)]">Validation Studio</span></div>
        )}
      </div>

      <nav className="flex flex-col gap-0.5 px-2 py-2">
        {NAV.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setSection(id)} title={collapsed ? label : undefined}
            className={cn("flex items-center rounded-[var(--radius-sm)] py-2 text-sm transition-colors",
              collapsed ? "justify-center px-0" : "gap-2.5 px-3",
              section === id
                ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                : "text-[var(--fg-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]")}>
            <Icon size={16} className="shrink-0" />
            {!collapsed && <span className="flex-1 text-left">{label}</span>}
            {!collapsed && id === "inbox" && run && openCount > 0 && (
              <span className="rounded-full bg-[var(--fg-subtle)]/15 px-1.5 text-[11px] tabular-nums text-[var(--fg-muted)]">{openCount}</span>
            )}
          </button>
        ))}
      </nav>

      <button onClick={() => setCollapsed((v) => !v)} title={collapsed ? "展开" : "收起"}
        className={cn("mt-auto m-2 flex items-center rounded-[var(--radius-sm)] py-2 text-[var(--fg-subtle)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]",
          collapsed ? "justify-center px-0" : "gap-2 px-3")}>
        {collapsed ? <PanelLeftOpen size={16} /> : <><PanelLeftClose size={16} /><span className="text-xs">收起侧栏</span></>}
      </button>
    </aside>
  );
}
