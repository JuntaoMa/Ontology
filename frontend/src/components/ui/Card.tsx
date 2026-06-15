import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(
    "rounded-[var(--radius-app)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)]",
    className)} {...p} />;
}

export function CardHeader({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2">
      <div>
        <h3 className="text-[13px] font-semibold text-[var(--fg)]">{title}</h3>
        {sub && <p className="mt-0.5 text-xs text-[var(--fg-subtle)]">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function CardBody({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 pb-4", className)} {...p} />;
}

export function Stat({ label, value, sub, accent }: {
  label: ReactNode; value: ReactNode; sub?: ReactNode; accent?: string;
}) {
  return (
    <Card className="min-w-[160px] flex-1">
      <CardBody className="pt-3.5">
        <div className="text-xs font-medium text-[var(--fg-subtle)]">{label}</div>
        <div className="mt-1 text-2xl font-bold tabular-nums" style={accent ? { color: accent } : undefined}>
          {value}
        </div>
        {sub && <div className="mt-0.5 text-xs text-[var(--fg-subtle)]">{sub}</div>}
      </CardBody>
    </Card>
  );
}
