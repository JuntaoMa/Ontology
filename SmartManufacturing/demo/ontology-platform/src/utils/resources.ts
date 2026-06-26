import type {
  ActionResource,
  DomainBundle,
  FunctionResource,
  LinkResource,
  ObjectResource,
  ResourceDraft,
  ResourceReference,
  ResourceType,
} from "./types";

export function resourceKey(type: ResourceType, id: string): string {
  return `${type}:${id}`;
}

export function draftKey(domainId: string, type: ResourceType, id: string): string {
  return `${domainId}:${resourceKey(type, id)}`;
}

export function getResourceByRef(bundle: DomainBundle, ref: ResourceReference) {
  const map = {
    Object: bundle.objects,
    Link: bundle.links,
    Function: bundle.functions,
    Action: bundle.actions,
  } as const;
  return map[ref.type].find((item) => item.id === ref.id) || null;
}

export function applyDraft<T extends ObjectResource | LinkResource | FunctionResource | ActionResource>(
  resource: T,
  draft: ResourceDraft | null | undefined,
): T {
  if (!draft?.metadata) {
    return resource;
  }

  const merged = {
    ...resource,
    ...draft.metadata,
  } as ObjectResource | LinkResource | FunctionResource | ActionResource;

  if ("capabilityBoundary" in resource) {
    (merged as FunctionResource | ActionResource).capabilityBoundary = {
      ...(resource.capabilityBoundary || { responsibleFor: [], notResponsibleFor: [] }),
      ...((draft.metadata.capabilityBoundary as Record<string, unknown>) || {}),
    } as FunctionResource["capabilityBoundary"];
  }

  return merged as T;
}

export function parseLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function joinLines(values: string[] = []): string {
  return values.join("\n");
}
