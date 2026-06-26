import type { ResourceType } from "../utils/types";

export function TypeBadge({ type }: { type: ResourceType | "Link" }) {
  return <span className={`type-badge type-badge--${type.toLowerCase()}`}>{type}</span>;
}
