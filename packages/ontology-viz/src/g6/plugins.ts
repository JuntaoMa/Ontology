import type { GraphOptions } from "@antv/g6";

export function createG6StandalonePlugins(): NonNullable<GraphOptions["plugins"]> {
  return [
    {
      type: "minimap",
      key: "ontology-minimap",
      size: [180, 120],
      padding: 8,
      position: "right-bottom",
      delay: 128,
    },
  ];
}
