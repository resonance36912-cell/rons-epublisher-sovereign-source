// Tiny IndexedDB wrapper to persist the last encoded MP4 so the
// "Re-download last video" card survives a full page reload.

const DB_NAME = "resonance-video-cache";
const STORE = "lastVideo";
const KEY = "current";
const DB_VERSION = 1;

export type PersistedVideo = {
  key: string;
  filename: string;
  blob: Blob;
  savedAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLastVideo(entry: Omit<PersistedVideo, "savedAt">): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ ...entry, savedAt: Date.now() } satisfies PersistedVideo, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn("[VideoCache] saveLastVideo failed:", err);
  }
}

export async function loadLastVideo(): Promise<PersistedVideo | null> {
  try {
    const db = await openDb();
    const result = await new Promise<PersistedVideo | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as PersistedVideo) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch (err) {
    console.warn("[VideoCache] loadLastVideo failed:", err);
    return null;
  }
}

export async function clearLastVideo(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn("[VideoCache] clearLastVideo failed:", err);
  }
}
