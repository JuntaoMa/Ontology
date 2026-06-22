import { useState } from "react";
import { LayoutDashboard, Inbox, Network, Scale, GitBranch, FlaskConical, DoorOpen,
         BookOpen, PanelLeftClose, PanelLeftOpen } from "lucide-react";
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
  { id: "about", label: "关于设计", Icon: BookOpen },
];

/** claude.ai 风格常驻侧栏：收起=窄图标列，展开=完整。内容区在流内，自动重排。 */
export function Sidebar() {
  const { section, setSection, run, findings } = useStore();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("nav-collapsed") === "1");
  const openCount = findings.filter((f) => f.status === "open").length;

  const toggle = () => setCollapsed((v) => {
    localStorage.setItem("nav-collapsed", v ? "0" : "1");
    return !v;
  });

  return (
    <aside className={cn(
      "flex shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] transition-[width] duration-200",
      collapsed ? "w-[56px]" : "w-[212px]")}>
      {/* 顶部：品牌 + 折叠开关 */}
      <div className={cn("flex h-[57px] items-center border-b border-[var(--border)]",
        collapsed ? "justify-center px-0" : "gap-2 px-3")}>
        {!collapsed && (
          <>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-fg)] text-sm font-bold">✓</div>
            <div className="text-[13px] font-semibold leading-tight">知识校验<br />
              <span className="font-normal text-[var(--fg-subtle)]">Validation Studio</span></div>
          </>
        )}
        <button onClick={toggle} title={collapsed ? "展开侧栏" : "收起侧栏"}
          className={cn("rounded-[var(--radius-sm)] p-1.5 text-[var(--fg-subtle)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]",
            !collapsed && "ml-auto")}>
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      <nav className="flex flex-col gap-0.5 p-2">
        {NAV.map(({ id, label, Icon }) => {
          const active = section === id;
          return (
            <button key={id} onClick={() => setSection(id)} title={collapsed ? label : undefined}
              className={cn("group relative flex items-center rounded-[var(--radius-sm)] text-sm transition-colors",
                collapsed ? "h-10 justify-center" : "gap-2.5 px-3 py-2",
                active
                  ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                  : "text-[var(--fg-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]")}>
              <Icon size={17} className="shrink-0" />
              {!collapsed && <span className="flex-1 text-left">{label}</span>}
              {id === "inbox" && run && openCount > 0 && (
                collapsed ? (
                  <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                ) : (
                  <span className="rounded-full bg-[var(--fg-subtle)]/15 px-1.5 text-[11px] tabular-nums text-[var(--fg-muted)]">{openCount}</span>
                )
              )}
            </button>
          );
        })}
      </nav>

      {!collapsed && (
        <div className="mt-auto px-4 py-3 text-[11px] text-[var(--fg-subtle)]">
          确定性引擎 + LLM judge<br />混合校验 demo
        </div>
      )}
    </aside>
  );
}
