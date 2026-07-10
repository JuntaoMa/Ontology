import { useId, useRef } from "react";

import type { RecentOntologyEntry } from "./recentOntologyStore";

export interface RecentOntologyMenuProps {
  entries: RecentOntologyEntry[];
  loadingId?: string;
  onOpen: (id: string) => void;
}

const absoluteTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function formatOpenedAt(openedAt: number) {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - openedAt) / 1000));
  if (elapsedSeconds < 60) return "刚刚";
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes} 分钟前`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} 小时前`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return `${elapsedDays} 天前`;
  return absoluteTimeFormatter.format(openedAt);
}

export function RecentOntologyMenu({ entries, loadingId, onOpen }: RecentOntologyMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = `ontology-viz-recent-${useId().replaceAll(":", "")}`;

  return (
    <div className="ontology-viz-recent">
      <button
        className="ontology-viz-recent__trigger"
        type="button"
        popoverTarget={panelId}
        disabled={entries.length === 0}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l2.5 1.5" />
        </svg>
        <span>最近打开</span>
      </button>
      <div
        ref={panelRef}
        id={panelId}
        className="ontology-viz-recent__panel"
        popover="auto"
      >
        {entries.map((entry) => (
          <button
            key={entry.id}
            className="ontology-viz-recent__item"
            type="button"
            disabled={loadingId === entry.id}
            title={entry.label}
            onClick={() => {
              panelRef.current?.hidePopover();
              onOpen(entry.id);
            }}
          >
            <span className="ontology-viz-recent__label">{entry.label}</span>
            <time
              dateTime={new Date(entry.openedAt).toISOString()}
              title={absoluteTimeFormatter.format(entry.openedAt)}
            >
              {formatOpenedAt(entry.openedAt)}
            </time>
          </button>
        ))}
      </div>
    </div>
  );
}
