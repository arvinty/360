import type { Coord, RoomData, Scenario } from "./types";

const DB_NAME = "frozen_moment_cache";
const DB_VERSION = 1;
const RUNS_STORE = "runs";
const ROOMS_STORE = "rooms";
const MAX_RUNS = 5;

export type CachedRunMeta = {
  seed: string;
  worldPrompt: string;
  savedAt: number;
  startCoord: Coord;
  destinationCoord: Coord;
  scenario: Scenario;
  coordToCatalogIndex: Record<string, number>;
  catalogSize: number;
  /** 0..1, how complete this cached run is */
  roomsCached: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(RUNS_STORE)) {
        const store = db.createObjectStore(RUNS_STORE, { keyPath: "seed" });
        store.createIndex("savedAt", "savedAt");
      }
      if (!db.objectStoreNames.contains(ROOMS_STORE)) {
        // composite key: `${seed}:${catalogIndex}`
        db.createObjectStore(ROOMS_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db: IDBDatabase, stores: string[], mode: IDBTransactionMode) {
  const t = db.transaction(stores, mode);
  return {
    t,
    done: new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }),
  };
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listCachedRuns(): Promise<CachedRunMeta[]> {
  try {
    const db = await openDB();
    const { t } = tx(db, [RUNS_STORE], "readonly");
    const store = t.objectStore(RUNS_STORE);
    const all = await reqToPromise(store.getAll() as IDBRequest<CachedRunMeta[]>);
    return all.sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_RUNS);
  } catch {
    return [];
  }
}

/** Save the run's metadata and all its prebuilt rooms; trim to MAX_RUNS most recent. */
export async function saveCachedRun(
  meta: Omit<CachedRunMeta, "savedAt" | "roomsCached">,
  rooms: Record<number, RoomData>
): Promise<void> {
  try {
    const db = await openDB();
    const total = meta.catalogSize || Object.keys(meta.coordToCatalogIndex).length;
    const cached = Object.keys(rooms).length;
    const fullMeta: CachedRunMeta = {
      ...meta,
      savedAt: Date.now(),
      roomsCached: total > 0 ? cached / total : 0,
    };

    const { t, done } = tx(db, [RUNS_STORE, ROOMS_STORE], "readwrite");
    t.objectStore(RUNS_STORE).put(fullMeta);
    const roomsStore = t.objectStore(ROOMS_STORE);
    for (const [idx, room] of Object.entries(rooms)) {
      roomsStore.put(room, `${meta.seed}:${idx}`);
    }
    await done;

    await trimToMaxRuns();
  } catch (err) {
    console.warn("saveCachedRun failed:", err);
  }
}

export async function loadCachedRun(
  seed: string
): Promise<{ meta: CachedRunMeta; rooms: Record<number, RoomData> } | null> {
  try {
    const db = await openDB();
    const { t } = tx(db, [RUNS_STORE, ROOMS_STORE], "readonly");
    const meta = await reqToPromise(
      t.objectStore(RUNS_STORE).get(seed) as IDBRequest<CachedRunMeta | undefined>
    );
    if (!meta) return null;
    const roomsStore = t.objectStore(ROOMS_STORE);
    const indices = Object.values(meta.coordToCatalogIndex);
    const rooms: Record<number, RoomData> = {};
    for (const idx of indices) {
      const room = await reqToPromise(
        roomsStore.get(`${seed}:${idx}`) as IDBRequest<RoomData | undefined>
      );
      if (room) rooms[idx] = room;
    }
    return { meta, rooms };
  } catch (err) {
    console.warn("loadCachedRun failed:", err);
    return null;
  }
}

export async function deleteCachedRun(seed: string): Promise<void> {
  try {
    const db = await openDB();
    const { t, done } = tx(db, [RUNS_STORE, ROOMS_STORE], "readwrite");
    const meta = await reqToPromise(
      t.objectStore(RUNS_STORE).get(seed) as IDBRequest<CachedRunMeta | undefined>
    );
    t.objectStore(RUNS_STORE).delete(seed);
    if (meta) {
      const roomsStore = t.objectStore(ROOMS_STORE);
      for (const idx of Object.values(meta.coordToCatalogIndex)) {
        roomsStore.delete(`${seed}:${idx}`);
      }
    }
    await done;
  } catch (err) {
    console.warn("deleteCachedRun failed:", err);
  }
}

async function trimToMaxRuns(): Promise<void> {
  const all = await listCachedRunsAll();
  if (all.length <= MAX_RUNS) return;
  const toDelete = all.slice(MAX_RUNS);
  for (const m of toDelete) await deleteCachedRun(m.seed);
}

async function listCachedRunsAll(): Promise<CachedRunMeta[]> {
  const db = await openDB();
  const { t } = tx(db, [RUNS_STORE], "readonly");
  const store = t.objectStore(RUNS_STORE);
  const all = await reqToPromise(store.getAll() as IDBRequest<CachedRunMeta[]>);
  return all.sort((a, b) => b.savedAt - a.savedAt);
}
