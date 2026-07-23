const DATABASE_NAME = "ontology-viz";
const STORE_NAME = "sources";
const DATABASE_VERSION = 1;
const RECENT_LIMIT = 8;

export interface StoredSource {
  key: string;
  name: string;
  path: string;
  text: string;
  openedAt: number;
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = action(transaction.objectStore(STORE_NAME));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function listRecentSources() {
  const values = await withStore<StoredSource[]>("readonly", (store) => store.getAll());
  return values.sort((left, right) => right.openedAt - left.openedAt).slice(0, RECENT_LIMIT);
}

export async function readRecentSource(key: string) {
  return withStore<StoredSource | undefined>("readonly", (store) => store.get(key));
}

export async function saveRecentSource(source: StoredSource) {
  await withStore<IDBValidKey>("readwrite", (store) => store.put(source));
  const values = await listRecentSources();
  const keep = new Set(values.slice(0, RECENT_LIMIT).map((item) => item.key));
  const all = await withStore<StoredSource[]>("readonly", (store) => store.getAll());
  await Promise.all(
    all.filter((item) => !keep.has(item.key)).map((item) => (
      withStore<undefined>("readwrite", (store) => store.delete(item.key))
    )),
  );
}
