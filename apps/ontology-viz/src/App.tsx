import { OntologyVizApp } from "@ontology/viz/standalone";
import "@ontology/viz/styles";

const DEFAULT_ONTOLOGY_SOURCE = import.meta.env.VITE_ONTOLOGY_SOURCE_URL || {
  url: `${import.meta.env.BASE_URL}npd-v2-ql.owl`,
  storageKey: "bundled:npd-v2-ql:v4",
  initialLayout: {
    mode: "force-atlas2" as const,
    url: `${import.meta.env.BASE_URL}npd-v2-ql.force-atlas2.layout.json`,
  },
};

export default function App() {
  return <OntologyVizApp defaultSource={DEFAULT_ONTOLOGY_SOURCE} />;
}
