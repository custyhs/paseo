import type { CheckpointStorage } from "./checkpoint";

/**
 * IndexedDB, not AsyncStorage. On web AsyncStorage is localStorage, whose
 * writes are synchronous and on the main thread — and a checkpoint is written
 * on every keystroke, so that would be felt as typing lag. Upstream's replica
 * cache reaches for IndexedDB on web for the same reason.
 */

const DATABASE_NAME = "paseo-draft-checkpoints";
const STORE_NAME = "key-value";

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  databasePromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("Failed to open draft checkpoints")),
    );
    request.addEventListener("blocked", () =>
      reject(new Error("Draft checkpoint database upgrade was blocked")),
    );
  });
  return databasePromise;
}

async function getItem(key: string): Promise<string | null> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
    request.addEventListener("success", () =>
      resolve(typeof request.result === "string" ? request.result : null),
    );
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("Failed to read draft checkpoints")),
    );
  });
}

async function setItem(key: string, value: string): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(value, key);
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", () =>
      reject(transaction.error ?? new Error("Failed to write draft checkpoints")),
    );
    transaction.addEventListener("abort", () =>
      reject(transaction.error ?? new Error("Draft checkpoint write was aborted")),
    );
  });
}

export const draftCheckpointStorage: CheckpointStorage = { getItem, setItem };
