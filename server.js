import "dotenv/config";
import express from "express";
import compression from "compression";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { readFileSync } from "fs";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import {
	DEFAULT_COLORS, checkColors, cleanName, createTeamStore, hashSecret, parseEventKey,
	parseSheetId, parseTeamNumber, verifySecret
} from "./teams.js";
import { google } from "googleapis";
import { startBehindTheBumpers, episodesForTeam } from "./behind-the-bumpers.js";
import { createSupabaseMirror } from "./supabase-mirror.js";
const app = express();

/* =================================
   API CACHE
   Every upstream lookup (TBA, Statbotics, Google Sheets) goes through this.
   - Fresh results (younger than `ttl`) are returned straight away.
   - Older results are STILL returned straight away, and a fresh copy is fetched
     in the background ("stale-while-revalidate"), so nobody waits on a slow or
     failing upstream once something has been loaded before.
   - Simultaneous callers for the same key share one request.
   - Named caches are saved to data/api-cache.json, so a restart (or an outage
     at TBA/Statbotics, or no internet at an event) still serves the last good data.
================================= */

const API_CACHE_FILE = new URL("./data/api-cache.json", import.meta.url);
const API_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // keep serving data up to a week old if needed
const persistedCaches = new Map();
let apiCacheDirty = false;

/* Load what was saved last time (synchronously, before any request arrives). */
let savedApiCache = {};
try {
	savedApiCache = JSON.parse(readFileSync(API_CACHE_FILE, "utf8")).caches ?? {};
} catch {
	/* First run or unreadable: start empty. */
}

function cachedFetcher(ttl, load, { name = null } = {}) {
	const cache = new Map(name ? (savedApiCache[name] ?? []) : []);
	const inFlight = new Map();

	const refresh = key => {
		if (inFlight.has(key)) return inFlight.get(key);

		const request = load(key)
			.then(data => {
				cache.set(key, { time: Date.now(), data });
				if (name) apiCacheDirty = true;
				return data;
			})
			.finally(() => inFlight.delete(key));

		inFlight.set(key, request);
		return request;
	};

	const get = key => {
		const cached = cache.get(key);
		const age = cached ? Date.now() - cached.time : Infinity;

		if (age < ttl) return Promise.resolve(cached.data);

		if (age < API_CACHE_MAX_AGE) {
			// Serve the last good copy now and refresh behind the scenes.
			refresh(key).catch(() => { /* keep serving the old copy */ });
			return Promise.resolve(cached.data);
		}

		return refresh(key);
	};

	get.invalidate = predicate => {
		for (const key of cache.keys()) {
			if (predicate(key)) cache.delete(key);
		}
		if (name) apiCacheDirty = true;
	};

	if (name) persistedCaches.set(name, cache);
	return get;
}

/* Save named caches every 30 s when something changed (write to a temp file,
   then rename, so a crash mid-write can't corrupt the saved copy). */
async function saveApiCache() {
	if (!apiCacheDirty) return;
	apiCacheDirty = false;

	const cutoff = Date.now() - API_CACHE_MAX_AGE;
	const caches = Object.fromEntries([...persistedCaches].map(([name, cache]) => [
		name,
		[...cache].filter(([, entry]) => entry.time > cutoff)
	]));

	try {
		await mkdir(new URL("./data/", import.meta.url), { recursive: true });
		const temp = new URL("./data/api-cache.json.tmp", import.meta.url);
		await writeFile(temp, JSON.stringify({ savedAt: Date.now(), caches }));
		await rename(temp, API_CACHE_FILE);
	} catch (error) {
		apiCacheDirty = true;
		console.error("Couldn't save the API cache:", error.message);
	}
}

setInterval(saveApiCache, 30 * 1000).unref();


// Gzip responses; the scouting sheet JSON is ~500 KB uncompressed.
app.use(compression());
app.use(express.json({ limit: "100kb" }));

app.use((req, res, next) => {
	console.log("REQUEST:", req.method, req.url);
	next();
});

/* =================================
   TEAM LOGIN
   Every team has its own account (team number + password) and its own Google
   Sheet(s). Every page and every data request is checked here, before anything
   is served, so one team can't reach another team's data. A correct login sets
   a signed cookie that lasts 30 days (long enough for a whole season).
   The original MakeShift 4039 team is configured from .env (TEAM_PASSWORD and
   the SCOUTING_SHEET_* values); other teams sign up on /signup/.
================================= */

const TEAM_PASSWORD = process.env.TEAM_PASSWORD;

if (!TEAM_PASSWORD) {
	throw new Error("Missing TEAM_PASSWORD in .env (the MakeShift 4039 team login password)");
}

const legacyTeam = {
	legacy: true,
	number: "4039",
	name: "MakeShift",
	colors: DEFAULT_COLORS,
	passwordHash: await hashSecret(TEAM_PASSWORD),
	// Changing TEAM_PASSWORD logs this team out everywhere.
	sessionVersion: createHash("sha256").update(`legacy|${TEAM_PASSWORD}`).digest("hex").slice(0, 16),
	// Read when asked: the env sheet table is defined further down.
	get events() {
		return Object.entries(scoutingSheetIds).filter(([, sheetId]) => sheetId).map(([key, sheetId]) => ({ key, name: key, sheetId }));
	}
};

const teamStore = createTeamStore({
	file: process.env.TEAMS_FILE ?? new URL("./data/teams.json", import.meta.url),
	legacy: legacyTeam
});
await teamStore.load();

const SESSION_COOKIE = "makeshift_session";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const sessionKey = createHash("sha256")
	.update(`${process.env.SESSION_SECRET || ""}|makeshift-session|${TEAM_PASSWORD}`)
	.digest();

/* Used so a login for a team that doesn't exist takes as long as a wrong password. */
const dummyHash = await hashSecret("not-a-real-password");

function signSession(payload) {
	return createHmac("sha256", sessionKey).update(payload).digest("hex");
}

/* "teamNumber.expires.signature". The signature covers the team's session
   version, so changing a team's password logs its other sessions out. */
function makeSessionToken(team) {
	const expires = Date.now() + SESSION_MAX_AGE_MS;
	return `${team.number}.${expires}.${signSession(`${team.number}.${expires}.${team.sessionVersion}`)}`;
}

function readCookie(req, name) {
	for (const part of String(req.headers.cookie ?? "").split(";")) {
		const index = part.indexOf("=");
		if (index !== -1 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
	}
	return null;
}

/* The team this request is logged in as, or null. */
function sessionTeam(req) {
	const [number, expires, signature] = String(readCookie(req, SESSION_COOKIE) ?? "").split(".");
	const team = number ? teamStore.get(number) : null;
	if (!team || !signature || !(Number(expires) > Date.now())) return null;

	const expected = Buffer.from(signSession(`${team.number}.${expires}.${team.sessionVersion}`));
	const given = Buffer.from(signature);
	return given.length === expected.length && timingSafeEqual(given, expected) ? team : null;
}

function sessionCookie(req, value, maxAgeSeconds) {
	const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
	return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

function startSession(req, res, team) {
	res.setHeader("Set-Cookie", sessionCookie(req, makeSessionToken(team), SESSION_MAX_AGE_MS / 1000));
}

/* Only same-site paths are allowed as the "go back to" address. */
function safeNext(value) {
	const next = String(value ?? "");
	return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") && !next.startsWith("/login") && !next.startsWith("/signup") ? next : "/";
}

/* Slows down guessing and abuse: `max` tries per IP in each time window. */
function createLimiter(max, windowMs) {
	const entries = new Map();
	setInterval(() => {
		const now = Date.now();
		for (const [key, entry] of entries) if (entry.resetAt < now) entries.delete(key);
	}, 5 * 60 * 1000).unref();

	const current = key => {
		const entry = entries.get(key);
		return entry && entry.resetAt > Date.now() ? entry : null;
	};

	return {
		/* Minutes until this IP may try again, or 0 if it may now. */
		wait(key) {
			const entry = current(key);
			return entry && entry.count >= max ? Math.ceil((entry.resetAt - Date.now()) / 60000) : 0;
		},
		hit(key) {
			const entry = current(key) ?? { count: 0, resetAt: Date.now() + windowMs };
			entry.count++;
			entries.set(key, entry);
		},
		clear(key) {
			entries.delete(key);
		}
	};
}

const loginLimiter = createLimiter(8, 15 * 60 * 1000);
const signupLimiter = createLimiter(8, 60 * 60 * 1000);
const lookupLimiter = createLimiter(80, 15 * 60 * 1000);

const waitMessage = minutes => `Too many tries. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;

app.post("/api/login", async (req, res) => {
	const wait = loginLimiter.wait(req.ip);
	if (wait) return res.status(429).json({ error: waitMessage(wait) });

	const team = teamStore.get(parseTeamNumber(req.body?.team));
	const password = typeof req.body?.password === "string" ? req.body.password.slice(0, 200) : "";
	const matches = await verifySecret(password, team?.passwordHash ?? dummyHash);

	if (!team || !matches) {
		loginLimiter.hit(req.ip);
		return res.status(401).json({ error: "That team number or password isn't right." });
	}

	loginLimiter.clear(req.ip);
	startSession(req, res, team);
	res.json({ ok: true, next: safeNext(req.body.next), team: await teamPayload(team) });
});

app.post("/api/logout", (req, res) => {
	res.setHeader("Set-Cookie", sessionCookie(req, "", 0));
	res.json({ ok: true });
});

/* The team's colours as CSS variables, loaded by every page. Answers even when
   logged out (with the default colours) so the login page can use it. */
app.get("/team.css", (req, res) => {
	const colors = sessionTeam(req)?.colors ?? DEFAULT_COLORS;
	res.type("text/css").set("Cache-Control", "no-cache").send(`:root{--brand:${colors.primary};--brand-2:${colors.accent};}\n`);
});

/* The only things reachable without logging in: the login and signup pages and
   what they need (fonts, images, stylesheets, the colour helper), the health
   check, and the offline service worker script (a browser can't register it
   through a redirect). */
function isPublicPath(path) {
	return path === "/health"
		|| path === "/theme.css"
		|| path === "/team.css"
		|| path === "/team-colors.js"
		|| path === "/team-forms.css"
		|| path === "/offline-service-worker.js"
		|| path === "/login" || path.startsWith("/login/")
		|| path === "/signup" || path.startsWith("/signup/")
		|| path === "/api/signup" || path.startsWith("/api/signup/")
		|| path.startsWith("/fonts/") || path.startsWith("/images/");
}

app.use((req, res, next) => {
	if (isPublicPath(req.path)) return next();

	req.team = sessionTeam(req);
	if (req.team) return next();

	// Data requests get an error the pages can recognise; page loads go to the login page.
	if (req.path.startsWith("/api/") || (req.method !== "GET" && req.method !== "HEAD")) {
		return res.status(401).json({ error: "Please log in.", login: true });
	}

	res.redirect(`/login/?next=${encodeURIComponent(req.originalUrl)}`);
});

/* A page asked for data without picking an event (a team with no events yet has an empty dropdown). */
app.use("/api", (req, res, next) => {
	if (req.path.includes("//")) {
		return res.status(404).json({ error: "No event is selected. Add your events in Team settings first." });
	}
	next();
});
const TBA_BASE = "https://www.thebluealliance.com/api/v3";
const googleAuth = new google.auth.GoogleAuth({
	credentials: process.env.GOOGLE_SERVICE_ACCOUNT_JSON
		? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
		: undefined,
	keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_JSON
		? undefined
		: "./google-service-account.json",
	scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});



if (!process.env.TBA_AUTH_KEY) {
	throw new Error("Missing TBA_AUTH_KEY in .env");
}

if (!process.env.SCOUTING_SHEET_2026ONCMP2) {
	console.warn("Missing SCOUTING_SHEET_2026ONCMP2 in .env");
}
const sheets = google.sheets({
	version: "v4",
	auth: googleAuth
});

/* Sheet reads are cached (fresh for 30 seconds, then refreshed in the background)
   so switching teams doesn't re-download the whole sheet each time. Submissions
   through this server clear their sheet's cache straight away; edits made
   directly in Google Sheets show up within about 30 seconds (one page load may
   still show the previous copy while the new one downloads).
   Returns the same { data: { values } } shape as the API. */
const SHEET_KEY_SEPARATOR = "\n";
const sheetReads = cachedFetcher(30 * 1000, key => {
	const [spreadsheetId, range] = key.split(SHEET_KEY_SEPARATOR);
	return sheets.spreadsheets.values.get({ spreadsheetId, range })
		.then(response => ({ data: { values: response.data.values } }));
}, { name: "sheets" });

function readSheet(spreadsheetId, range) {
	return sheetReads(`${spreadsheetId}${SHEET_KEY_SEPARATOR}${range}`);
}

function forgetSheet(spreadsheetId) {
	sheetReads.invalidate(key => key.startsWith(`${spreadsheetId}${SHEET_KEY_SEPARATOR}`));
}

/* =================================
   SHEET LAYOUTS
   A team's sheet can use either layout, found by which tab it has:
   - SIMPLE: "Match Scouting Columns" / "Pit Scouting Columns". Only the columns
     the app uses; every column is a form field, and there are no formulas. The
     numbers the pages expect (like climb points) are worked out here.
   - LEGACY: "Scouting Raw Data" / "Pit Scouting Raw Data", the 39-column sheet
     with a calculated block and a fixed set of form columns. Existing event
     sheets keep working exactly as before.
   A sheet with both tabs uses the simple one.
================================= */

const SHEET_TABS = {
	match: { simple: "Match Scouting Columns", legacy: "Scouting Raw Data" },
	pit: { simple: "Pit Scouting Columns", legacy: "Pit Scouting Raw Data" }
};

/* Which columns of the legacy sheets are form fields. */
const LEGACY_FORM_LETTERS = {
	match: "B C D E H K L M N R T".split(" "),
	pit: "B C D F G H J K L M Z AD AE AF AH".split(" ")
};

/* Headers that hold yes/no answers (a new simple tab has no rows yet to tell). */
const SIMPLE_MATCH_YES_NO = new Set([
	"Shuttle Fuel", "Robot was defended", "No Show", "Robot died/had breakdown in functionality",
	"Robot tipped/fell over", "Robot received fouls or a yellow/red card"
]);

const sheetTabTitles = cachedFetcher(60 * 1000, spreadsheetId =>
	sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" })
		.then(response => response.data.sheets.map(sheet => sheet.properties.title)),
	{ name: "sheet-tabs" }
);

/* The tab to use for "match" or "pit" data, or null if the sheet has neither. */
async function sheetTab(spreadsheetId, kind) {
	const titles = await sheetTabTitles(spreadsheetId);
	const tabs = SHEET_TABS[kind];

	if (titles.includes(tabs.simple)) return { title: tabs.simple, simple: true, kind };
	if (titles.includes(tabs.legacy)) return { title: tabs.legacy, simple: false, kind };
	return null;
}

function letterToIndex(letter) {
	return [...String(letter).trim().toUpperCase()].reduce((total, character) => total * 26 + character.charCodeAt(0) - 64, 0) - 1;
}

/* Column positions the form should show, in order. */
function formFieldIndexes(headers, tab) {
	if (tab.simple) return headers.map((header, index) => header ? index : null).filter(Number.isInteger);
	return LEGACY_FORM_LETTERS[tab.kind].map(letterToIndex).filter(index => headers[index]);
}

/* The simple match tab has no formula columns, so numbers the pages expect are
   worked out as rows are read: End Game Climb as points (level 1/2/3 = 10/20/30)
   and the climb-points total. */
function climbPoints(value) {
	const text = String(value ?? "").trim();
	if (text !== "" && Number.isFinite(Number(text))) return Number(text);
	if (/^true$/i.test(text)) return 10; // an older yes/no answer: climbed, level unknown, counted as level 1
	const level = text.match(/(?:level|lvl|l)\s*([123])\b/i);
	return level ? Number(level[1]) * 10 : 0;
}

function normalizeSimpleMatchRow(row) {
	const endgame = climbPoints(row["End Game Climb"]);
	const auto = Number(row["Auto Climb"]);

	return {
		...row,
		"End Game Climb": endgame,
		"Climb points": endgame + (Number.isFinite(auto) ? auto : 0),
		"Teleop Calculated Scoring Points": row["Teleop Scoring Points"] ?? ""
	};
}

/* Rows as { header: value } objects. */
function rowsToObjects(values, normalize = row => row) {
	const [headers, ...rows] = values ?? [];
	if (!headers) return [];
	return rows.map(row => normalize(Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]))));
}

const noTabMessage = (kind, req) => req.team.legacy
	? `The sheet has no ${SHEET_TABS[kind].legacy} tab.`
	: `That event's sheet has no "${SHEET_TABS[kind].simple}" tab. Start from a copy of the team template sheet.`;

const scoutingSheetIds = {
	"2026oncmp2": process.env.SCOUTING_SHEET_2026ONCMP2,
	"2026ontor": process.env.SCOUTING_SHEET_2026ONTOR,
	"2026onwin": process.env.SCOUTING_SHEET_2026ONWIN,
	"2026test": process.env.SCOUTING_SHEET_2026TEST
};

/* A team only ever gets its own sheets: the lookup goes through that team's
   event list, so asking for another team's event just finds nothing. */
function spreadsheetIdForEvent(team, eventKey) {
	return team.events.find(event => event.key === eventKey)?.sheetId;
}

/* Backup copy of every scouting sheet in Supabase (see supabase-mirror.js).
   Optional: with no keys, placeholder keys or no connection it does nothing and
   never affects requests. Google Sheets stays the primary store. */
const supabaseMirror = createSupabaseMirror({
	url: process.env.SUPABASE_URL,
	key: process.env.SUPABASE_SERVICE_ROLE_KEY,
	eventKeys: () => Object.keys(scoutingSheetIds).filter(key => scoutingSheetIds[key]),
	loadSheet: async (eventKey, kind) => {
		const tab = kind === "pit" ? "Pit Scouting Raw Data" : "Scouting Raw Data";
		const response = await readSheet(scoutingSheetIds[eventKey], `'${tab}'!A:ZZ`);
		return response.data.values ?? [];
	}
});

function columnIndexToLetter(index) {
	let result = "";
	let current = index + 1;

	while (current > 0) {
		const remainder = (current - 1) % 26;
		result = String.fromCharCode(65 + remainder) + result;
		current = Math.floor((current - 1) / 26);
	}

	return result;
}


// TBA data changes during events (new match results), so only keep it briefly.
const tba = cachedFetcher(60 * 1000, async path => {
	const response = await fetch(`${TBA_BASE}${path}`, {
		headers: {
			"X-TBA-Auth-Key": process.env.TBA_AUTH_KEY,
		},
		signal: AbortSignal.timeout(15000)
	});

	if (!response.ok) {
		throw new Error(`TBA request failed: ${response.status}`);
	}

	return response.json();
}, { name: "tba" });

const STATBOTICS_CACHE_MS = 2 * 60 * 1000;

/* When Statbotics is having an outage it often fails slowly (5+ s per request).
   After 3 outage-like failures in a row, skip it for a minute so pages render
   straight away (cached data is still served; only cold lookups go without EPA).
   Its normal "not found" answer is a quick 500, which doesn't count. */
const statboticsHealth = { failures: 0, skipUntil: 0 };

function statboticsFailed(slow) {
	if (!slow) return;
	statboticsHealth.failures += 1;
	if (statboticsHealth.failures >= 3 && Date.now() > statboticsHealth.skipUntil) {
		statboticsHealth.skipUntil = Date.now() + 60 * 1000;
		statboticsHealth.failures = 0;
		console.warn("Statbotics looks down: skipping it for 1 minute (cached EPA is still served).");
	}
}

const statbotics = cachedFetcher(STATBOTICS_CACHE_MS, async path => {
	if (Date.now() < statboticsHealth.skipUntil) {
		const error = new Error("Statbotics request skipped: it's currently down");
		error.status = 503;
		throw error;
	}

	// Retry brief 502/503/504s once. Anything else fails straight away:
	// Statbotics answers "not found" (e.g. a team that wasn't at an event) with a
	// 500 and an empty {} body, and retrying that only adds delay.
	const maxAttempts = 2;
	const retryable = status => status === 502 || status === 503 || status === 504;

	for (let attempt = 1; ; attempt++) {
		const started = Date.now();
		let response;

		try {
			response = await fetch(`https://api.statbotics.io/v3${path}`, {
				headers: { Accept: "application/json" },
				signal: AbortSignal.timeout(8000)
			});
		} catch (error) {
			statboticsFailed(true);
			if (attempt >= maxAttempts || Date.now() < statboticsHealth.skipUntil) throw error;
		}

		if (response?.ok) {
			statboticsHealth.failures = 0;
			return response.json();
		}

		if (response) {
			statboticsFailed(retryable(response.status) || Date.now() - started > 3000);

			if (!retryable(response.status) || attempt >= maxAttempts) {
				const error = new Error(`Statbotics request failed: ${response.status}`);
				error.status = response.status;
				throw error;
			}
		}

		await new Promise(resolve => setTimeout(resolve, 500 * attempt));
	}
}, { name: "statbotics" });

/* Sends a Statbotics error to the browser with the same status codes as before:
   Statbotics' own status (e.g. 500 when a team isn't at an event), or 502. */
function sendStatboticsError(res, error) {
	console.error("Statbotics error:", error.message);
	res.status(error.status ?? 502).json({
		error: error.status ? `Statbotics returned ${error.status}` : "Could not contact Statbotics",
		details: error.message
	});
}

function stripHtml(value) {
	return String(value ?? "").replace(/<[^>]*>/g, "");
}

/* =================================
   TEAM ACCOUNTS: SIGN UP + SETTINGS
================================= */

/* The tabs and columns the stats pages rely on. The match form builds itself
   from the sheet's header row, so anything extra is fine. */
const REQUIRED_SHEET_COLUMNS = {
	match: {
		simple: ["Team Number", "Match Number", "Auto Scoring Points", "Teleop Scoring Points"],
		legacy: ["Team Number", "Match Number", "No Show", "Auto Scoring Points", "Teleop Scoring Points"]
	},
	pit: {
		simple: ["Team Number of Team Being Scouted"],
		legacy: ["Team Number of Team Being Scouted"]
	}
};

const TEMPLATE_SHEET_URL = /^https:\/\/docs\.google\.com\//.test(process.env.TEMPLATE_SHEET_URL ?? "") ? process.env.TEMPLATE_SHEET_URL : null;

/* Scout passcodes are checked per team. The original team keeps using the
   values in .env; other teams use the passcode saved on their account. */
async function checkSubmissionToken(req, kind) {
	const provided = req.body?.submissionToken;

	if (req.team.legacy) {
		const token = kind === "pit"
			? process.env.PIT_SCOUTING_SUBMISSION_TOKEN
			: process.env.SCOUTING_SUBMISSION_TOKEN ?? process.env.PIT_SCOUTING_SUBMISSION_TOKEN;

		if (!token) return { status: 503, error: "Scouting submissions are not configured. Set the scout passcode in .env on the server first." };
		return provided === token ? null : { status: 401, error: "Incorrect scout passcode." };
	}

	const matches = typeof provided === "string" && await verifySecret(provided.slice(0, 200), req.team.scoutPasscodeHash);
	return matches ? null : { status: 401, error: "Incorrect scout passcode." };
}

async function serviceAccountEmail() {
	return (await googleAuth.getCredentials()).client_email;
}

/* Returns null when the sheet is usable, otherwise a message for the team. */
async function checkSheet(spreadsheetId) {
	const email = await serviceAccountEmail();
	const notShared = `Couldn't open that sheet. Share it with ${email} as an Editor, then try again.`;
	const failedWith = (error, ...statuses) => statuses.includes(error.code ?? error.response?.status);

	let meta;
	try {
		meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "properties.title,sheets.properties.title" });
	} catch (error) {
		if (failedWith(error, 403, 404)) return notShared;
		throw error;
	}

	const titles = new Set(meta.data.sheets.map(sheet => sheet.properties.title));

	for (const kind of ["match", "pit"]) {
		/* Either layout will do; the simple tab is used if both are there. */
		const layout = titles.has(SHEET_TABS[kind].simple) ? "simple" : titles.has(SHEET_TABS[kind].legacy) ? "legacy" : null;

		if (!layout) {
			return `That sheet has no "${SHEET_TABS[kind].simple}" tab. Start from a copy of the team template sheet so the tabs and columns match.`;
		}

		// Read directly (not through the cache) so a fixed sheet passes straight away.
		const tab = SHEET_TABS[kind][layout];
		const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${tab}'!1:1` });
		const headers = new Set((response.data.values?.[0] ?? []).map(header => String(header).trim()));
		const missing = REQUIRED_SHEET_COLUMNS[kind][layout].filter(column => !headers.has(column));
		if (missing.length) return `The "${tab}" tab is missing the column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. Start from a copy of the team template sheet.`;
	}

	// Scouts submit into the sheet, so the share has to be Editor: re-save the same title (a no-op that needs edit access).
	try {
		await sheets.spreadsheets.batchUpdate({
			spreadsheetId,
			requestBody: { requests: [{ updateSpreadsheetProperties: { properties: { title: meta.data.properties.title }, fields: "title" } }] }
		});
	} catch (error) {
		if (failedWith(error, 403)) return `${email} can only view that sheet. Change its access to Editor so scouts can submit reports.`;
		throw error;
	}

	return null;
}

/* Validates a sheet (link or ID) for a team that may or may not have it already. */
async function validateSheetInput(value, exceptNumber = null) {
	const sheetId = parseSheetId(value);
	if (!sheetId) return { error: "Paste the Google Sheet link (or its ID)." };
	if (teamStore.sheetOwner(sheetId, exceptNumber)) {
		return { error: "That sheet is already in use by a team account. Make your own copy of the template sheet." };
	}
	const problem = await checkSheet(sheetId);
	return problem ? { error: problem } : { sheetId };
}

/* What the browser needs to know about a team. `events` are the team's own
   events (name, key, and whether a sheet is connected); the pages' event
   dropdowns show exactly these. */
async function teamPayload(team) {
	const view = teamStore.publicView(team);
	return { ...view, eventChoices: view.events };
}

async function eventFromTba(key) {
	try {
		const event = await tba(`/event/${key}`);
		return { key, name: cleanName(event.short_name || event.name || key) };
	} catch {
		return null;
	}
}

const sendGoogleProblem = (res, error) => {
	console.error("TEAM SHEET ERROR:", error.message);
	res.status(502).json({ error: "Google Sheets isn't responding right now. Try again in a moment." });
};

/* Facts the signup page needs, and (given a team number) that team's name and events from TBA. */
app.get("/api/signup/info", async (req, res) => {
	const wait = lookupLimiter.wait(req.ip);
	if (wait) return res.status(429).json({ error: waitMessage(wait) });
	lookupLimiter.hit(req.ip);

	const info = {
		serviceAccountEmail: await serviceAccountEmail().catch(() => null),
		templateUrl: TEMPLATE_SHEET_URL
	};

	const number = parseTeamNumber(req.query.team);
	if (number) {
		info.taken = Boolean(teamStore.get(number));
		const year = new Date().getFullYear();

		try {
			const [team, events] = await Promise.all([
				tba(`/team/frc${number}`),
				tba(`/team/frc${number}/events/${year}`).catch(() => [])
			]);
			info.nickname = cleanName(team.nickname);
			info.events = events
				.sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))
				.map(event => ({ key: event.key, name: cleanName(event.short_name || event.name) }));
		} catch (error) {
			if (/404/.test(error.message)) info.notFound = true;
		}
	}

	res.json(info);
});

app.post("/api/signup/check-sheet", async (req, res) => {
	const wait = lookupLimiter.wait(req.ip);
	if (wait) return res.status(429).json({ error: waitMessage(wait) });
	lookupLimiter.hit(req.ip);

	try {
		const result = await validateSheetInput(req.body?.sheet);
		res.status(result.error ? 400 : 200).json(result.error ? { error: result.error } : { ok: true });
	} catch (error) {
		sendGoogleProblem(res, error);
	}
});

app.post("/api/signup", async (req, res) => {
	const wait = signupLimiter.wait(req.ip);
	if (wait) return res.status(429).json({ error: waitMessage(wait) });
	signupLimiter.hit(req.ip);

	const fail = (status, error) => res.status(status).json({ error });
	const body = req.body ?? {};

	const number = parseTeamNumber(body.number);
	const name = cleanName(body.name);
	const password = typeof body.password === "string" ? body.password : "";
	const scoutPasscode = typeof body.scoutPasscode === "string" && body.scoutPasscode ? body.scoutPasscode : password;
	const eventKey = parseEventKey(body.event);
	const { colors, error: colorError } = checkColors(body.colors);
	/* A Google Sheet is optional here: it can be connected later in Team settings. */
	const wantsSheet = typeof body.sheet === "string" && body.sheet.trim() !== "";

	if (!number) return fail(400, "Enter your FRC team number.");
	if (name.length < 2) return fail(400, "Enter your team name.");
	if (password.length < 8 || password.length > 200) return fail(400, "The team password needs at least 8 characters.");
	if (scoutPasscode.length < 4 || scoutPasscode.length > 200) return fail(400, "The scout passcode needs at least 4 characters.");
	if (colorError) return fail(400, colorError);
	if (wantsSheet && !eventKey) return fail(400, "Pick the event your sheet is for (or enter its key, like 2026onwat).");
	if (teamStore.isFull()) return fail(503, "Sign-ups are closed right now. Ask the site owner.");
	if (teamStore.get(number)) return fail(409, `Team ${number} already has an account. Log in instead.`);

	try {
		try {
			await tba(`/team/frc${number}`);
		} catch (error) {
			if (/404/.test(error.message)) return fail(400, `FRC team ${number} wasn't found on The Blue Alliance.`);
			throw error;
		}

		const events = [];
		if (wantsSheet) {
			const event = await eventFromTba(eventKey);
			if (!event) return fail(400, `Event ${eventKey} wasn't found on The Blue Alliance.`);

			const sheet = await validateSheetInput(body.sheet);
			if (sheet.error) return fail(400, sheet.error);
			events.push({ ...event, sheetId: sheet.sheetId });
		}

		const [passwordHash, scoutPasscodeHash] = await Promise.all([hashSecret(password), hashSecret(scoutPasscode)]);

		// Re-check right before saving: someone may have signed up while we were checking.
		if (teamStore.get(number)) return fail(409, `Team ${number} already has an account. Log in instead.`);
		if (events[0] && teamStore.sheetOwner(events[0].sheetId)) return fail(400, "That sheet is already in use by a team account.");

		const team = {
			number,
			name,
			colors,
			passwordHash,
			scoutPasscodeHash,
			sessionVersion: randomBytes(8).toString("hex"),
			events,
			createdAt: new Date().toISOString()
		};
		await teamStore.add(team);

		console.log(`Team account created: ${number} (${name})`);
		startSession(req, res, team);
		res.status(201).json({ ok: true, team: await teamPayload(team) });
	} catch (error) {
		console.error("SIGNUP ERROR:", error.message);
		res.status(502).json({ error: "Couldn't finish creating the account (The Blue Alliance or Google didn't answer). Try again in a moment." });
	}
});

/* ----- Settings (logged in) ----- */

const MAX_TEAM_EVENTS = 25;

function requireEditableTeam(req, res, next) {
	if (req.team.legacy) {
		return res.status(400).json({ error: "This team is set up in the server's .env file, so it can't be changed here." });
	}
	next();
}

/* The team's events on The Blue Alliance this year, so the settings page can
   offer to fill in an event's name and key. Optional: empty if TBA is down. */
async function tbaEventsFor(team) {
	if (team.legacy) return [];
	try {
		const events = await tba(`/team/frc${team.number}/events/${new Date().getFullYear()}`);
		return [...events]
			.sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))
			.map(event => ({ key: event.key, name: cleanName(event.short_name || event.name) }));
	} catch {
		return [];
	}
}

app.get("/api/team", async (req, res) => {
	res.json({
		...await teamPayload(req.team),
		tbaEvents: await tbaEventsFor(req.team),
		serviceAccountEmail: await serviceAccountEmail().catch(() => null),
		templateUrl: TEMPLATE_SHEET_URL
	});
});

app.post("/api/team/profile", requireEditableTeam, async (req, res) => {
	const name = cleanName(req.body?.name);
	const { colors, error } = checkColors(req.body?.colors);

	if (name.length < 2) return res.status(400).json({ error: "Enter your team name." });
	if (error) return res.status(400).json({ error });

	teamStore.update(req.team.number, { name, colors });
	res.json(await teamPayload(req.team));
});

/* Adds one of the team's events (name + key + optional sheet), or updates the
   name and/or sheet of an event that's already there. The key is the event's
   TBA key (like 2026onwat) so public event data works; a team can also make up
   a key for a practice or test event. */
app.post("/api/team/events", requireEditableTeam, async (req, res) => {
	const name = cleanName(req.body?.name);
	const key = parseEventKey(req.body?.key);
	const sheetGiven = typeof req.body?.sheet === "string" && req.body.sheet.trim() !== "";

	if (name.length < 2) return res.status(400).json({ error: "Enter a name for the event." });
	if (!key) return res.status(400).json({ error: "Enter the event key: the year then a short code, like 2026onwat." });

	const existing = req.team.events.find(event => event.key === key);
	if (!existing && req.team.events.length >= MAX_TEAM_EVENTS) {
		return res.status(400).json({ error: `A team can have up to ${MAX_TEAM_EVENTS} events.` });
	}

	try {
		let sheetId = existing?.sheetId ?? null;

		if (sheetGiven) {
			const sheet = await validateSheetInput(req.body.sheet, req.team.number);
			if (sheet.error) return res.status(400).json({ error: sheet.error });
			sheetId = sheet.sheetId;
		}

		const events = [...req.team.events.filter(other => other.key !== key), { key, name, sheetId }]
			.sort((a, b) => a.key.localeCompare(b.key));
		teamStore.update(req.team.number, { events });
		res.status(existing ? 200 : 201).json(await teamPayload(req.team));
	} catch (error) {
		sendGoogleProblem(res, error);
	}
});

app.delete("/api/team/events/:key", requireEditableTeam, async (req, res) => {
	teamStore.update(req.team.number, { events: req.team.events.filter(event => event.key !== req.params.key) });
	res.json(await teamPayload(req.team));
});

/* Deleting the account needs the team password and the team number typed in.
   It removes the team's login and settings; the Google Sheets are left alone. */
app.post("/api/team/delete", requireEditableTeam, async (req, res) => {
	const wait = loginLimiter.wait(req.ip);
	if (wait) return res.status(429).json({ error: waitMessage(wait) });

	const body = req.body ?? {};
	const password = typeof body.password === "string" ? body.password.slice(0, 200) : "";

	if (String(body.confirm ?? "").trim() !== req.team.number) {
		return res.status(400).json({ error: `Type your team number (${req.team.number}) to confirm.` });
	}
	if (!await verifySecret(password, req.team.passwordHash)) {
		loginLimiter.hit(req.ip);
		return res.status(401).json({ error: "The password isn't right." });
	}

	teamStore.remove(req.team.number);
	console.log(`Team account deleted: ${req.team.number} (${req.team.name})`);
	res.setHeader("Set-Cookie", sessionCookie(req, "", 0));
	res.json({ ok: true });
});

/* Changing either password needs the current team password. */
app.post("/api/team/passwords", requireEditableTeam, async (req, res) => {
	const wait = loginLimiter.wait(req.ip);
	if (wait) return res.status(429).json({ error: waitMessage(wait) });

	const body = req.body ?? {};
	const current = typeof body.current === "string" ? body.current.slice(0, 200) : "";

	if (!await verifySecret(current, req.team.passwordHash)) {
		loginLimiter.hit(req.ip);
		return res.status(401).json({ error: "The current password isn't right." });
	}

	const changes = {};
	if (body.password) {
		if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 200) {
			return res.status(400).json({ error: "The new team password needs at least 8 characters." });
		}
		changes.passwordHash = await hashSecret(body.password);
		changes.sessionVersion = randomBytes(8).toString("hex"); // logs everyone else out
	}
	if (body.scoutPasscode) {
		if (typeof body.scoutPasscode !== "string" || body.scoutPasscode.length < 4 || body.scoutPasscode.length > 200) {
			return res.status(400).json({ error: "The new scout passcode needs at least 4 characters." });
		}
		changes.scoutPasscodeHash = await hashSecret(body.scoutPasscode);
	}
	if (!Object.keys(changes).length) return res.status(400).json({ error: "Enter a new password or scout passcode." });

	const team = teamStore.update(req.team.number, changes);
	startSession(req, res, team); // keep this browser logged in
	res.json({ ok: true });
});

// All results for an event, such as "2026onott"
app.get("/api/events/:eventKey/matches", async (req, res) => {
	try {
		const matches = await tba(`/event/${req.params.eventKey}/matches`);

		// Return a simpler shape for a basic UI
		res.json(matches.map(match => ({
			key: match.key,
			level: match.comp_level,       // qm, sf, f, etc.
			number: match.match_number,
			red: match.alliances.red,
			blue: match.alliances.blue,
			winner: match.winning_alliance,
			time: match.actual_time,
			// Match recordings linked on TBA (usually the event's official YouTube uploads)
			videos: (match.videos ?? [])
				.filter(video => video.type === "youtube" && video.key)
				.map(video => `https://www.youtube.com/watch?v=${encodeURIComponent(video.key)}`),
		})));
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
});

// TBA team data
app.get(`/api/teamName/:teamNumber`, async (req, res) => {
	try {
		const team = await tba(`/team/frc${req.params.teamNumber}`);

		res.json({ name: team.nickname });
	} catch (error) {
		res.status(404).json({ error: error.message });
	}
});

// A team's robot photo for a year, if one is posted on TBA (preferred photo first)
const ROBOT_PHOTO_TYPES = new Set(["imgur", "cdphotothread", "instagram-image"]);

// Video titles from YouTube's public oEmbed endpoint (no API key). Titles don't
// change, so successful lookups are kept for the life of the server.
const youtubeInfoCache = new Map();

async function youtubeInfo(videoId) {
	if (youtubeInfoCache.has(videoId)) return youtubeInfoCache.get(videoId);

	const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
	const info = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`, {
		signal: AbortSignal.timeout(5000)
	})
		.then(response => response.ok ? response.json() : null)
		.catch(() => null);

	if (info) youtubeInfoCache.set(videoId, info);
	return info;
}

// TBA's YouTube media mixes Behind the Bumpers episodes (FUN Robotics Network,
// titled "2056 OP Robotics | Behind the Bumpers | ...") with teams' own reveal
// videos, so only accept a title that names the series and this team.
async function behindTheBumpers(media, teamNumber) {
	const videoIds = media
		.filter(item => item.type === "youtube" && /^[\w-]{11}$/.test(item.foreign_key ?? ""))
		.map(item => item.foreign_key);
	const infos = await Promise.all(videoIds.map(youtubeInfo));
	const teamPattern = new RegExp(`(^|\\D)${teamNumber}(\\D|$)`);
	const index = infos.findIndex(info =>
		/behind the bumpers/i.test(info?.title ?? "") && teamPattern.test(info.title)
	);

	return index === -1
		? null
		: { url: `https://www.youtube.com/watch?v=${videoIds[index]}`, title: infos[index].title };
}

// A team's robot photo and Behind the Bumpers video for a year, if TBA has them
app.get("/api/teams/:teamNumber/media/:year", async (req, res) => {
	const { teamNumber, year } = req.params;

	if (!/^\d+$/.test(teamNumber)) {
		return res.status(400).json({ error: "Invalid team number." });
	}

	try {
		const media = await tba(`/team/frc${teamNumber}/media/${year}`);
		const items = Array.isArray(media) ? media : [];
		const photos = items.filter(item => ROBOT_PHOTO_TYPES.has(item.type) && item.direct_url);
		const photo = photos.find(item => item.preferred) ?? photos[0];

		// Behind the Bumpers from the YouTube index (one episode per season, the
		// first being the robot overview), falling back to TBA's links this season.
		const episodes = new Map();
		for (const episode of episodesForTeam(teamNumber)) {
			if (!episodes.has(episode.season)) episodes.set(episode.season, episode);
		}
		const link = episode => ({
			season: episode.season,
			url: `https://www.youtube.com/watch?v=${episode.id}`,
			title: episode.title
		});
		const thisSeason = episodes.get(Number(year));

		res.json({
			url: photo?.direct_url ?? null,
			viewUrl: photo?.view_url ?? null,
			behindTheBumpers: thisSeason ? link(thisSeason) : await behindTheBumpers(items, teamNumber),
			pastBehindTheBumpers: [...episodes.values()]
				.filter(episode => episode.season < Number(year))
				.sort((a, b) => b.season - a.season)
				.map(link)
		});
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
});

// Event rankings
app.get("/api/events/:eventKey/rankings", async (req, res) => {
	try {
		// TBA wraps the list as { rankings: [...] }; pages expect the array itself.
		const data = await tba(`/event/${req.params.eventKey}/rankings`);
		res.json(data?.rankings ?? []);
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
});

// Event OPR statistics
app.get("/api/events/:eventKey/oprs", async (req, res) => {
	try {
		res.json(await tba(`/event/${req.params.eventKey}/oprs`));
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
});

/* =================================
   PRESCOUTING
================================= */

/* Runs fn over items with at most `limit` running at once. */
async function mapLimit(items, limit, fn) {
	const results = new Array(items.length);
	let next = 0;
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const index = next++;
			results[index] = await fn(items[index], index);
		}
	}));
	return results;
}

/* Every team's season summary (EPA, breakdown, world ranks, record, name) from
   Statbotics' bulk endpoint: ~4 pages of 1,000 instead of one request per team.
   Statbotics is slow and often 503s on these pages, so the result is saved to
   data/ and served from there straight away, including after a restart. It is
   refreshed in the background once it's 6 hours old. */
const STATBOTICS_PAGE = 1000;
// Season EPA moves slowly, and each refresh is a heavy download, so keep it rare.
const TEAM_YEARS_REFRESH_MS = 6 * 60 * 60 * 1000;
const teamYearsState = new Map();

const teamYearsFile = year => new URL(`./data/statbotics-team-years-${year}.json`, import.meta.url);

/* Only what prescouting uses, so the saved file stays small. */
function trimTeamYear(row) {
	const epa = row.epa ?? {};
	const breakdown = epa.breakdown ?? {};
	return {
		team: Number(row.team),
		name: row.name ?? null,
		epa: {
			total_points: epa.total_points ?? null,
			breakdown: {
				auto_points: breakdown.auto_points ?? null,
				teleop_points: breakdown.teleop_points ?? null,
				endgame_points: breakdown.endgame_points ?? null
			},
			stats: epa.stats ?? null,
			ranks: epa.ranks ?? null
		},
		record: row.record ?? null
	};
}

/* One ~1 MB page of team seasons. These are big and slow, so they get a longer
   timeout than normal lookups and a pause before retrying a 502/503/504. */
async function teamYearsPage(year, offset) {
	const url = `https://api.statbotics.io/v3/team_years?year=${year}&limit=${STATBOTICS_PAGE}&offset=${offset}`;

	for (let attempt = 1; ; attempt++) {
		const response = await fetch(url, {
			headers: { Accept: "application/json" },
			signal: AbortSignal.timeout(45 * 1000)
		});

		if (response.ok) {
			const data = await response.json();
			return (Array.isArray(data) ? data : []).map(trimTeamYear);
		}

		if (![502, 503, 504].includes(response.status) || attempt >= 3) {
			throw new Error(`Statbotics team_years request failed: ${response.status}`);
		}

		await new Promise(resolve => setTimeout(resolve, 3000 * attempt));
	}
}

/* Downloads the pages ONE AT A TIME. Fetching them together floods Statbotics,
   which then slows every other lookup (team pages took 40+ s while it ran). */
async function downloadTeamYears(year) {
	const rows = [];

	for (let offset = 0; ; offset += STATBOTICS_PAGE) {
		const page = await teamYearsPage(year, offset);
		rows.push(...page);
		if (page.length < STATBOTICS_PAGE) return rows;
	}
}

function refreshTeamYears(year, state) {
	if (state.refreshing) return state.refreshing;

	state.refreshing = downloadTeamYears(year)
		.then(async rows => {
			state.byTeam = new Map(rows.map(row => [row.team, row]));
			state.time = Date.now();
			await mkdir(new URL("./data/", import.meta.url), { recursive: true });
			await writeFile(teamYearsFile(year), JSON.stringify({ time: state.time, rows }));
			console.log(`Prescouting: saved ${rows.length} Statbotics team seasons for ${year}.`);
		})
		.catch(error => {
			// Don't start another heavy download on the very next request.
			state.retryAfter = Date.now() + 10 * 60 * 1000;
			console.error(`Prescouting: Statbotics ${year} refresh failed (will retry in 10 min):`, error.message);
		})
		.finally(() => { state.refreshing = null; });

	return state.refreshing;
}

/* Loads the saved copy (if any) without downloading. Resolves true if found. */
async function loadSavedTeamYears(year) {
	teamYearsStateFor(year);
	await teamYearsState.get(year).loading;
	return Boolean(teamYearsState.get(year).byTeam);
}

function teamYearsStateFor(year) {
	if (!teamYearsState.has(year)) {
		const state = { byTeam: null, time: 0, refreshing: null };
		state.loading = readFile(teamYearsFile(year), "utf8")
			.then(text => {
				const saved = JSON.parse(text);
				state.byTeam = new Map(saved.rows.map(row => [row.team, row]));
				state.time = saved.time;
			})
			.catch(() => { /* Not saved yet. */ });
		teamYearsState.set(year, state);
	}
	return teamYearsState.get(year);
}

async function teamYears(year) {
	const state = teamYearsStateFor(year);
	await state.loading;

	if (Date.now() - state.time > TEAM_YEARS_REFRESH_MS && Date.now() > (state.retryAfter ?? 0)) {
		refreshTeamYears(year, state);
	}

	// Serve the saved copy right away; only wait if there's nothing saved yet.
	if (!state.byTeam) await state.refreshing;
	if (!state.byTeam) throw new Error("Statbotics is unavailable right now. Try again in a minute.");

	return state.byTeam;
}

/* Season summaries for a list of teams, in the same shape as the season
   endpoint's (name, epa, record, events) so the page can treat them alike. */
app.get("/api/prescout", async (req, res) => {
	const year = String(req.query.year ?? "");
	const teams = [...new Set(String(req.query.teams ?? "").match(/\d{1,5}/g) ?? [])]
		.map(Number)
		.slice(0, 80);

	if (!/^\d{4}$/.test(year) || !teams.length) {
		return res.status(400).json({ error: "Provide a year and a list of team numbers." });
	}

	try {
		const [seasons, events] = await Promise.all([
			teamYears(year),
			tba(`/events/${year}`).catch(() => [])
		]);
		const eventsByKey = new Map(events.map(event => [event.key, event]));

		// Each team's finish and rank at every event they attended.
		const statuses = await mapLimit(teams, 8, team =>
			tba(`/team/frc${team}/events/${year}/statuses`).catch(() => ({}))
		);

		// OPRs per event, shared by every team at that event.
		const eventKeys = [...new Set(statuses.flatMap(status => Object.keys(status ?? {})))];
		const oprs = new Map(await mapLimit(eventKeys, 8, async key =>
			[key, await tba(`/event/${key}/oprs`).catch(() => null)]
		));

		const results = teams.map((team, index) => {
			const season = seasons.get(team);
			const teamKey = `frc${team}`;
			const teamEvents = Object.entries(statuses[index] ?? {})
				.map(([key, status]) => {
					const event = eventsByKey.get(key) ?? {};
					const ranking = status?.qual?.ranking;

					return {
						key,
						name: event.short_name || event.name || key,
						startDate: event.start_date ?? null,
						eventType: event.event_type ?? null,
						official: event.event_type !== 99 && event.event_type !== 100,
						rank: ranking?.rank ?? null,
						numTeams: status?.qual?.num_teams ?? null,
						qualRecord: ranking?.record ?? null,
						allianceStatus: stripHtml(status?.alliance_status_str) || null,
						playoffStatus: stripHtml(status?.playoff_status_str) || null,
						opr: oprs.get(key)?.oprs?.[teamKey] ?? null
					};
				})
				.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));

			return season
				? { team, name: season.name, epa: season.epa ?? null, record: season.record ?? null, events: teamEvents }
				: { team, name: null, epa: null, record: null, events: teamEvents };
		});

		res.json(results);
	} catch (error) {
		console.error("PRESCOUT ERROR:", error);
		res.status(500).json({ error: error.message });
	}
});

// Team numbers registered for an event (published on TBA before the event starts)
app.get("/api/events/:eventKey/teams", async (req, res) => {
	try {
		const keys = await tba(`/event/${encodeURIComponent(req.params.eventKey)}/teams/keys`);
		res.json(keys.map(key => Number(key.replace(/^frc/, ""))).sort((a, b) => a - b));
	} catch (error) {
		res.status(404).json({ error: `Event ${req.params.eventKey} was not found on The Blue Alliance.` });
	}
});

// A team's events in a given year
app.get("/api/teams/:teamKey/events/:year", async (req, res) => {
	try {
		res.json(await tba(`/team/${req.params.teamKey}/events/${req.params.year}`));
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
});

/* A team's season EPA/record/name. Uses the saved bulk Statbotics download when
   it has full ranks (instant), otherwise asks Statbotics for just this team. */
async function seasonSummary(teamNumber, year) {
	const state = teamYearsState.get(String(year));
	const saved = state?.byTeam?.get(Number(teamNumber));
	if (saved?.epa?.ranks?.country) return saved;
	return statbotics(`/team_year/${teamNumber}/${year}`).catch(() => saved ?? null);
}

// A team's whole season: every event they attended with rank, OPR and EPA
app.get("/api/teams/:teamNumber/season/:year", async (req, res) => {
	const { teamNumber, year } = req.params;
	const teamKey = `frc${teamNumber}`;

	let team;
	let events;

	// Start everything that doesn't need the event list right away, in parallel
	// with the team + event lookups (only the per-event OPRs have to wait).
	const statusesRequest = tba(`/team/${teamKey}/events/${year}/statuses`).catch(() => ({}));
	const teamYearRequest = seasonSummary(teamNumber, year);
	const teamEventsRequest = statbotics(`/team_events?team=${teamNumber}&year=${year}`).catch(() => []);

	try {
		[team, events] = await Promise.all([
			tba(`/team/${teamKey}`),
			tba(`/team/${teamKey}/events/${year}`)
		]);
	} catch (error) {
		return res.status(404).json({ error: `Team ${teamNumber} was not found on The Blue Alliance.` });
	}

	try {
		const [statuses, teamYear, teamEvents, eventOprs] = await Promise.all([
			statusesRequest,
			teamYearRequest,
			teamEventsRequest,
			Promise.all(events.map(event =>
				tba(`/event/${event.key}/oprs`).catch(() => null)
			))
		]);

		const epaByEvent = new Map(
			(Array.isArray(teamEvents) ? teamEvents : []).map(row => [row.event, row])
		);

		const seasonEvents = events
			.map((event, index) => {
				const status = statuses?.[event.key];
				const ranking = status?.qual?.ranking;
				const oprs = eventOprs[index];
				const teamEvent = epaByEvent.get(event.key);
				const breakdown = teamEvent?.epa?.breakdown;

				return {
					key: event.key,
					name: event.short_name || event.name,
					startDate: event.start_date,
					// TBA event types: 99 = offseason, 100 = preseason; everything else is official
					eventType: event.event_type,
					official: event.event_type !== 99 && event.event_type !== 100,
					rank: ranking?.rank ?? teamEvent?.record?.qual?.rank ?? null,
					numTeams: status?.qual?.num_teams ?? teamEvent?.record?.qual?.num_teams ?? null,
					qualRecord: ranking?.record ?? null,
					playoffRecord: status?.playoff?.record ?? null,
					allianceStatus: stripHtml(status?.alliance_status_str) || null,
					playoffStatus: stripHtml(status?.playoff_status_str) || null,
					opr: oprs?.oprs?.[teamKey] ?? null,
					dpr: oprs?.dprs?.[teamKey] ?? null,
					ccwm: oprs?.ccwms?.[teamKey] ?? null,
					epa: teamEvent?.epa?.total_points?.mean ?? teamEvent?.epa?.total_points ?? null,
					autoEpa: breakdown?.auto_points ?? null,
					teleopEpa: breakdown?.teleop_points ?? null,
					endgameEpa: breakdown?.endgame_points ?? null
				};
			})
			.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));

		res.json({
			team: Number(teamNumber),
			year: Number(year),
			name: teamYear?.name ?? team.nickname,
			epa: teamYear?.epa ?? null,
			record: teamYear?.record ?? null,
			events: seasonEvents
		});
	} catch (error) {
		console.error("SEASON ERROR:", error);
		res.status(500).json({ error: error.message });
	}
});

app.get("/api/scouting/:eventKey", async (req, res) => {
	console.log("SCOUTING ROUTE HIT");
	console.log("Event key:", req.params.eventKey);

	try {
		const { eventKey } = req.params;

		const spreadsheetId = spreadsheetIdForEvent(req.team, eventKey);

		console.log("Spreadsheet ID:", spreadsheetId);

		if (!spreadsheetId) {
			console.log("No spreadsheet configured");
			return res.json([]);
		}

		const tab = await sheetTab(spreadsheetId, "match");

		if (!tab) {
			return res.json([]);
		}

		const response = await readSheet(spreadsheetId, tab.simple ? `'${tab.title}'!A:ZZ` : `'${tab.title}'!A:AF`);

		console.log("Google Sheets request succeeded");

		res.json(rowsToObjects(response.data.values, tab.simple ? normalizeSimpleMatchRow : undefined));

	} catch (error) {
		console.error("SCOUTING ERROR:", error);

		res.status(500).json({
			error: error.message
		});
	}
});

app.get("/api/scouting/:eventKey/schema", async (req, res) => {
	try {
		const spreadsheetId = spreadsheetIdForEvent(req.team, req.params.eventKey);

		if (!spreadsheetId) {
			return res.status(404).json({ error: req.team.legacy ? "No scouting sheet is configured for this event." : "No Google Sheet is connected for this event yet. Add one in Team settings." });
		}

		const tab = await sheetTab(spreadsheetId, "match");
		if (!tab) return res.status(404).json({ error: noTabMessage("match", req) });

		const response = await readSheet(spreadsheetId, `'${tab.title}'!A:ZZ`);

		/* Keep blank cells: array index 0 must always remain column A.
		   Filtering blank headers shifts later columns (for example Y becomes B). */
		const rows = response.data.values ?? [];
		const headers = (rows[0] ?? [])
			.map(header => String(header).trim());

		if (!headers.some(Boolean)) {
			return res.status(500).json({ error: "The scouting sheet has no header row." });
		}

		const booleanColumnIndexes = headers
			.map((header, index) => {
				const values = rows
					.slice(1)
					.map(row => String(row[index] ?? "").trim().toUpperCase())
					.filter(Boolean);

				const looksYesNo = values.length && values.every(value =>
					value === "TRUE" || value === "FALSE"
				);

				return looksYesNo || (tab.simple && SIMPLE_MATCH_YES_NO.has(header))
					? index
					: null;
			})
			.filter(Number.isInteger);

		res.json({ headers, booleanColumnIndexes, fields: formFieldIndexes(headers, tab) });
	} catch (error) {
		console.error("SCOUTING SCHEMA ERROR:", error);
		res.status(500).json({ error: error.message });
	}
});

app.post("/api/scouting/:eventKey", async (req, res) => {
	try {
		const rejected = await checkSubmissionToken(req, "match");
		if (rejected) return res.status(rejected.status).json({ error: rejected.error });

		const spreadsheetId = spreadsheetIdForEvent(req.team, req.params.eventKey);

		if (!spreadsheetId) {
			return res.status(404).json({ error: req.team.legacy ? "No scouting sheet is configured for this event." : "No Google Sheet is connected for this event yet. Add one in Team settings." });
		}

		const answers = req.body?.answers;

		if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
			return res.status(400).json({ error: "A scouting response is required." });
		}

		const tab = await sheetTab(spreadsheetId, "match");
		if (!tab) return res.status(404).json({ error: noTabMessage("match", req) });

		const headerResponse = await sheets.spreadsheets.values.get({
			spreadsheetId,
			range: `'${tab.title}'!1:1`
		});

		const headers = (headerResponse.data.values?.[0] ?? [])
			.map(header => String(header).trim());

		if (!headers.length) {
			return res.status(500).json({ error: "The scouting sheet has no header row." });
		}

		/*
			Do not use values.append here. Google Sheets can detect the existing
			table starting in a later column when the earlier columns are blank,
			which shifts a scouting response into the wrong fields. Find the next
			row and explicitly write A through AF instead.
		*/
		const lastColumn = columnIndexToLetter(headers.length - 1);

		const existingRowsResponse = await sheets.spreadsheets.values.get({
			spreadsheetId,
			range: `'${tab.title}'!A:${lastColumn}`
		});

		const existingRows = existingRowsResponse.data.values ?? [];
		const lastUsedRowIndex = existingRows.reduce(
			(lastIndex, row, index) =>
				row.some(value => String(value ?? "").trim() !== "")
					? index
					: lastIndex,
			0
		);

		const nextRow = lastUsedRowIndex + 2;

		await sheets.spreadsheets.values.update({
			spreadsheetId,
			range: `'${tab.title}'!A${nextRow}:${lastColumn}${nextRow}`,
			valueInputOption: "USER_ENTERED",
			requestBody: {
				values: [headers.map((header, index) =>
					String(answers[`column-${index}`] ?? answers[`${index}`] ?? "")
				)]
			}
		});

		forgetSheet(spreadsheetId);
		if (req.team.legacy) supabaseMirror.scheduleSync(req.params.eventKey);
		res.status(201).json({ ok: true });
	} catch (error) {
		console.error("SCOUTING WRITE ERROR:", error);
		res.status(500).json({ error: error.message });
	}
});

app.get("/api/pitscouting/:eventKey", async (req, res) => {
	console.log("SCOUTING ROUTE HIT");
	console.log("Event key:", req.params.eventKey);

	try {
		const { eventKey } = req.params;

		const spreadsheetId = spreadsheetIdForEvent(req.team, eventKey);

		console.log("Spreadsheet ID:", spreadsheetId);

		if (!spreadsheetId) {
			console.log("No spreadsheet configured");
			return res.json([]);
		}

		const tab = await sheetTab(spreadsheetId, "pit");

		if (!tab) {
			return res.json([]);
		}

		const response = await readSheet(spreadsheetId, tab.simple ? `'${tab.title}'!A:ZZ` : `'${tab.title}'!A:AL`);

		console.log("Google Sheets request succeeded");

		res.json(rowsToObjects(response.data.values));

	} catch (error) {
		console.error("SCOUTING ERROR:", error);

		res.status(500).json({
			error: error.message
		});
	}
});

app.get("/api/pitscouting/:eventKey/schema", async (req, res) => {
	try {
		const spreadsheetId = spreadsheetIdForEvent(req.team, req.params.eventKey);

		if (!spreadsheetId) {
			return res.status(404).json({ error: req.team.legacy ? "No pit-scouting sheet is configured for this event." : "No Google Sheet is connected for this event yet. Add one in Team settings." });
		}

		const tab = await sheetTab(spreadsheetId, "pit");
		if (!tab) return res.status(404).json({ error: noTabMessage("pit", req) });

		const response = await readSheet(spreadsheetId, `'${tab.title}'!1:1`);

		/* Keep blank cells so array index 0 always remains column A,
		   otherwise the legacy form column letters point at the wrong questions. */
		const headers = (response.data.values?.[0] ?? [])
			.map(header => String(header).trim());

		if (!headers.some(Boolean)) {
			return res.status(500).json({ error: "The pit-scouting sheet has no header row." });
		}

		res.json({ headers, fields: formFieldIndexes(headers, tab) });
	} catch (error) {
		console.error("PIT SCOUTING SCHEMA ERROR:", error);
		res.status(500).json({ error: error.message });
	}
});

app.post("/api/pitscouting/:eventKey", async (req, res) => {
	try {
		const rejected = await checkSubmissionToken(req, "pit");
		if (rejected) return res.status(rejected.status).json({ error: rejected.error });

		const spreadsheetId = spreadsheetIdForEvent(req.team, req.params.eventKey);

		if (!spreadsheetId) {
			return res.status(404).json({ error: req.team.legacy ? "No pit-scouting sheet is configured for this event." : "No Google Sheet is connected for this event yet. Add one in Team settings." });
		}

		const answers = req.body?.answers;

		if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
			return res.status(400).json({ error: "A pit-scouting response is required." });
		}

		const tab = await sheetTab(spreadsheetId, "pit");
		if (!tab) return res.status(404).json({ error: noTabMessage("pit", req) });

		const headerResponse = await sheets.spreadsheets.values.get({
			spreadsheetId,
			range: `'${tab.title}'!1:1`
		});

		const headers = (headerResponse.data.values?.[0] ?? [])
			.map(header => String(header).trim());

		if (!headers.length) {
			return res.status(500).json({ error: "The pit-scouting sheet has no header row." });
		}

		await sheets.spreadsheets.values.append({
			spreadsheetId,
			range: tab.simple ? `'${tab.title}'!A:ZZ` : `'${tab.title}'!A:AL`,
			valueInputOption: "USER_ENTERED",
			insertDataOption: "INSERT_ROWS",
			requestBody: {
				/* Pit forms key answers by header; QR transfers key them by column. */
				values: [headers.map((header, index) =>
					String(answers[`column-${index}`] ?? answers[header] ?? "")
				)]
			}
		});

		forgetSheet(spreadsheetId);
		if (req.team.legacy) supabaseMirror.scheduleSync(req.params.eventKey);
		res.status(201).json({ ok: true });
	} catch (error) {
		console.error("PIT SCOUTING WRITE ERROR:", error);
		res.status(500).json({ error: error.message });
	}
});

app.get("/api/statbotics/team-event/:team/:event", async (req, res) => {
	const { team, event } = req.params;

	try {
		res.json(await statbotics(`/team_event/${encodeURIComponent(team)}/${encodeURIComponent(event)}`));
	} catch (error) {
		sendStatboticsError(res, error);
	}
});

app.get("/api/statbotics/event-teams/:event", async (req, res) => {
	const query = new URLSearchParams({ event: req.params.event, limit: "1000" });

	try {
		const data = await statbotics(`/team_events?${query}`);
		res.json(Array.isArray(data) ? data : []);
	} catch (error) {
		sendStatboticsError(res, error);
	}
});

app.get("/api/statbotics/team-matches/:team/:event", async (req, res) => {
	const { team, event } = req.params;
	const query = new URLSearchParams({ team, event, limit: "100" });

	try {
		res.json(await statbotics(`/matches?${query}`));
	} catch (error) {
		sendStatboticsError(res, error);
	}
});

// Fonts and images never change, so browsers can keep them for 30 days.
// Pages, scripts and styles still re-check every load so updates show straight away.
const staticOptions = {
	setHeaders: (res, filePath) => {
		if (/[\\/](fonts|images)[\\/]/.test(filePath)) {
			res.setHeader("Cache-Control", "public, max-age=2592000");
		} else {
			res.setHeader("Cache-Control", "no-cache");
		}
	}
};
app.use("/", express.static("public/index", staticOptions));
app.use(express.static("public", staticOptions));
const PORT = process.env.PORT || 3000;

// Whether the Supabase backup is on and when it last synced (no secrets).
app.get("/api/supabase/status", (req, res) => {
	res.json(supabaseMirror.status());
});

app.get("/health", (req, res) => {
	res.json({ ok: true });
});

app.listen(PORT, "0.0.0.0", () => {
	console.log(`Open http://localhost:${PORT}`);
});

startBehindTheBumpers(process.env.YOUTUBE_API_KEY);
supabaseMirror.start();

// Prescouting: load the saved Statbotics copy from disk now. Only download if
// there's no saved copy at all, and wait a minute first so it doesn't compete
// with the first people using the site. (A stale copy refreshes the next time
// the prescout page is used.)
loadSavedTeamYears(String(new Date().getFullYear())).then(hasCopy => {
	if (hasCopy) return;
	setTimeout(() => {
		teamYears(String(new Date().getFullYear())).catch(error =>
			console.error("Prescouting: first Statbotics download failed:", error.message)
		);
	}, 60 * 1000).unref();
});
