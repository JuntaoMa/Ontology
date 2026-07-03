import { useEffect, useState } from "react";
import {
  ConfigurableOntologyViewer,
  parseExplicitOntology,
  type ExplicitOntologyGraphData,
} from "@ontology/viz";

const NPD_ONTOLOGY_PATH = "/npd-ontology/npd-v2-ql.owl";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ExplicitOntologyGraphData };

export function NpdOwlExplorer() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(NPD_ONTOLOGY_PATH);
        if (!response.ok) {
          throw new Error(`Failed to fetch ${NPD_ONTOLOGY_PATH}: ${response.status}`);
        }
        const content = await response.text();
        const data = parseExplicitOntology(content, {
          baseIRI: "http://sws.ifi.uio.no/vocab/npd-v2",
          contentType: "application/rdf+xml",
          ontologyTitleFallback: "NPD ontology",
        });
        if (!cancelled) setLoadState({ status: "ready", data });
      } catch (error) {
        if (!cancelled) {
          setLoadState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadState.status === "loading") {
    return (
      <div className="npd-owl-state">
        <div className="app-loading__spinner" />
        <p>正在解析 NPD OWL 本体…</p>
      </div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div className="npd-owl-state">
        <h2>加载失败</h2>
        <p>{loadState.message}</p>
      </div>
    );
  }

  return <ConfigurableOntologyViewer data={loadState.data} />;
}
