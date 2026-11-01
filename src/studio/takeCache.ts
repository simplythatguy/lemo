// IndexedDB for takes: kept recordings (never lost on reload, uploads resume) and teammates' takes
// downloaded for the render. One record per take; `takeId` is null until the server has created it.
import type { Cue } from "./types";

export interface CachedTake {
  /** Local key: a random id for a recording made here, the server take id for a download. */
  key: string;
  room: string;
  groupId: string;
  personId: string;
  takeId: string | null;
  blob: Blob;
  mime: string;
  cues: Cue[];
  durationMs: number;
  /** Chunks the server has acknowledged from this device. Equals the chunk count once uploaded. */
  sent: number;
  createdAt: number;
}

const DB = "batatis-studio";
const STORE = "takes";

let opening: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: "key" });
      store.createIndex("room", "room");
      store.createIndex("takeId", "takeId");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then((d) => new Promise<T>((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export const takeCache = {
  put: (take: CachedTake) => run("readwrite", (s) => s.put(take)).then(() => take),
  remove: (key: string) => run("readwrite", (s) => s.delete(key)).then(() => undefined),
  inRoom: (room: string) => run<CachedTake[]>("readonly", (s) => s.index("room").getAll(room)),
  byTakeId: (takeId: string) => run<CachedTake | undefined>("readonly", (s) => s.index("takeId").get(takeId)),
};
