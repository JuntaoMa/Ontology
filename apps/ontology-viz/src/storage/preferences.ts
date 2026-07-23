import type { LayoutMode, LayoutSnapshot } from "../graph";

const PREFIX = "ontology-viz:preferences:";

export interface SourcePreferences {
  layoutMode?: LayoutMode;
  layoutSnapshot?: LayoutSnapshot;
}

export function readPreferences(sourceKey: string): SourcePreferences {
  try {
    const value = localStorage.getItem(`${PREFIX}${sourceKey}`);
    return value ? JSON.parse(value) as SourcePreferences : {};
  } catch {
    return {};
  }
}

export function writePreferences(sourceKey: string, value: SourcePreferences) {
  try {
    localStorage.setItem(`${PREFIX}${sourceKey}`, JSON.stringify(value));
  } catch (error) {
    console.warn("[OntologyViz] Unable to persist source preferences", error);
  }
}
