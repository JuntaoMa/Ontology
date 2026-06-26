import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DOMAIN_BUNDLES, getDomainBundle, getDomains } from "../data/domainBundles";
import { draftKey } from "../utils/resources";
import type { DomainBundle, DomainMeta, PlatformState, ResourceDraft, ResourceType } from "../utils/types";

const STORAGE_KEY = "ontology-platform.react-demo.state";

const DEFAULT_STATE: PlatformState = {
  currentDomainId: "manufacture-design-change",
  selectedResource: {
    type: "Object",
    id: "DesignChangeOrder",
  },
  drafts: {},
  recentCaseId: null,
};

interface PlatformContextValue {
  domains: DomainMeta[];
  bundles: DomainBundle[];
  state: PlatformState;
  currentBundle: DomainBundle;
  setCurrentDomain: (domainId: string) => void;
  selectResource: (type: ResourceType, id: string) => void;
  saveDraft: (domainId: string, type: ResourceType, id: string, draft: ResourceDraft) => void;
  clearDraft: (domainId: string, type: ResourceType, id: string) => void;
  getDraft: (domainId: string, type: ResourceType, id: string) => ResourceDraft | null;
  setRecentCaseId: (caseId: string | null) => void;
}

const PlatformContext = createContext<PlatformContextValue | null>(null);

function loadState(): PlatformState {
  if (typeof window === "undefined") {
    return DEFAULT_STATE;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_STATE;
    }
    return {
      ...DEFAULT_STATE,
      ...JSON.parse(raw),
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlatformState>(() => loadState());

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const currentBundle = getDomainBundle(state.currentDomainId);

  const value: PlatformContextValue = {
    domains: getDomains(),
    bundles: DOMAIN_BUNDLES,
    state,
    currentBundle,
    setCurrentDomain(domainId) {
      setState((previous) => ({
        ...previous,
        currentDomainId: domainId,
        selectedResource:
          previous.currentDomainId === domainId
            ? previous.selectedResource
            : {
                type: "Object",
                id: getDomainBundle(domainId).objects[0]?.id || previous.selectedResource.id,
              },
      }));
    },
    selectResource(type, id) {
      setState((previous) => ({
        ...previous,
        selectedResource: { type, id },
      }));
    },
    saveDraft(domainId, type, id, draft) {
      setState((previous) => ({
        ...previous,
        drafts: {
          ...previous.drafts,
          [draftKey(domainId, type, id)]: draft,
        },
      }));
    },
    clearDraft(domainId, type, id) {
      setState((previous) => {
        const nextDrafts = { ...previous.drafts };
        delete nextDrafts[draftKey(domainId, type, id)];
        return {
          ...previous,
          drafts: nextDrafts,
        };
      });
    },
    getDraft(domainId, type, id) {
      return state.drafts[draftKey(domainId, type, id)] || null;
    },
    setRecentCaseId(caseId) {
      setState((previous) => ({
        ...previous,
        recentCaseId: caseId,
      }));
    },
  };

  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

export function usePlatform() {
  const value = useContext(PlatformContext);
  if (!value) {
    throw new Error("usePlatform must be used within PlatformProvider");
  }
  return value;
}
