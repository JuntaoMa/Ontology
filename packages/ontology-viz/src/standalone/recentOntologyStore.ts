import type { OntologyParseOptions } from "../core";

export type RecentOntologyKind = "url" | "file";

export interface RecentOntologyEntry {
  id: string;
  label: string;
  kind: RecentOntologyKind;
  openedAt: number;
}

export interface RecentOntologyUrlSource {
  url: string;
  storageKey?: string;
  parseOptions?: OntologyParseOptions;
}

export type RecentOntologyDocument =
  | {
      kind: "url";
      entry: RecentOntologyEntry;
      source: RecentOntologyUrlSource;
    }
  | {
      kind: "file";
      entry: RecentOntologyEntry;
      content: string;
      parseOptions?: OntologyParseOptions;
    };

interface StoredRecentOntology extends RecentOntologyEntry {
  source?: RecentOntologyUrlSource;
  parseOptions?: OntologyParseOptions;
}

interface StoredFileContent {
  id: string;
  content: string;
}

const RECENT_STORAGE_KEY = "ontology-viz:recent:v1";
const RECENT_LIMIT = 8;
const FILE_DATABASE_NAME = "ontology-viz";
const FILE_DATABASE_VERSION = 1;
const FILE_STORE_NAME = "recent-files";

function getLocalStorage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function normalizeParseOptions(value: unknown): OntologyParseOptions | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const options: OntologyParseOptions = {};

  if (typeof record.baseIRI === "string") options.baseIRI = record.baseIRI;
  if (record.contentType === "application/rdf+xml" || record.contentType === "text/turtle") {
    options.contentType = record.contentType;
  }
  if (typeof record.ontologyTitleFallback === "string") {
    options.ontologyTitleFallback = record.ontologyTitleFallback;
  }

  return options;
}

function normalizeStoredEntry(value: unknown): StoredRecentOntology | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string"
    || typeof record.label !== "string"
    || (record.kind !== "url" && record.kind !== "file")
    || typeof record.openedAt !== "number"
  ) {
    return undefined;
  }

  const entry: StoredRecentOntology = {
    id: record.id,
    label: record.label,
    kind: record.kind,
    openedAt: record.openedAt,
  };

  if (record.kind === "url" && record.source && typeof record.source === "object") {
    const source = record.source as Record<string, unknown>;
    if (typeof source.url === "string") {
      entry.source = {
        url: source.url,
        storageKey: typeof source.storageKey === "string" ? source.storageKey : undefined,
        parseOptions: normalizeParseOptions(source.parseOptions),
      };
    }
  }
  if (record.kind === "file") {
    entry.parseOptions = normalizeParseOptions(record.parseOptions);
  }

  return entry.kind === "file" || entry.source ? entry : undefined;
}

function readStoredEntries() {
  const storage = getLocalStorage();
  if (!storage) return [];

  try {
    const value = JSON.parse(storage.getItem(RECENT_STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .map(normalizeStoredEntry)
      .filter((entry): entry is StoredRecentOntology => Boolean(entry))
      .sort((left, right) => right.openedAt - left.openedAt)
      .slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

function writeStoredEntries(entries: StoredRecentOntology[]) {
  const storage = getLocalStorage();
  if (!storage) return false;

  try {
    storage.setItem(RECENT_STORAGE_KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

function upsertStoredEntry(entry: StoredRecentOntology) {
  const previous = readStoredEntries();
  const entries = [entry, ...previous.filter((item) => item.id !== entry.id)]
    .sort((left, right) => right.openedAt - left.openedAt);
  const removedFileIds = entries
    .slice(RECENT_LIMIT)
    .filter((item) => item.kind === "file")
    .map((item) => item.id);

  return {
    saved: writeStoredEntries(entries.slice(0, RECENT_LIMIT)),
    removedFileIds,
  };
}

function removeStoredEntry(id: string) {
  const entries = readStoredEntries();
  writeStoredEntries(entries.filter((entry) => entry.id !== id));
}

function openFileDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }

    const request = indexedDB.open(FILE_DATABASE_NAME, FILE_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(FILE_STORE_NAME)) {
        request.result.createObjectStore(FILE_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
    request.onblocked = () => reject(new Error("IndexedDB upgrade is blocked"));
  });
}

function waitForTransaction(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

async function saveFileContent(id: string, content: string) {
  let database: IDBDatabase | undefined;
  try {
    database = await openFileDatabase();
    const transaction = database.transaction(FILE_STORE_NAME, "readwrite");
    transaction.objectStore(FILE_STORE_NAME).put({ id, content } satisfies StoredFileContent);
    await waitForTransaction(transaction);
    return true;
  } catch {
    return false;
  } finally {
    database?.close();
  }
}

async function readFileContent(id: string) {
  let database: IDBDatabase | undefined;
  try {
    database = await openFileDatabase();
    const transaction = database.transaction(FILE_STORE_NAME, "readonly");
    const request = transaction.objectStore(FILE_STORE_NAME).get(id);
    const result = await new Promise<StoredFileContent | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as StoredFileContent | undefined);
      request.onerror = () => reject(request.error ?? new Error("Failed to read IndexedDB"));
    });
    await waitForTransaction(transaction);
    return result?.content;
  } catch {
    return undefined;
  } finally {
    database?.close();
  }
}

async function deleteFileContent(id: string) {
  let database: IDBDatabase | undefined;
  try {
    database = await openFileDatabase();
    const transaction = database.transaction(FILE_STORE_NAME, "readwrite");
    transaction.objectStore(FILE_STORE_NAME).delete(id);
    await waitForTransaction(transaction);
  } catch {
    // Cleanup failure must not affect the current ontology session.
  } finally {
    database?.close();
  }
}

export function listRecentOntologies(): RecentOntologyEntry[] {
  return readStoredEntries().map(({ id, label, kind, openedAt }) => ({ id, label, kind, openedAt }));
}

export function rememberRecentUrl(
  id: string,
  label: string,
  source: RecentOntologyUrlSource,
) {
  const { removedFileIds } = upsertStoredEntry({
    id,
    label,
    kind: "url",
    openedAt: Date.now(),
    source,
  });
  for (const removedId of removedFileIds) void deleteFileContent(removedId);
}

export async function rememberRecentFile(
  id: string,
  label: string,
  content: string,
  parseOptions?: OntologyParseOptions,
) {
  if (!await saveFileContent(id, content)) return false;

  const { saved, removedFileIds } = upsertStoredEntry({
    id,
    label,
    kind: "file",
    openedAt: Date.now(),
    parseOptions,
  });
  if (!saved) {
    await deleteFileContent(id);
    return false;
  }

  for (const removedId of removedFileIds) void deleteFileContent(removedId);
  return true;
}

export async function loadRecentOntology(id: string): Promise<RecentOntologyDocument | undefined> {
  const stored = readStoredEntries().find((entry) => entry.id === id);
  if (!stored) return undefined;

  const entry: RecentOntologyEntry = {
    id: stored.id,
    label: stored.label,
    kind: stored.kind,
    openedAt: stored.openedAt,
  };
  if (stored.kind === "url" && stored.source) {
    return { kind: "url", entry, source: stored.source };
  }

  const content = await readFileContent(id);
  if (content === undefined) {
    removeStoredEntry(id);
    return undefined;
  }
  return { kind: "file", entry, content, parseOptions: stored.parseOptions };
}

export function touchRecentOntology(id: string, label: string) {
  const stored = readStoredEntries().find((entry) => entry.id === id);
  if (!stored) return;
  upsertStoredEntry({ ...stored, label, openedAt: Date.now() });
}
