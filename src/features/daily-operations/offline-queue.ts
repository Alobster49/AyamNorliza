"use client";

import type { SyncOperationInput } from "./schema";

const DB_NAME = "ayam-norliza-daily-operations";
const STORE_NAME = "sync-operations";
const DB_VERSION = 1;

export type QueuedOperation = SyncOperationInput & {
  queuedAt: string;
  syncStatus: "queued" | "syncing" | "synced" | "conflicted" | "rejected";
};

export async function queueOperation(operation: SyncOperationInput): Promise<void> {
  const db = await openQueueDb();
  await put(db, { ...operation, queuedAt: new Date().toISOString(), syncStatus: "queued" });
  db.close();
}

export async function listQueuedOperations(): Promise<QueuedOperation[]> {
  const db = await openQueueDb();
  const operations = await getAll(db);
  db.close();
  return operations;
}

export async function markOperationSynced(clientOperationId: string): Promise<void> {
  const db = await openQueueDb();
  const operations = await getAll(db);
  const operation = operations.find((item) => item.clientOperationId === clientOperationId);
  if (operation) await put(db, { ...operation, syncStatus: "synced" });
  db.close();
}

function openQueueDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "clientOperationId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function put(db: IDBDatabase, operation: QueuedOperation): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(operation);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function getAll(db: IDBDatabase): Promise<QueuedOperation[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as QueuedOperation[]);
    request.onerror = () => reject(request.error);
  });
}
