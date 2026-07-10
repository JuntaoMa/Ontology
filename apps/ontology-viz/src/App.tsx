import { OntologyVizApp } from "@ontology/viz/standalone";
import "@ontology/viz/styles";

const DEFAULT_ONTOLOGY_SOURCE = import.meta.env.VITE_ONTOLOGY_SOURCE_URL || undefined;

export default function App() {
  return <OntologyVizApp defaultSource={DEFAULT_ONTOLOGY_SOURCE} />;
}
