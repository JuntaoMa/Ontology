import { OntologyVizApp } from "@ontology/viz/standalone";
import "@ontology/viz/styles";

const DEFAULT_ONTOLOGY_SOURCE = import.meta.env.VITE_ONTOLOGY_SOURCE_URL || {
  url: `${import.meta.env.BASE_URL}npd-v2-ql.owl`,
  storageKey: "bundled:npd-v2-ql",
};

export default function App() {
  return <OntologyVizApp defaultSource={DEFAULT_ONTOLOGY_SOURCE} />;
}
