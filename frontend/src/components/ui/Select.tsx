import type { SelectHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Select({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(
      "h-9 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)]",
      "px-2.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2",
      "focus-visible:ring-[var(--accent)]/40", className)} {...p} />
  );
}
