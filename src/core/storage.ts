import type { JobState } from "../types";

const STORAGE_KEY = "binance-futures-exporter-job-v1";
const DB_NAME = "binance-futures-exporter";
const STORE_NAME = "state";
const STATE_ID = "latest";

interface KeyValueStore {
  get(): Promise<JobState | null>;
  set(value: JobState): Promise<void>;
  clear(): Promise<void>;
}

class LocalStorageStore implements KeyValueStore {
  async get(): Promise<JobState | null> {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as JobState;
    } catch {
      return null;
    }
  }

  async set(value: JobState): Promise<void> {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  }

  async clear(): Promise<void> {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

class IndexedDbStore implements KeyValueStore {
  private dbPromise: Promise<IDBDatabase>;

  constructor() {
    this.dbPromise = this.open();
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async get(): Promise<JobState | null> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(STATE_ID);

      request.onsuccess = () => resolve((request.result as JobState | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async set(value: JobState): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(value, STATE_ID);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async clear(): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(STATE_ID);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

function chooseStorage(): KeyValueStore {
  const local = new LocalStorageStore();

  if (typeof window !== "undefined" && "indexedDB" in window) {
    try {
      const idb = new IndexedDbStore();
      return {
        async get() {
          try {
            return await idb.get();
          } catch {
            return local.get();
          }
        },
        async set(value) {
          try {
            await idb.set(value);
          } catch {
            await local.set(value);
          }
        },
        async clear() {
          try {
            await idb.clear();
          } catch {
            await local.clear();
          }
        }
      };
    } catch {
      return local;
    }
  }

  return local;
}

export const storage: KeyValueStore = chooseStorage();
