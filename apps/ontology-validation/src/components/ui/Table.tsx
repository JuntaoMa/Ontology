import type { HTMLAttributes, ThHTMLAttributes, TdHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Table({ className, ...p }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full border-collapse text-[13px]", className)} {...p} />;
}
export function Th({ className, ...p }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn(
    "border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-left",
    "font-semibold text-[var(--fg-muted)]", className)} {...p} />;
}
export function Td({ className, ...p }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b border-[var(--border)] px-3 py-2 align-top", className)} {...p} />;
}
