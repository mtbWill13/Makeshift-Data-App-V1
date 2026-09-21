const ScoutOffline = (() => {
  const DATABASE_NAME = "makeshift-scouting-offline";
  const DATABASE_VERSION = 1;
  const QUEUE_STORE = "submission-queue";

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(QUEUE_STORE)) {
          request.result.createObjectStore(QUEUE_STORE, {
            keyPath: "id",
            autoIncrement: true
          });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function withStore(mode, callback) {
    const database = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(QUEUE_STORE, mode);
      const store = transaction.objectStore(QUEUE_STORE);
      const result = callback(store);

      transaction.oncomplete = () => {
        database.close();
        resolve(result);
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async function queueSubmission(submission) {
    return withStore("readwrite", store => {
      store.add({ ...submission, createdAt: Date.now() });
    });
  }

  async function queuedSubmissions(type) {
    const database = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(QUEUE_STORE, "readonly");
      const request = transaction.objectStore(QUEUE_STORE).getAll();

      request.onsuccess = () => {
        database.close();
        resolve(request.result.filter(item => item.type === type));
      };
      request.onerror = () => reject(request.error);
    });
  }

  async function removeSubmission(id) {
    return withStore("readwrite", store => {
      store.delete(id);
    });
  }

  function schemaKey(type, eventKey) {
    return `makeshift-schema-${type}-${eventKey}`;
  }

  function saveSchema(type, eventKey, schema) {
    localStorage.setItem(schemaKey(type, eventKey), JSON.stringify(schema));
  }

  function cachedSchema(type, eventKey) {
    try {
      return JSON.parse(localStorage.getItem(schemaKey(type, eventKey)) || "null");
    } catch {
      return null;
    }
  }

  async function sync(type, submit) {
    if (!navigator.onLine) {
      return { synced: 0, remaining: (await queuedSubmissions(type)).length };
    }

    let synced = 0;
    const submissions = await queuedSubmissions(type);

    for (const submission of submissions) {
      try {
        await submit(submission);
        await removeSubmission(submission.id);
        synced += 1;
      } catch (error) {
        /* Keep the item for a later retry. Authentication and permission
           failures are intentionally retained instead of losing scout data. */
        console.warn("Offline scouting sync will retry later:", error.message);
      }
    }

    return { synced, remaining: (await queuedSubmissions(type)).length };
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/offline-service-worker.js", { scope: "/" })
        .catch(error => console.warn("Offline cache could not be registered:", error));
    }
  }

  return {
    cachedSchema,
    queueSubmission,
    queuedSubmissions,
    registerServiceWorker,
    saveSchema,
    sync
  };
})();
