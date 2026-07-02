export type OntologyMappingKind = "class" | "subclass" | "dataProperty" | "objectProperty";

export interface OntologyMappingEntry {
  id: string;
  kind: OntologyMappingKind;
  abstraction: string;
  entityPrefix: string;
  entityName: string;
  targetSubject: string;
  targetPredicate: string;
  targetObject: string;
  target: string;
  sourceSql: string;
  sourceTables: string[];
  sourceColumns: string[];
  targetColumns: string[];
  condition?: string;
}

export interface OntologyMappingDataset {
  source: string;
  generatedFrom: string;
  mappingCount: number;
  totals: {
    byKind: Record<string, number>;
    byAbstraction: Record<string, number>;
    byTable: Record<string, number>;
  };
  entries: OntologyMappingEntry[];
}
