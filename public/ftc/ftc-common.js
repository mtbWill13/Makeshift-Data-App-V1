/* =================================
   FTC SHARED HELPERS
   Used by every page under /ftc/. Data comes from FTCScout via /api/ftc/*.
================================= */

/* Seasons are named by their starting year on FTCScout (2025 = 2025–26 DECODE).
   2025 is the newest season with results; add new seasons to the top. */
const FTC_SEASONS = [
	{ year: "2026", label: "2026–27 (upcoming)" },
	{ year: "2025", label: "2025–26 DECODE" },
	{ year: "2024", label: "2024–25 INTO THE DEEP" },
	{ year: "2023", label: "2023–24 CENTERSTAGE" }
];
const FTC_DEFAULT_SEASON = "2025";
const FTC_REGION = "CAON"; // FTCScout region code for Ontario
const FTC_SEASON_KEY = "season";

function ftcEscape(value) {
	return String(value ?? "").replace(/[&<>"']/g, character => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#39;"
	})[character]);
}

function ftcFormat(value, digits = 1) {
	return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function ftcRecord(stats) {
	if (!stats) return "—";
	return `${stats.wins}–${stats.losses}${stats.ties ? `–${stats.ties}` : ""}`;
}

async function ftcFetch(url) {
	const response = await fetch(url);
	const data = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(data.error || "Couldn't load FTC data.");
	return data;
}

function ftcParams() {
	return new URL(window.location).searchParams;
}

function ftcSetParams(values) {
	const url = new URL(window.location);
	for (const [key, value] of Object.entries(values)) {
		if (value === null || value === undefined || value === "") url.searchParams.delete(key);
		else url.searchParams.set(key, value);
	}
	window.history.replaceState({}, "", url);
}

/* Fills a season <select>, honouring ?season= in the URL. */
function ftcFillSeasons(select, fallback = FTC_DEFAULT_SEASON) {
	const wanted = ftcParams().get("season");
	select.innerHTML = FTC_SEASONS
		.map(season => `<option value="${season.year}">${ftcEscape(season.label)}</option>`)
		.join("");
	select.value = FTC_SEASONS.some(season => season.year === wanted) ? wanted : fallback;
}

/* Ontario events for a season, cached per page load. */
const ftcEventCache = new Map();
function ftcEvents(season) {
	if (!ftcEventCache.has(season)) {
		ftcEventCache.set(season, ftcFetch(`/api/ftc/events/${season}?region=${FTC_REGION}`).catch(() => []));
	}
	return ftcEventCache.get(season);
}

function ftcEventDate(event) {
	if (!event.start) return "";
	return new Date(`${event.start}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* Fills an event <select> with the season's Ontario events. Keeps (or adds, for
   this visit only) `keep`, so an event opened from elsewhere still shows. */
async function ftcFillEvents(select, season, { includeSeason = false, keep = null, keepName = null } = {}) {
	const events = await ftcEvents(season);
	const options = [];

	if (includeSeason) options.push(`<option value="${FTC_SEASON_KEY}">Entire Season (all events)</option>`);

	for (const event of events) {
		options.push(`<option value="${ftcEscape(event.code)}">${ftcEscape(event.name)}${event.official ? "" : " (scrimmage)"}${event.start ? ` · ${ftcEventDate(event)}` : ""}</option>`);
	}

	if (keep && keep !== FTC_SEASON_KEY && !events.some(event => event.code === keep)) {
		options.push(`<option value="${ftcEscape(keep)}" data-temporary="true">${ftcEscape(keepName || keep)}</option>`);
	}

	select.innerHTML = options.join("") || `<option value="">No Ontario events published for this season</option>`;

	if (keep && [...select.options].some(option => option.value === keep)) select.value = keep;
	return events;
}

function ftcTeamUrl(number, season, event = FTC_SEASON_KEY, eventName = null) {
	const params = new URLSearchParams({ team: number, season, event });
	if (eventName) params.set("name", eventName);
	return `/ftc/?${params}`;
}

function ftcEventUrl(season, code, team = null, eventName = null) {
	const params = new URLSearchParams({ season, event: code });
	if (team) params.set("team", team);
	if (eventName) params.set("name", eventName);
	return `/ftc/event/?${params}`;
}

/* One alliance row of a match card; `highlight` is shown in bold. */
function ftcAllianceRow(match, colour, highlight, season) {
	const side = match[colour];
	const teams = side.teams
		.map(team => {
			const label = String(team) === String(highlight)
				? `<strong>${ftcEscape(team)}</strong>`
				: ftcEscape(team);
			return `<a href="${ftcTeamUrl(team, season)}">${label}</a>`;
		})
		.join(" · ");

	return `
        <div class="match-alliance ${colour}${match.winner === colour ? " won" : ""}">
          <span>${teams || "—"}</span>
          <b>${match.played ? side.score : "—"}</b>
        </div>`;
}

function ftcResultBadge(match, team) {
	const colour = match.red.teams.some(number => String(number) === String(team)) ? "red" : "blue";
	const [kind, label] = !match.played
		? ["upcoming", "Upcoming"]
		: match.winner === "tie"
			? ["tie", "Tie"]
			: match.winner === colour
				? ["win", "Win"]
				: ["loss", "Loss"];
	return `<span class="match-result ${kind}">${label}</span>`;
}

/* The event's livestream for the day a match was played, if FTCScout has one. */
function ftcStreamFor(match, event) {
	const day = String(match.time ?? "").slice(0, 10);
	return event.livestreamsByDay?.find(stream => stream.day === day)?.url ?? event.liveStreamURL ?? null;
}

function ftcMatchCard(match, event, team, season) {
	const stream = ftcStreamFor(match, event);
	return `
      <article class="match-card">
        <div class="match-card-header">
          <span>${ftcEscape(match.label)}</span>
          ${team ? ftcResultBadge(match, team) : ""}
        </div>
        ${ftcAllianceRow(match, "red", team, season)}
        ${ftcAllianceRow(match, "blue", team, season)}
        <div class="match-card-videos">
          ${stream
		? `<span class="match-videos"><a href="${ftcEscape(stream)}" target="_blank" rel="noopener noreferrer">▶ Event livestream</a></span>`
		: `<span class="no-video">No livestream on FTCScout</span>`}
        </div>
      </article>`;
}

/* Runs fn over items with at most `limit` running at once. */
async function ftcMapLimit(items, limit, fn) {
	let next = 0;
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const index = next++;
			await fn(items[index], index);
		}
	}));
}
