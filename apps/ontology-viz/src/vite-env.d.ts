/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ONTOLOGY_SOURCE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
