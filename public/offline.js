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

  async function queuedSubmissions(type, includeTransferOnly = false) {
    const database = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(QUEUE_STORE, "readonly");
      const request = transaction.objectStore(QUEUE_STORE).getAll();

      request.onsuccess = () => {
        database.close();
        resolve(request.result.filter(item =>
          item.type === type && (includeTransferOnly || !item.transferOnly)
        ));
      };
      request.onerror = () => reject(request.error);
    });
  }

  async function removeSubmission(id) {
    return withStore("readwrite", store => {
      store.delete(id);
    });
  }

  function transferId() {
    return globalThis.crypto?.randomUUID?.() ||
      `transfer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function checksum(value) {
    let hash = 2166136261;

    for (const character of String(value)) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(36);
  }

  function bytesToBase64(bytes) {
    let binary = "";

    for (let index = 0; index < bytes.length; index += 8192) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
    }

    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  }

  async function encodeTransferPackage(transferPackage) {
    const bytes = new TextEncoder().encode(JSON.stringify(transferPackage));

    if ("CompressionStream" in window) {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
      return `G${bytesToBase64(new Uint8Array(await new Response(stream).arrayBuffer()))}`;
    }

    return `J${bytesToBase64(bytes)}`;
  }

  async function decodeTransferPackage(payload) {
    const encoding = payload.slice(0, 1);
    let bytes = base64ToBytes(payload.slice(1));

    if (encoding === "G") {
      if (!("DecompressionStream" in window)) {
        throw new Error("This browser cannot open compressed scouting transfers.");
      }

      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    } else if (encoding !== "J") {
      throw new Error("This is not a MakeShift scouting transfer.");
    }

    return JSON.parse(new TextDecoder().decode(bytes));
  }

  async function createTransferPackage(type, eventKey) {
    const reports = (await queuedSubmissions(type, true))
      .filter(report => report.eventKey === eventKey)
      .map(({ submissionToken, id, transferOnly, ...report }) => report);

    if (!reports.length) {
      throw new Error("There are no saved reports for this event to transfer.");
    }

    return {
      format: "makeshift-scouting-transfer",
      version: 1,
      transferId: transferId(),
      createdAt: new Date().toISOString(),
      type,
      eventKey,
      schema: cachedSchema(type, eventKey),
      reports
    };
  }

  async function importTransferPackage(transferPackage) {
    if (transferPackage?.format !== "makeshift-scouting-transfer" ||
        transferPackage.version !== 1 ||
        !Array.isArray(transferPackage.reports)) {
      throw new Error("This backup file is not a supported scouting transfer.");
    }

    const existing = await queuedSubmissions(transferPackage.type, true);
    const alreadyImported = new Set(existing.map(report => report.transferKey).filter(Boolean));
    let imported = 0;

    if (!alreadyImported.has(transferPackage.transferId)) {
      for (const report of transferPackage.reports) {
        await queueSubmission({
          ...report,
          type: transferPackage.type,
          eventKey: transferPackage.eventKey,
          transferOnly: true,
          transferKey: transferPackage.transferId
        });
        imported += 1;
      }
    }

    if (transferPackage.schema) {
      saveSchema(transferPackage.type, transferPackage.eventKey, transferPackage.schema);
    }

    return { imported, duplicate: alreadyImported.has(transferPackage.transferId) };
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
    checksum,
    createTransferPackage,
    decodeTransferPackage,
    encodeTransferPackage,
    importTransferPackage,
    queueSubmission,
    queuedSubmissions,
    registerServiceWorker,
    saveSchema,
    sync
  };
})();
