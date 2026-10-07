// Supabase mirror
//
// Google Sheets stays the primary store: every page reads from Sheets and every
// submission is written to Sheets first. This module copies the scouting sheets
// into Supabase as well, so the data is backed up somewhere other people (and
// other tools) can query.
//
// How it works
// - After a successful submission, and every 10 minutes, each event's match and
//   pit scouting sheets are read and upserted into Supabase. That also picks up
//   rows typed straight into the sheet, and backfills everything on first run.
// - Rows are identified by a hash of their contents, so nothing is ever
//   overwritten or deleted: an edited row is stored as a new row, and rows that
//   disappear from the sheet are kept with in_sheet = false.
//
// Safety: this must never affect the rest of the app. Every function here
// catches its own errors and nothing awaits it in a request. If Supabase isn't
// configured (or still has placeholder keys) it does nothing; if the keys are
// wrong or it can't connect, it logs once and backs off before trying again.
//
// Setup: run supabase/schema.sql in the Supabase SQL editor, then set
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env and restart the server.

import { createHash } from "crypto";

const SYNC_INTERVAL_MS = 10 * 60 * 1000;
const SUBMIT_SYNC_DELAY_MS = 5 * 1000;   // batch submissions that arrive together
const FIRST_SYNC_DELAY_MS = 30 * 1000;   // let the server finish starting first
const REQUEST_TIMEOUT_MS = 10 * 1000;
const UPSERT_BATCH = 500;

// After a failure, wait before talking to Supabase again.
const BACKOFF_CONFIG_ERROR_MS = 10 * 60 * 1000; // bad key, missing table: needs a fix
const BACKOFF_NETWORK_ERROR_MS = 2 * 60 * 1000; // offline at an event, timeouts

const TABLES = {
	match: "scouting_reports",
	pit: "pit_scouting_reports"
};

const PLACEHOLDER = /your[-_]|placeholder|example|xxxx|changeme|^<|>$/i;

/* Supabase is only used when both values look real. */
function configFrom(url, key) {
	const cleanUrl = String(url ?? "").trim().replace(/\/+$/, "");
	const cleanKey = String(key ?? "").trim();

	if (!cleanUrl || !cleanKey || PLACEHOLDER.test(cleanUrl) || PLACEHOLDER.test(cleanKey)) {
		return null;
	}

	try {
		const parsed = new URL(cleanUrl);
		if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") return null;
	} catch {
		return null;
	}

	return { url: cleanUrl, key: cleanKey };
}

function numberOrNull(value) {
	const match = String(value ?? "").match(/\d+/);
	return match ? Number(match[0]) : null;
}

/* Sheet values ([headers, ...rows]) → one record per non-empty row. */
function recordsFromSheet(values, kind, eventKey) {
	const [headers = [], ...rows] = Array.isArray(values) ? values : [];
	const records = [];

	rows.forEach((row, index) => {
		if (!row.some(cell => String(cell ?? "").trim() !== "")) return;

		const data = Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ""]));
		const team = kind === "pit"
			? data["Team Number of Team Being Scouted"] ?? data["Team Number"]
			: data["Team Number"];

		// Same contents → same id, so re-syncing never duplicates a row.
		const id = createHash("sha256")
			.update(JSON.stringify([kind, eventKey, headers, row]))
			.digest("hex");

		records.push({
			id,
			event_key: eventKey,
			row_number: index + 2, // sheet row (row 1 is the headers)
			team_number: numberOrNull(team),
			...(kind === "match" ? { match_number: numberOrNull(data["Match Number"]) } : {}),
			data
		});
	});

	return records;
}

export function createSupabaseMirror({ url, key, eventKeys, loadSheet }) {
	const config = configFrom(url, key);

	const status = {
		enabled: Boolean(config),
		lastSuccessAt: null,
		lastError: null,
		lastErrorAt: null,
		pausedUntil: null,
		events: {}   // eventKey → { rows, at } from the last successful sync
	};

	const pending = new Map();   // eventKey → timer for a submission-triggered sync
	const running = new Set();   // events currently syncing
	const rerun = new Set();     // events that need another sync when the current one ends
	let interval = null;

	function paused() {
		return status.pausedUntil && Date.now() < status.pausedUntil;
	}

	function fail(message, backoffMs) {
		// Only log when the error changes, so a long outage doesn't flood the log.
		if (message !== status.lastError) {
			console.warn(`Supabase mirror: ${message} Pausing for ${Math.round(backoffMs / 60000)} min; Google Sheets is unaffected.`);
		}
		status.lastError = message;
		status.lastErrorAt = new Date().toISOString();
		status.pausedUntil = Date.now() + backoffMs;
	}

	/* One REST call to Supabase. Throws a tagged error that sync() turns into a backoff. */
	async function request(path, { method = "GET", body, prefer } = {}) {
		let response;

		try {
			response = await fetch(`${config.url}/rest/v1/${path}`, {
				method,
				headers: {
					apikey: config.key,
					// Classic service_role keys are JWTs ("eyJ…") and also go in Authorization;
					// newer sb_secret_… keys must only be sent as apikey.
					...(config.key.startsWith("eyJ") ? { Authorization: `Bearer ${config.key}` } : {}),
					"Content-Type": "application/json",
					...(prefer ? { Prefer: prefer } : {})
				},
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
			});
		} catch (error) {
			const wrapped = new Error(`can't reach ${config.url} (${error.name === "TimeoutError" ? "timed out" : error.message}).`);
			wrapped.backoff = BACKOFF_NETWORK_ERROR_MS;
			throw wrapped;
		}

		if (response.ok) return;

		const detail = await response.text().catch(() => "");
		const error = new Error(
			response.status === 401 || response.status === 403
				? `Supabase rejected the API key (${response.status}). Check SUPABASE_SERVICE_ROLE_KEY in .env.`
				: response.status === 404 || /does not exist|schema cache/i.test(detail)
					? `table missing (${response.status}). Run supabase/schema.sql in the Supabase SQL editor.`
					: `request failed (${response.status}): ${detail.slice(0, 200)}`
		);
		error.backoff = response.status >= 500 ? BACKOFF_NETWORK_ERROR_MS : BACKOFF_CONFIG_ERROR_MS;
		throw error;
	}

	async function syncSheet(eventKey, kind, syncStartedAt) {
		let values;

		try {
			values = await loadSheet(eventKey, kind);
		} catch {
			return 0; // No sheet (e.g. an event without pit scouting): nothing to mirror.
		}

		const table = TABLES[kind];
		const seenAt = new Date().toISOString();
		// Identical rows (e.g. a double submission) share an id; Postgres rejects an
		// upsert that touches the same row twice, so send each id once.
		const records = [...new Map(
			recordsFromSheet(values, kind, eventKey).map(record => [record.id, { ...record, in_sheet: true, last_seen_at: seenAt }])
		).values()];

		for (let start = 0; start < records.length; start += UPSERT_BATCH) {
			await request(`${table}?on_conflict=id`, {
				method: "POST",
				body: records.slice(start, start + UPSERT_BATCH),
				prefer: "resolution=merge-duplicates,return=minimal"
			});
		}

		// Rows no longer in the sheet are kept, just flagged.
		await request(
			`${table}?event_key=eq.${encodeURIComponent(eventKey)}&in_sheet=eq.true&last_seen_at=lt.${encodeURIComponent(syncStartedAt)}`,
			{ method: "PATCH", body: { in_sheet: false }, prefer: "return=minimal" }
		);

		return records.length;
	}

	async function sync(eventKey) {
		if (!config || paused()) return;

		if (running.has(eventKey)) {
			rerun.add(eventKey);
			return;
		}

		running.add(eventKey);

		try {
			const syncStartedAt = new Date().toISOString();
			let rows = 0;

			for (const kind of Object.keys(TABLES)) {
				rows += await syncSheet(eventKey, kind, syncStartedAt);
			}

			status.lastSuccessAt = new Date().toISOString();
			status.events[eventKey] = { rows, at: status.lastSuccessAt };
			if (status.lastError) console.log("Supabase mirror: connected again.");
			status.lastError = null;
			status.pausedUntil = null;
		} catch (error) {
			fail(error.message, error.backoff ?? BACKOFF_NETWORK_ERROR_MS);
		} finally {
			running.delete(eventKey);
			if (rerun.delete(eventKey)) scheduleSync(eventKey);
		}
	}

	async function syncAll() {
		for (const eventKey of eventKeys()) {
			if (paused()) return;
			await sync(eventKey);
		}
	}

	/* Called after a successful Google Sheets write. Never throws, never blocks. */
	function scheduleSync(eventKey) {
		if (!config) return;

		clearTimeout(pending.get(eventKey));
		pending.set(eventKey, setTimeout(() => {
			pending.delete(eventKey);
			sync(eventKey).catch(() => {});
		}, SUBMIT_SYNC_DELAY_MS));
	}

	function start() {
		if (!config) {
			console.log("Supabase mirror: off (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing or still placeholders). Google Sheets only.");
			return;
		}

		console.log(`Supabase mirror: on, copying scouting sheets to ${config.url}.`);
		setTimeout(() => syncAll().catch(() => {}), FIRST_SYNC_DELAY_MS).unref();
		interval = setInterval(() => syncAll().catch(() => {}), SYNC_INTERVAL_MS);
		interval.unref();
	}

	return {
		start,
		scheduleSync,
		syncAll: () => syncAll().catch(() => {}),
		status: () => ({
			...status,
			pausedUntil: status.pausedUntil && paused() ? new Date(status.pausedUntil).toISOString() : null
		})
	};
}
