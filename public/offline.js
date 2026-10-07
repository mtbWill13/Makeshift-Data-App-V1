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

  /*
    One QR code per report:  type|eventKey|timestamp|answer|answer|...
    Answer N is sheet column N (A, B, C...), trailing blank columns are
    dropped. "%" and "|" inside answers are escaped as %25 and %7C.
  */
  const QR_TYPES = ["match-scouting", "pit-scouting"];

  function escapeQrField(value) {
    return String(value ?? "").replace(/%/g, "%25").replace(/\|/g, "%7C");
  }

  function unescapeQrField(value) {
    return value.replace(/%(25|7C)/gi, code => code === "%25" ? "%" : "|");
  }

  /* Answers are part of the key so two reports saved in the same millisecond
     (e.g. by two scouts) are never mistaken for duplicates. */
  function reportKey(report) {
    const answers = Object.entries(report.answers || {})
      .filter(([, value]) => String(value ?? "") !== "")
      .sort(([left], [right]) => left.localeCompare(right));

    return `${report.type}|${report.eventKey}|${report.createdAt}|${JSON.stringify(answers)}`;
  }

  /* Match answers are keyed "column-N"; pit answers are keyed by header text. */
  function reportColumns(report, headers = []) {
    const columns = [];

    for (const [key, value] of Object.entries(report.answers || {})) {
      const columnMatch = /^column-(\d+)$/.exec(key);
      const index = columnMatch ? Number(columnMatch[1]) : headers.indexOf(key);

      if (index >= 0) {
        columns[index] = String(value ?? "");
      } else if (String(value ?? "").trim()) {
        throw new Error(`"${key}" is not in the cached sheet header row. Open the form online once, then try again.`);
      }
    }

    const flattened = Array.from(columns, value => value ?? "");

    while (flattened.length && flattened[flattened.length - 1] === "") {
      flattened.pop();
    }

    return flattened;
  }

  function encodeReportQr(report, headers = []) {
    return [report.type, report.eventKey, report.createdAt, ...reportColumns(report, headers)]
      .map(escapeQrField)
      .join("|");
  }

  function decodeReportQr(text) {
    const [type, eventKey, timestamp, ...columns] = String(text).split("|").map(unescapeQrField);

    if (!QR_TYPES.includes(type) || !/^\d{4}[a-z0-9]+$/i.test(eventKey ?? "") || !/^\d+$/.test(timestamp ?? "")) {
      return null;
    }

    const answers = {};
    columns.forEach((value, index) => {
      if (value !== "") answers[`column-${index}`] = value;
    });

    return { type, eventKey, createdAt: Number(timestamp), answers };
  }

  /* Store a received report once, however many times its QR code is scanned. */
  async function importReport(report) {
    const key = reportKey(report);
    const existing = await queuedSubmissions(report.type, true);

    if (existing.some(item => item.transferKey === key)) {
      return false;
    }

    await queueSubmission({ ...report, transferOnly: true, transferKey: key });
    return true;
  }

  async function createTransferPackage(type, eventKey) {
    const reports = (await queuedSubmissions(type, true))
      .filter(report => report.eventKey === eventKey)
      .map(({ submissionToken, id, transferOnly, transferKey, ...report }) => report);

		if (!reports.length) {
			throw new Error("There are no saved reports for this event to transfer.");
		}

		console.log(reports);

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

    const reports = transferPackage.reports.map(report => ({
      ...report,
      type: report.type ?? transferPackage.type,
      eventKey: report.eventKey ?? transferPackage.eventKey
    }));
    let imported = 0;

    for (const report of reports) {
      if (await importReport(report)) imported += 1;
    }

		if (transferPackage.schema) {
			saveSchema(transferPackage.type, transferPackage.eventKey, transferPackage.schema);
		}

    return { imported, reports };
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
    createTransferPackage,
    decodeReportQr,
    encodeReportQr,
    importReport,
    importTransferPackage,
    queueSubmission,
    queuedSubmissions,
    registerServiceWorker,
    reportKey,
    saveSchema,
    sync
  };
})();
