const DATABASE_NAME = 'themarble-earth-state';
const STORE_NAME = 'verified-remote-bundles';

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('Earth-state storage request failed')), { once: true });
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('Earth-state storage transaction aborted')), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('Earth-state storage transaction failed')), { once: true });
  });
}

async function openDatabase() {
  const request = indexedDB.open(DATABASE_NAME, 1);
  request.addEventListener('upgradeneeded', () => {
    if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
  });
  return requestResult(request);
}

export function createIndexedDbEarthStateStorage() {
  const database = openDatabase();

  return {
    async get(key) {
      const db = await database;
      const transaction = db.transaction(STORE_NAME, 'readonly');
      return requestResult(transaction.objectStore(STORE_NAME).get(key));
    },

    async commit({ writes, deletes }) {
      const db = await database;
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const completed = transactionComplete(transaction);
      const store = transaction.objectStore(STORE_NAME);
      try {
        for (const { key, value } of writes) store.put(value, key);
        for (const key of deletes) store.delete(key);
      } catch (error) {
        transaction.abort();
        try {
          await completed;
        } catch {
          // Preserve the synchronous storage error that caused the abort.
        }
        throw error;
      }
      await completed;
    },
  };
}
