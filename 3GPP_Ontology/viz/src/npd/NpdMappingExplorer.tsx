import { OntologyMappingExplorer } from "../mapping/OntologyMappingExplorer";
import { npdMappingData } from "./generatedMappingData";

export function NpdMappingExplorer() {
  return (
    <OntologyMappingExplorer
      dataset={npdMappingData}
      className="npd-map"
    />
  );
}
