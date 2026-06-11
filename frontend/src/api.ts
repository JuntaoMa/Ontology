export async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

export const SEV_COLOR: Record<string, string> = {
  violation: "#d4380d",
  warning: "#d48806",
  info: "#1677ff",
};

export const LAYER_NAME: Record<string, string> = {
  V0: "V0 结构",
  V1: "V1 Schema",
  V2: "V2 实例",
  V3: "V3 规则",
  V4: "V4 流程",
  V5: "V5 LLM Judge",
};

export function layerOf(validatorId: string): string {
  const m = validatorId.match(/^v(\d)/);
  return m ? `V${m[1]}` : "V0";
}
