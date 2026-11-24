/* =================================
   FTC PICKLIST
   Draft the order we want to pick teams in. The team list on the right is built from FTCScout
   (rank, OPR, averages) and our own match and pit scouting, and can be filtered and sorted. Teams
   are dragged into the lists on the left. Lists are saved in this browser, per event.
   (The drag-and-drop, filters, columns and printing are the FRC picklist's, unchanged.)
================================= */

const seasonSelect = document.getElementById("seasonSelect");
const eventKey = document.getElementById("eventKey");   // the event (code) dropdown
const status = document.getElementById("status");
const listsEl = document.getElementById("lists");
const poolEl = document.getElementById("pool");
const poolHead = document.getElementById("poolHead");
const poolCount = document.getElementById("poolCount");
const filtersEl = document.getElementById("filters");
const columnsEl = document.getElementById("columns");
const columnsSummary = document.getElementById("columnsSummary");
const clearFiltersButton = document.getElementById("clearFiltersButton");
const menu = document.getElementById("menu");
const search = document.getElementById("search");
const toggles = {
	hideUnscouted: document.getElementById("hideUnscouted")
};

/* Our FTC team gets highlighted in the lists. It is remembered in this browser (default: MakeShift Tech). */
const OUR_TEAM = (() => {
	try { return String(localStorage.getItem("makeshift-ftc-team") || "18433"); } catch { return "18433"; }
})();
/* An event's lists are kept per season and event code: the same code is reused every season. */
const eventToken = () => `${seasonSelect.value}-${eventKey.value}`;
const DISPLAY_COLUMNS = 5;
const PREFS_KEY = "makeshift-ftc-picklist-prefs";
const listsKey = event => `makeshift-ftc-picklist-${event}`;

const LIST_COLORS = ["green", "blue", "orange", "yellow", "red", "neutral"];
const DEFAULT_LISTS = [
	{ id: "captains", name: "Alliance Captains", color: "green" },
	{ id: "first", name: "1st Pick", color: "blue" },
	{ id: "second", name: "2nd Pick", color: "orange" },
	{ id: "defense", name: "Blockers / Defense", color: "yellow" },
	{ id: "dnp", name: "Do Not Pick", color: "red" }
];
const DEFAULT_COLUMNS = ["rank", "opr", "points", "tips", "teleParks"];

const customMode = false;  // the FRC picklist has a custom team list; FTC's equivalent is Prescouting
let teams = [];          // [{ number, name, stats: {key: number|null}, pit: {header: string}, reports }]
let stats = new Map();   // key → { label, title, group, digits, percent, lower, pit, kind, options }
let state = loadLists(eventToken());
let prefs = loadPrefs();
let loadId = 0;
const expanded = new Set(); // teams whose detail panel is open
const parking = document.createElement("div"); // holds open panels during a redraw
parking.hidden = true;
document.body.append(parking);


/* =================================
   HELPERS
================================= */

function escapeHtml(value) {
	return String(value ?? "").replace(/[&<>"']/g, character => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#39;"
	})[character]);
}

function finite(value) {
	if (value === null || value === undefined || String(value).trim() === "") return null;
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

function average(values) {
	const usable = values.filter(value => value !== null);
	return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function isBoolean(value) {
	return /^(true|false)$/i.test(String(value).trim());
}

function shortLabel(header) {
	const clean = header.replace(/\s+/g, " ").trim();
	return clean.length > 34 ? `${clean.slice(0, 32).trim()}…` : clean;
}

async function fetchJson(url) {
	const response = await fetch(url);
	const data = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(data.error || `Could not load ${url}.`);
	return data;
}

function storageGet(key) {
	try {
		return JSON.parse(localStorage.getItem(key));
	} catch {
		return null;
	}
}

function storageSet(key, value) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		/* Private mode or full storage; the page still works for this visit. */
	}
}

function defaultLists() {
	return DEFAULT_LISTS.map(list => ({ ...list, entries: [] }));
}

function loadLists(event) {
	const saved = storageGet(listsKey(event));
	return saved && Array.isArray(saved.lists)
		? { lists: saved.lists, taken: Array.isArray(saved.taken) ? saved.taken : [] }
		: { lists: defaultLists(), taken: [] };
}

function saveLists() {
	storageSet(listsKey(eventToken()), state);
}

function loadPrefs() {
	const saved = storageGet(PREFS_KEY) ?? {};
	return {
		columns: Array.isArray(saved.columns) ? saved.columns : [...DEFAULT_COLUMNS],
		sort: saved.sort ?? { key: "opr", dir: -1 },
		filters: Array.isArray(saved.filters) ? saved.filters : [],
		toggles: saved.toggles ?? {}
	};
}

function savePrefs() {
	prefs.toggles = Object.fromEntries(Object.entries(toggles).map(([key, input]) => [key, input.checked]));
	storageSet(PREFS_KEY, prefs);
}

function teamByNumber(number) {
	return teams.find(team => team.number === String(number));
}

function listsContaining(number) {
	return state.lists.filter(list => list.entries.some(entry => entry.team === String(number)));
}

function isTaken(number) {
	return state.taken.includes(String(number));
}


/* =================================
   DATA
================================= */

let game = null;
const fieldsOf = kind => game[kind].sections.flatMap(section => section.fields.map(field => ({ ...field, section: section.title })));
const optionLabel = (field, value) => field.options?.find(option => option.value === value)?.label ?? value;

function addStat(key, stat) {
	stats.set(key, { digits: 1, group: "Event", lower: false, percent: false, kind: "number", ...stat });
}

/* Smaller is better for these (breakdowns, fouls, no-shows). */
const LOWER_IS_BETTER = new Set(["breakdown", "minorFouls", "majorFouls"]);

/* The fixed stats, plus one for every counter, yes/no and rating the match form asks. */
function buildStats() {
	stats = new Map();
	addStat("rank", { label: "Rank", title: "Qualification rank (FTCScout)", digits: 0, lower: true });
	addStat("winRate", { label: "Win rate", title: "Qualification win rate", percent: true });
	addStat("opr", { label: "OPR", title: "Offensive power rating, penalties left out (FTCScout)" });
	addStat("autoOpr", { label: "Auto OPR", group: "FTCScout" });
	addStat("teleopOpr", { label: "Teleop OPR", group: "FTCScout" });
	addStat("avgScore", { label: "Avg score", title: "Average alliance score, penalties left out", group: "FTCScout" });
	addStat("rp", { label: "Avg RP", title: "Average ranking points per match", group: "FTCScout" });

	const scouting = { group: "Match scouting" };
	addStat("reports", { ...scouting, label: "Reports", title: "Match scouting reports", digits: 0 });
	addStat("points", { ...scouting, label: "Est. points", title: "Points per match from our reports, using the game's point values" });
	addStat("tips", { ...scouting, label: "Hive tips", title: "Hive tips per match" });
	addStat("pieces", { ...scouting, label: "Scored", title: "Pollen and nectar scored per match" });
	addStat("autoPieces", { ...scouting, label: "Auto scored", title: "Pollen and nectar scored in auto per match" });
	addStat("telePieces", { ...scouting, label: "Teleop scored", title: "Pollen and nectar scored in teleop per match" });
	addStat("pollenAcc", { ...scouting, label: "Pollen acc.", title: "Teleop pollen scored / shot", percent: true });
	addStat("nectarAcc", { ...scouting, label: "Nectar acc.", title: "Teleop nectar scored / shot", percent: true });
	addStat("noShowRate", { ...scouting, label: "No show %", percent: true, lower: true });

	for (const field of fieldsOf("match")) {
		const lower = LOWER_IS_BETTER.has(field.id);
		if (field.type === "count") addStat(`avg:${field.id}`, { ...scouting, label: `Avg ${shortLabel(field.label)}`, title: `${field.section}: ${field.label} per match`, lower });
		else if (field.type === "yesno") addStat(field.id, { ...scouting, label: `${shortLabel(field.label)} %`, title: `${field.label} (% of played matches)`, percent: true, lower });
		else if (field.type === "scale") addStat(`avg:${field.id}`, { ...scouting, label: `Avg ${shortLabel(field.label)}`, title: `${field.label} (1 poor, 5 excellent)` });
	}

	for (const field of fieldsOf("pit")) {
		const kind = field.type === "yesno" ? "bool" : field.type === "choice" ? "choice" : "text";
		stats.set(`pit:${field.label}`, {
			label: shortLabel(field.label), title: field.label, group: "Pit scouting", pit: true, kind,
			options: field.type === "choice" ? field.options.map(option => option.label) : [], column: field.label
		});
	}
}

/* Stats from one team's match reports. */
function scoutingStats(reports) {
	const played = reports.filter(report => report.noShow !== "yes");
	const fields = fieldsOf("match");
	const ranking = game.match.rankingPoints;
	const points = game.match.points;
	const count = (report, ids) => ids.reduce((total, id) => total + (Number(report.data[id]) || 0), 0);
	const worth = (report, id, value) => report.data[id] === "yes" ? value : (Number(report.data[id]) || 0) * value;
	const scored = fields.filter(field => field.type === "count" && /Scored$/.test(field.id)).map(field => field.id);
	const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
	const per = measure => played.length ? mean(played.map(measure)) : null;

	const accuracy = (scoredIds, shotIds) => {
		const hit = played.reduce((total, report) => total + count(report, scoredIds), 0);
		const shot = played.reduce((total, report) => total + count(report, shotIds), 0);
		return shot ? hit / shot * 100 : null;
	};

	const result = {
		reports: reports.length,
		noShowRate: reports.length ? (reports.length - played.length) / reports.length * 100 : null,
		points: Object.keys(points).length ? per(report => Object.entries(points).reduce((total, [id, value]) => total + worth(report, id, value), 0)) : null,
		tips: per(report => count(report, ranking.tipFields)),
		pieces: per(report => count(report, scored)),
		autoPieces: per(report => count(report, scored.filter(id => id.startsWith("auto")))),
		telePieces: per(report => count(report, scored.filter(id => id.startsWith("tele")))),
		pollenAcc: accuracy(["telePollenHiveScored", "telePollenFlowerScored", "telePollenGardenScored"], ["telePollenHiveShot", "telePollenFlowerShot", "telePollenGardenShot"]),
		nectarAcc: accuracy(["teleNectarFlowerScored", "teleNectarHiveScored", "teleNectarGardenScored"], ["teleNectarFlowerShot", "teleNectarHiveShot", "teleNectarGardenShot"])
	};

	for (const field of fields) {
		const answers = played.map(report => report.data[field.id]).filter(value => value !== undefined);
		if (field.type === "count" || field.type === "scale") result[`avg:${field.id}`] = answers.length ? mean(answers.map(Number)) : null;
		else if (field.type === "yesno") result[field.id] = answers.length ? answers.filter(value => value === "yes").length / answers.length * 100 : null;
	}

	return result;
}

/* A team's pit answers as plain text (yes/no as TRUE/FALSE, like the FRC filters expect). */
function pitAnswers(report) {
	if (!report) return {};
	return Object.fromEntries(fieldsOf("pit").map(field => {
		const value = report.data[field.id];
		const text = value === undefined ? ""
			: field.type === "yesno" ? (value === "yes" ? "TRUE" : "FALSE")
				: field.type === "choice" ? optionLabel(field, value)
					: field.type === "multi" ? value.map(item => optionLabel(field, item)).join("; ")
						: String(value);
		return [field.label, text];
	}));
}

function buildTeams({ event, reports }) {
	buildStats();
	const byTeam = new Map();
	const touch = number => byTeam.get(number) ?? byTeam.set(number, { number, name: "", entry: null, match: [], pit: null }).get(number);

	for (const entry of event?.teams ?? []) Object.assign(touch(String(entry.number)), { name: entry.name ?? "", entry });
	for (const report of reports.match) touch(String(report.team)).match.push(report);
	for (const report of reports.pit) touch(String(report.team)).pit ??= report;   // newest first: the latest pit report wins

	teams = [...byTeam.values()].map(item => {
		const stat = item.entry?.stats;
		const played = stat ? stat.wins + stat.losses + stat.ties : 0;
		return {
			number: item.number,
			name: item.name,
			pit: pitAnswers(item.pit),
			stats: {
				rank: finite(stat?.rank),
				winRate: played ? (stat.wins + stat.ties / 2) / played * 100 : null,
				opr: finite(stat?.opr?.total),
				autoOpr: finite(stat?.opr?.auto),
				teleopOpr: finite(stat?.opr?.teleop),
				avgScore: finite(stat?.avg?.total),
				rp: finite(stat?.rp),
				...scoutingStats(item.match)
			}
		};
	});

	/* Values in the top quarter of the event are highlighted. */
	for (const [key, stat] of stats) {
		if (stat.pit) continue;
		const values = teams.map(team => team.stats[key]).filter(value => value !== null && value !== undefined)
			.sort((a, b) => (stat.lower ? a - b : b - a));
		const cutoff = values.length >= 4 ? values[Math.ceil(values.length / 4) - 1] : null;
		const worst = values.at(-1);
		for (const team of teams) {
			const value = team.stats[key] ?? null;
			team.top ??= {};
			team.top[key] = cutoff !== null && value !== null && value !== worst && (stat.lower ? value <= cutoff : value >= cutoff);
		}
	}
}

function teamNumberOf(value) {
	const match = String(value ?? "").match(/\d+/);
	return match ? match[0] : null;
}

async function loadEvent() {
	const season = seasonSelect.value;
	const code = eventKey.value;
	const thisLoad = ++loadId;
	if (!code) {
		teams = [];
		render();
		status.textContent = "Pick an event.";
		return;
	}

	const url = new URL(window.location);
	url.searchParams.set("season", season);
	url.searchParams.set("event", code);
	window.history.replaceState({}, "", url);

	status.textContent = "Loading event data…";
	game ??= await fetchJson("/api/ftc/game");

	const settle = (promise, fallback) => promise.catch(() => fallback);
	const [event, reports] = await Promise.all([
		settle(fetchJson(`/api/ftc/event/${season}/${encodeURIComponent(code)}`), null),
		settle(fetchJson(`/api/ftc/scouting/${season}/${encodeURIComponent(code)}/reports`), { match: [], pit: [] })
	]);
	if (thisLoad !== loadId) return;

	buildTeams({ event, reports });
	render();
	status.textContent = teams.length
		? `${teams.length} teams • ${reports.match.length} match reports • ${reports.pit.length} pit reports${event ? "" : " • FTCScout doesn't know this event, so only scouted teams are listed"}.`
		: "No teams found for this event yet.";
}


/* =================================
   FILTERS + SORT
================================= */

const NUMBER_OPS = { gte: "≥", lte: "≤", eq: "=", top: "Best N", bottom: "Worst N", has: "Has data", none: "No data" };
const BOOL_OPS = { yes: "is Yes", no: "is No", none: "Not answered" };
const CHOICE_OPS = { is: "is", not: "is not" };
const TEXT_OPS = { contains: "contains", excludes: "doesn't contain", has: "Answered", none: "Not answered" };

function opsFor(stat) {
	if (!stat?.pit) return NUMBER_OPS;
	return stat.kind === "bool" ? BOOL_OPS : stat.kind === "choice" ? CHOICE_OPS : TEXT_OPS;
}

function needsValue(stat, op) {
	return !["has", "none", "yes", "no"].includes(op);
}

/* Best/worst N cut-off, worked out over the whole field. */
function rankCutoff(key, count, best) {
	const stat = stats.get(key);
	const values = teams.map(team => team.stats[key]).filter(value => value !== null)
		.sort((a, b) => (stat.lower === best ? a - b : b - a));
	return values[Math.min(values.length, Math.max(1, count)) - 1];
}

function passesFilter(team, filter) {
	const stat = stats.get(filter.key);
	if (!stat) return true;

	if (stat.pit) {
		const answer = team.pit[stat.column] ?? "";
		const value = String(filter.value ?? "").trim().toLowerCase();
		switch (filter.op) {
			case "yes": return answer.toUpperCase() === "TRUE";
			case "no": return answer.toUpperCase() === "FALSE";
			case "none": return answer === "";
			case "has": return answer !== "";
			case "is": return !value || answer.toLowerCase() === value;
			case "not": return !value || answer.toLowerCase() !== value;
			case "contains": return !value || answer.toLowerCase().includes(value);
			case "excludes": return !value || !answer.toLowerCase().includes(value);
			default: return true;
		}
	}

	const value = team.stats[filter.key];
	const target = finite(filter.value);
	if (filter.op === "has") return value !== null;
	if (filter.op === "none") return value === null;
	if (target === null) return true;
	if (value === null) return false;

	switch (filter.op) {
		case "gte": return value >= target;
		case "lte": return value <= target;
		case "eq": return Math.abs(value - target) < (stat.digits === 0 ? 0.5 : 0.05);
		case "top": {
			const cutoff = rankCutoff(filter.key, target, true);
			return stat.lower ? value <= cutoff : value >= cutoff;
		}
		case "bottom": {
			const cutoff = rankCutoff(filter.key, target, false);
			return stat.lower ? value >= cutoff : value <= cutoff;
		}
		default: return true;
	}
}

function availableTeams() {
	return teams.filter(team => !listsContaining(team.number).length);
}

function visibleTeams() {
	const query = search.value.trim().toLowerCase();

	/* Teams that have been placed in a list leave the team list. */
	return availableTeams().filter(team => {
		if (query && !team.number.includes(query) && !team.name.toLowerCase().includes(query)) return false;
		if (toggles.hideUnscouted.checked && !team.stats.reports) return false;
		return prefs.filters.every(filter => passesFilter(team, filter));
	});
}

function sortValue(team, key) {
	if (key === "team") return Number(team.number);
	const stat = stats.get(key);
	if (stat?.pit) return team.pit[stat.column] || null;
	return team.stats[key] ?? null;
}

function sortedTeams(list) {
	const { key, dir } = prefs.sort;
	return [...list].sort((a, b) => {
		const left = sortValue(a, key);
		const right = sortValue(b, key);
		if (left === null && right === null) return Number(a.number) - Number(b.number);
		if (left === null) return 1;
		if (right === null) return -1;
		const order = typeof left === "string" ? left.localeCompare(right) : left - right;
		return dir * order || Number(a.number) - Number(b.number);
	});
}


/* =================================
   RENDER
================================= */

function formatStat(team, key) {
	const stat = stats.get(key);
	if (!stat) return "—";
	if (stat.pit) {
		const answer = team.pit[stat.column] ?? "";
		if (!answer) return "—";
		if (stat.kind === "bool") return answer.toUpperCase() === "TRUE" ? "Yes" : "No";
		return answer;
	}
	const value = team.stats[key];
	if (value === null || value === undefined) return "—";
	return stat.percent ? `${Math.round(value)}%` : value.toFixed(stat.digits);
}

function statOptions(selected) {
	const groups = new Map();
	for (const [key, stat] of stats) {
		if (!groups.has(stat.group)) groups.set(stat.group, []);
		groups.get(stat.group).push(`<option value="${escapeHtml(key)}"${key === selected ? " selected" : ""} title="${escapeHtml(stat.title ?? stat.label)}">${escapeHtml(stat.label)}</option>`);
	}
	return [...groups].map(([group, options]) => `<optgroup label="${escapeHtml(group)}">${options.join("")}</optgroup>`).join("");
}

function sortArrow(key) {
	return prefs.sort.key === key ? `<span class="sort-arrow">${prefs.sort.dir === 1 ? "▲" : "▼"}</span>` : "";
}

function headerCell(key, label, title, extraClass = "") {
	const active = prefs.sort.key === key ? " active" : "";
	return `<button class="col-head${extraClass}${active}" type="button" data-sort="${escapeHtml(key)}" title="Sort by ${escapeHtml(title)}">${escapeHtml(label)}${sortArrow(key)}</button>`;
}

/* A team's dashboard: for a custom list that's their whole season. */
function teamLink(number) {
	return `/ftc/?${new URLSearchParams({ season: seasonSelect.value, event: eventKey.value, team: number })}`;
}

function renderPool() {
	if (!teams.length) {
		poolHead.innerHTML = "";
		poolEl.innerHTML = `<div class="empty-state">${loadId ? "No teams to show yet." : "Loading…"}</div>`;
		poolCount.textContent = "";
		return;
	}

	const available = availableTeams().length;
	const placed = teams.length - available;
	const shown = sortedTeams(visibleTeams());
	poolCount.textContent = shown.length === available
		? `${available} available${placed ? ` · ${placed} placed` : ""}`
		: `Showing ${shown.length} of ${available} available`;

	const header = `
		<div class="pool-row pool-header">
			<span></span>
			<span class="col-head position-head">#</span>
			${headerCell("team", "Team", "team number", " team-head")}
			${prefs.columns.map(key => {
				const stat = stats.get(key);
				return headerCell(key, stat?.label ?? key, stat?.title ?? stat?.label ?? key);
			}).join("")}
			<span></span>
		</div>`;

	const rows = shown.map((team, index) => `
		<div class="pool-row${team.number === OUR_TEAM ? " is-us" : ""}${expanded.has(team.number) ? " expanded" : ""}" data-drag data-team="${team.number}">
			<span class="grip" aria-hidden="true">⠿</span>
			<span class="pool-position">${index + 1}</span>
			<div class="pool-team">
				<a href="${teamLink(team.number)}" draggable="false" target="_blank" rel="noopener">${team.number}</a>
				${team.name ? `<span class="pool-name" title="${escapeHtml(team.name)}">${escapeHtml(team.name)}</span>` : ""}
			</div>
			${prefs.columns.map(key => {
				const stat = stats.get(key);
				const value = formatStat(team, key);
				const classes = ["stat", stat?.pit ? "text-stat" : "", team.top?.[key] ? "good" : "", value === "—" ? "empty" : ""].filter(Boolean).join(" ");
				return `<span class="${classes}" title="${escapeHtml(stat?.label ?? "")}: ${escapeHtml(value)}">${escapeHtml(value)}</span>`;
			}).join("")}
			<button class="expand-button" type="button" data-expand="${team.number}" aria-expanded="${expanded.has(team.number)}" aria-label="Show details for ${team.number}" title="Show team details">▾</button>
			<button class="add-button" type="button" data-menu="${team.number}" aria-label="Add ${team.number} to a list" title="Add to a list">+</button>
		</div>
		${expanded.has(team.number) ? teamDetails(team) : ""}`).join("");

	const empty = available
		? `<div class="empty-state">No teams match these filters.</div>`
		: `<div class="empty-state">Every team has been placed in a list.</div>`;
	/* Keep open detail panels instead of reloading them on every redraw.
	   moveBefore() moves an iframe without reloading it (Chrome); elsewhere the
	   panel reloads, which still works. */
	const keep = Element.prototype.moveBefore ? new Map() : null;
	if (keep) {
		for (const panel of poolEl.querySelectorAll(".team-details")) {
			if (!expanded.has(panel.dataset.details)) continue;
			parking.moveBefore(panel, null);
			keep.set(panel.dataset.details, panel);
		}
	}

	/* The column names live in their own bar so they stay in view while the
	   page scrolls (the list's sideways scroll would stop them sticking). */
	poolHead.innerHTML = `<div class="pool-table">${header}</div>`;
	poolEl.innerHTML = `<div class="pool-table">${rows || empty}</div>`;
	poolHead.scrollLeft = poolEl.scrollLeft;

	if (keep) {
		for (const fresh of poolEl.querySelectorAll(".team-details")) {
			const old = keep.get(fresh.dataset.details);
			if (!old) continue;
			fresh.parentNode.moveBefore(old, fresh);
			fresh.remove();
			keep.delete(fresh.dataset.details);
		}
		for (const old of keep.values()) old.remove();
	}
}

/* The main team page, framed in its compact ?embed=1 layout. */
function teamDetails(team) {
	const embed = `/ftc/?${new URLSearchParams({ season: seasonSelect.value, event: eventKey.value, team: team.number, embed: "1" })}`;
	return `
		<div class="team-details" data-details="${team.number}">
			<div class="details-bar">
				<strong>${team.number}${team.name ? ` · ${escapeHtml(team.name)}` : ""}</strong>
				<a href="${teamLink(team.number)}" target="_blank" rel="noopener">Open full page ↗</a>
				<button class="secondary-button small" type="button" data-expand="${team.number}">Close</button>
			</div>
			<iframe src="${embed}" title="Team ${team.number} details" loading="lazy"></iframe>
		</div>`;
}

function renderColumns() {
	columnsEl.innerHTML = prefs.columns.map((key, index) => `
		<label class="column-picker">
			<span>Column ${index + 1}</span>
			<select data-column="${index}">${statOptions(key)}</select>
		</label>`).join("") +
		`<button class="secondary-button small" type="button" data-reset-columns>Reset to default</button>`;
	columnsSummary.textContent = prefs.columns.map(key => stats.get(key)?.label ?? key).join(" · ");
}

function entrySummary(team) {
	if (!team) return "";
	const parts = prefs.columns.slice(0, 3)
		.filter(key => !stats.get(key)?.pit)
		.map(key => `${stats.get(key)?.label ?? key} ${formatStat(team, key)}`);
	return parts.join(" · ");
}

function renderLists() {
	listsEl.innerHTML = state.lists.map(list => `
		<article class="list-card color-${list.color}" data-list="${escapeHtml(list.id)}">
			<div class="list-header">
				<button class="color-dot" type="button" data-color="${escapeHtml(list.id)}" aria-label="Change colour"></button>
				<input class="list-name" value="${escapeHtml(list.name)}" data-rename="${escapeHtml(list.id)}" aria-label="List name">
				<span class="list-count">${list.entries.length}</span>
				<button class="icon-button" type="button" data-delete-list="${escapeHtml(list.id)}" aria-label="Delete list" title="Delete list">✕</button>
			</div>
			<ol class="entries">
				${list.entries.map((entry, index) => {
					const team = teamByNumber(entry.team);
					return `
					<li class="entry${isTaken(entry.team) ? " taken" : ""}" data-drag data-team="${escapeHtml(entry.team)}" data-from="${escapeHtml(list.id)}">
						<span class="position">${index + 1}</span>
						<span class="grip" aria-hidden="true">⠿</span>
						<div class="entry-main">
							<div class="entry-title">
								<a href="${teamLink(entry.team)}" draggable="false" target="_blank" rel="noopener">${escapeHtml(entry.team)}</a>
								<span class="entry-stats">${escapeHtml(entrySummary(team))}</span>
							</div>
							<input class="note" value="${escapeHtml(entry.note ?? "")}" placeholder="Add a note" data-note="${escapeHtml(list.id)}" aria-label="Note for ${escapeHtml(entry.team)}">
						</div>
						<button class="icon-button take-button" type="button" data-take="${escapeHtml(entry.team)}" aria-pressed="${isTaken(entry.team)}" title="${isTaken(entry.team) ? "Taken — click to undo" : "Mark as taken"}">✓</button>
						<button class="icon-button" type="button" data-remove="${escapeHtml(list.id)}" aria-label="Remove ${escapeHtml(entry.team)}" title="Remove">✕</button>
					</li>`;
				}).join("")}
			</ol>
			<div class="drop-slot">Drop a team here</div>
		</article>`).join("");
}

function renderFilters() {
	clearFiltersButton.hidden = !prefs.filters.length;
	filtersEl.innerHTML = prefs.filters.map((filter, index) => {
		const stat = stats.get(filter.key);
		const ops = opsFor(stat);
		let valueInput = "";

		if (stat && needsValue(stat, filter.op)) {
			if (stat.pit && stat.kind === "choice") {
				valueInput = `<select data-filter-value="${index}"><option value="">Any</option>${stat.options.map(option => `<option${option === filter.value ? " selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select>`;
			} else {
				const type = stat.pit ? "text" : "number";
				const placeholder = stat.pit ? "Text" : filter.op === "top" || filter.op === "bottom" ? "N" : stat.percent ? "%" : "Value";
				valueInput = `<input type="${type}" step="any" value="${escapeHtml(filter.value ?? "")}" placeholder="${placeholder}" data-filter-value="${index}">`;
			}
		}

		return `
		<div class="filter-row">
			<span class="filter-where">${index ? "and" : "Where"}</span>
			<select data-filter-key="${index}" aria-label="Filter stat">${statOptions(filter.key)}</select>
			<select data-filter-op="${index}" aria-label="Filter condition">${Object.entries(ops).map(([op, label]) => `<option value="${op}"${op === filter.op ? " selected" : ""}>${label}</option>`).join("")}</select>
			${valueInput || "<span></span>"}
			<button class="icon-button" type="button" data-remove-filter="${index}" aria-label="Remove filter">✕</button>
		</div>`;
	}).join("");
}

function render() {
	/* Swap out columns for stats this event doesn't have. */
	if (stats.size) {
		prefs.columns = prefs.columns.map((key, index) => stats.has(key) ? key : DEFAULT_COLUMNS[index]);
	}
	renderLists();
	renderFilters();
	renderColumns();
	renderPool();
}


/* =================================
   LIST CHANGES
================================= */

function listById(id) {
	return state.lists.find(list => list.id === id);
}

/* Puts `team` at `index` of list `toId`. A team is only ever in one list, so
   it comes out of wherever it was (keeping its note). */
function placeTeam(team, toId, index) {
	team = String(team);
	const target = listById(toId);
	if (!target) return;

	let note = "";
	for (const list of state.lists) {
		const at = list.entries.findIndex(entry => entry.team === team);
		if (at === -1) continue;
		note ||= list.entries[at].note ?? "";
		list.entries.splice(at, 1);
	}

	target.entries.splice(Math.max(0, Math.min(index, target.entries.length)), 0, { team, note });
	saveLists();
	render();
}

function removeTeam(team, listId) {
	const list = listById(listId);
	if (!list) return;
	list.entries = list.entries.filter(entry => entry.team !== String(team));
	saveLists();
	render();
}

function toggleTaken(team) {
	team = String(team);
	state.taken = isTaken(team) ? state.taken.filter(number => number !== team) : [...state.taken, team];
	saveLists();
	render();
}


/* =================================
   DRAG AND DROP
   Pointer events rather than HTML drag-and-drop so it works with touch too.
   On touch screens a drag starts from the ⠿ handle, so the page still scrolls.
================================= */

let drag = null;
let suppressClick = false;

function dropTarget(x, y) {
	const element = document.elementFromPoint(x, y);
	const card = element?.closest(".list-card");

	if (card) {
		const entries = [...card.querySelectorAll(".entry:not(.drag-source)")];
		const index = entries.filter(entry => {
			const box = entry.getBoundingClientRect();
			return box.top + box.height / 2 < y;
		}).length;
		return { listId: card.dataset.list, index, card, before: entries[index] ?? null };
	}

	if (drag.fromList && element?.closest(".pool-pane")) return { pool: true };
	return null;
}

function showTarget(target) {
	document.querySelector(".drop-marker")?.remove();
	document.querySelectorAll(".drop-over").forEach(element => element.classList.remove("drop-over"));
	if (!target) return;

	if (target.pool) {
		document.querySelector(".pool-pane").classList.add("drop-over");
		return;
	}

	target.card.classList.add("drop-over");
	const marker = document.createElement("li");
	marker.className = "drop-marker";
	const entries = target.card.querySelector(".entries");
	entries.insertBefore(marker, target.before);
}

function autoScroll() {
	if (!drag?.active) return;
	const edge = 70;
	const { x, y } = drag;
	const speed = distance => Math.ceil((edge - distance) / 4);

	const pane = document.querySelector(".lists-pane");
	const box = pane.getBoundingClientRect();
	const paneScrolls = pane.scrollHeight > pane.clientHeight && x >= box.left && x <= box.right;

	if (paneScrolls && y < box.top + edge && pane.scrollTop > 0) pane.scrollTop -= speed(y - box.top);
	else if (paneScrolls && y > box.bottom - edge && pane.scrollTop + pane.clientHeight < pane.scrollHeight) pane.scrollTop += speed(box.bottom - y);
	else if (y < edge) window.scrollBy(0, -speed(y));
	else if (y > window.innerHeight - edge) window.scrollBy(0, speed(window.innerHeight - y));

	drag.target = dropTarget(x, y);
	showTarget(drag.target);
	requestAnimationFrame(autoScroll);
}

function startDrag() {
	drag.active = true;
	drag.source.classList.add("drag-source");
	document.body.classList.add("dragging");

	const ghost = document.createElement("div");
	ghost.className = "drag-ghost";
	const team = teamByNumber(drag.team);
	ghost.innerHTML = `<strong>${escapeHtml(drag.team)}</strong>${team?.name ? `<span>${escapeHtml(team.name)}</span>` : ""}`;
	document.body.append(ghost);
	drag.ghost = ghost;
	requestAnimationFrame(autoScroll);
}

function endDrag(commit) {
	if (!drag) return;
	const { active, target, team, fromList, ghost, source } = drag;
	ghost?.remove();
	source.classList.remove("drag-source");
	document.body.classList.remove("dragging");
	showTarget(null);
	drag = null;

	if (!active || !commit) return;
	suppressClick = true;
	setTimeout(() => { suppressClick = false; }, 0);

	if (target?.pool) removeTeam(team, fromList);
	else if (target) placeTeam(team, target.listId, target.index);
}

document.addEventListener("pointerdown", event => {
	if (event.button !== 0 || drag) return;
	const source = event.target.closest("[data-drag]");
	if (!source || event.target.closest("input, select, button, textarea")) return;
	const onGrip = event.target.closest(".grip");
	if (event.pointerType !== "mouse" && !onGrip) return;
	if (event.pointerType === "mouse") event.preventDefault();

	drag = {
		team: source.dataset.team,
		fromList: source.dataset.from ?? null,
		source,
		startX: event.clientX,
		startY: event.clientY,
		x: event.clientX,
		y: event.clientY,
		pointerId: event.pointerId,
		active: false,
		target: null
	};
});

document.addEventListener("pointermove", event => {
	if (!drag || event.pointerId !== drag.pointerId) return;
	drag.x = event.clientX;
	drag.y = event.clientY;

	if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) > 6) startDrag();
	if (!drag.active) return;

	event.preventDefault();
	drag.ghost.style.transform = `translate(${drag.x + 12}px, ${drag.y + 12}px)`;
	drag.target = dropTarget(drag.x, drag.y);
	showTarget(drag.target);
}, { passive: false });

document.addEventListener("pointerup", event => {
	if (drag && event.pointerId === drag.pointerId) endDrag(true);
});
document.addEventListener("pointercancel", () => endDrag(false));
document.addEventListener("keydown", event => {
	if (event.key === "Escape") {
		endDrag(false);
		closeMenu();
	}
});

/* A drag that ends over a link shouldn't open it. */
document.addEventListener("click", event => {
	if (suppressClick) {
		event.preventDefault();
		event.stopPropagation();
	}
}, true);


/* =================================
   ADD MENU (tap alternative to dragging)
================================= */

function openMenu(team, button) {
	menu.innerHTML = `<div class="menu-title">Add ${escapeHtml(team)} to…</div>${state.lists.map(list =>
		`<button type="button" data-menu-add="${escapeHtml(list.id)}"><i class="color-${list.color}"></i>${escapeHtml(list.name)}<span class="menu-count">${list.entries.length ? `#${list.entries.length + 1}` : "#1"}</span></button>`
	).join("")}`;
	menu.dataset.team = team;
	menu.hidden = false;

	const box = button.getBoundingClientRect();
	const width = menu.offsetWidth;
	const height = menu.offsetHeight;
	const left = Math.max(8, Math.min(box.right - width, window.innerWidth - width - 8));
	const top = box.bottom + height + 8 > window.innerHeight ? box.top - height - 6 : box.bottom + 6;
	menu.style.left = `${left}px`;
	menu.style.top = `${Math.max(8, top)}px`;
}

function closeMenu() {
	menu.hidden = true;
}

menu.addEventListener("click", event => {
	const team = menu.dataset.team;
	const add = event.target.closest("[data-menu-add]");
	if (!add) return;
	closeMenu();
	placeTeam(team, add.dataset.menuAdd, Infinity);
});

document.addEventListener("click", event => {
	if (!menu.hidden && !menu.contains(event.target) && !event.target.closest("[data-menu]")) closeMenu();
});
window.addEventListener("scroll", closeMenu, { passive: true });


/* =================================
   EVENTS
================================= */

/* Clicking a column name sorts by it; clicking again flips the order.
   First click sorts best-first (lowest first for rank, team number and text). */
function sortBy(key) {
	const lowerFirst = key === "team" || stats.get(key)?.lower || stats.get(key)?.pit;
	prefs.sort = prefs.sort.key === key
		? { key, dir: -prefs.sort.dir }
		: { key, dir: lowerFirst ? 1 : -1 };
	savePrefs();
	renderPool();
}

/* On narrow screens the list scrolls sideways; keep the column names lined up. */
poolEl.addEventListener("scroll", () => {
	poolHead.scrollLeft = poolEl.scrollLeft;
}, { passive: true });

poolHead.addEventListener("click", event => {
	const sort = event.target.closest("[data-sort]");
	if (sort) sortBy(sort.dataset.sort);
});

poolEl.addEventListener("click", event => {
	const menuButton = event.target.closest("[data-menu]");
	const expandButton = event.target.closest("[data-expand]");

	if (expandButton) {
		const team = expandButton.dataset.expand;
		if (expanded.has(team)) expanded.delete(team);
		else expanded.add(team);
		renderPool();
	} else if (menuButton) {
		if (!menu.hidden && menu.dataset.team === menuButton.dataset.menu) closeMenu();
		else openMenu(menuButton.dataset.menu, menuButton);
	}
});

columnsEl.addEventListener("change", event => {
	const column = event.target.dataset.column;
	if (column === undefined) return;
	prefs.columns[Number(column)] = event.target.value;
	savePrefs();
	render();
});
columnsEl.addEventListener("click", event => {
	if (!event.target.closest("[data-reset-columns]")) return;
	prefs.columns = [...DEFAULT_COLUMNS];
	savePrefs();
	render();
});

listsEl.addEventListener("click", event => {
	const remove = event.target.closest("[data-remove]");
	const take = event.target.closest("[data-take]");
	const deleteList = event.target.closest("[data-delete-list]");
	const color = event.target.closest("[data-color]");

	if (remove) {
		removeTeam(remove.closest(".entry").dataset.team, remove.dataset.remove);
	} else if (take) {
		toggleTaken(take.dataset.take);
	} else if (deleteList) {
		const list = listById(deleteList.dataset.deleteList);
		if (list && (!list.entries.length || confirm(`Delete "${list.name}" and its ${list.entries.length} teams?`))) {
			state.lists = state.lists.filter(other => other !== list);
			saveLists();
			render();
		}
	} else if (color) {
		const list = listById(color.dataset.color);
		list.color = LIST_COLORS[(LIST_COLORS.indexOf(list.color) + 1) % LIST_COLORS.length];
		saveLists();
		render();
	}
});

/* Typing in a note or list name saves without redrawing (keeps focus). */
listsEl.addEventListener("input", event => {
	if (event.target.dataset.rename) {
		listById(event.target.dataset.rename).name = event.target.value;
		saveLists();
	} else if (event.target.dataset.note) {
		const list = listById(event.target.dataset.note);
		const entry = list.entries.find(item => item.team === event.target.closest(".entry").dataset.team);
		entry.note = event.target.value;
		saveLists();
	}
});
listsEl.addEventListener("change", event => {
	if (event.target.dataset.rename || event.target.dataset.note) renderPool();
});

filtersEl.addEventListener("change", event => {
	const { filterKey, filterOp, filterValue } = event.target.dataset;
	if (filterKey !== undefined) {
		const filter = prefs.filters[Number(filterKey)];
		filter.key = event.target.value;
		filter.op = Object.keys(opsFor(stats.get(filter.key)))[0];
		filter.value = "";
		renderFilters();
	} else if (filterOp !== undefined) {
		prefs.filters[Number(filterOp)].op = event.target.value;
		renderFilters();
	} else if (filterValue !== undefined) {
		prefs.filters[Number(filterValue)].value = event.target.value;
	}
	savePrefs();
	renderPool();
});
filtersEl.addEventListener("input", event => {
	if (event.target.dataset.filterValue === undefined || event.target.tagName === "SELECT") return;
	prefs.filters[Number(event.target.dataset.filterValue)].value = event.target.value;
	savePrefs();
	renderPool();
});
filtersEl.addEventListener("click", event => {
	const remove = event.target.closest("[data-remove-filter]");
	if (!remove) return;
	prefs.filters.splice(Number(remove.dataset.removeFilter), 1);
	savePrefs();
	renderFilters();
	renderPool();
});

document.getElementById("addFilterButton").addEventListener("click", () => {
	prefs.filters.push({ key: "opr", op: "gte", value: "" });
	savePrefs();
	renderFilters();
	filtersEl.querySelector(".filter-row:last-child input")?.focus();
});
document.getElementById("clearFiltersButton").addEventListener("click", () => {
	prefs.filters = [];
	savePrefs();
	renderFilters();
	renderPool();
});

search.addEventListener("input", renderPool);
Object.values(toggles).forEach(input => input.addEventListener("change", () => {
	savePrefs();
	renderPool();
}));

document.getElementById("addListButton").addEventListener("click", () => {
	state.lists.push({ id: `list-${Date.now()}`, name: "New list", color: LIST_COLORS[state.lists.length % LIST_COLORS.length], entries: [] });
	saveLists();
	renderLists();
	listsEl.querySelector(".list-card:last-child .list-name")?.select();
});

document.getElementById("resetButton").addEventListener("click", () => {
	if (!confirm("Clear every list and taken mark for this event?")) return;
	state = { lists: defaultLists(), taken: [] };
	saveLists();
	render();
});

document.getElementById("reloadButton").addEventListener("click", loadEvent);

function switchEvent() {
	state = loadLists(eventToken());
	teams = [];
	expanded.clear();
	render();
	loadEvent();
}

eventKey.addEventListener("change", switchEvent);
seasonSelect.addEventListener("change", async () => {
	await ftcFillEvents(eventKey, seasonSelect.value);
	switchEvent();
});


/* =================================
   EXPORT / IMPORT
================================= */

function download(name, type, text) {
	const link = document.createElement("a");
	link.href = URL.createObjectURL(new Blob([text], { type }));
	link.download = name;
	link.click();
	URL.revokeObjectURL(link.href);
}

/* Printable picklist: every list as a table with the stats currently shown,
   notes and a box to tick off picks. Print, or "Save as PDF" in the dialog. */
function renderPrintView() {
	const printView = document.getElementById("printView");
	const columns = prefs.columns.filter(key => stats.has(key));
	/* Numbers right-aligned; pit-scouting answers are text, so left-aligned. */
	const cellClass = key => (stats.get(key).pit ? "text" : "num");
	/* Column names can wrap on paper, so pit questions are printed in full. */
	const printLabel = key => (stats.get(key).pit ? stats.get(key).title : stats.get(key).label);
	const eventName = `${eventKey.selectedOptions[0]?.text.trim() ?? eventKey.value} (${seasonSelect.value})`;
	const printed = new Date().toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
	const lists = state.lists.filter(list => list.entries.length);

	/* One table for every list, so columns line up down the page while each
	   column is sized to fit its longest word (no words split mid-way). */
	const columnNames = `
		<tr class="column-names">
			<th class="num">#</th>
			<th>Team</th>
			${columns.map(key => `<th class="${cellClass(key)}"><span>${escapeHtml(printLabel(key))}</span></th>`).join("")}
			<th class="notes">Notes</th>
			<th class="check">Picked</th>
		</tr>`;

	const sections = lists.map(list => `
		<tbody class="print-list color-${list.color}">
			<tr class="list-heading">
				<th colspan="${columns.length + 4}">${escapeHtml(list.name)} <span>${list.entries.length} team${list.entries.length === 1 ? "" : "s"}</span></th>
			</tr>
			${columnNames}
			${list.entries.map((entry, index) => {
				const team = teamByNumber(entry.team);
				return `
				<tr class="team-row${isTaken(entry.team) ? " taken" : ""}">
					<td class="num position">${index + 1}</td>
					<td class="team"><strong>${escapeHtml(entry.team)}</strong>${team?.name ? `<small>${escapeHtml(team.name)}</small>` : ""}</td>
					${columns.map(key => `<td class="${cellClass(key)}">${team ? escapeHtml(formatStat(team, key)) : "—"}</td>`).join("")}
					<td class="notes">${escapeHtml(entry.note ?? "")}</td>
					<td class="check">${isTaken(entry.team) ? "✓" : "☐"}</td>
				</tr>`;
			}).join("")}
		</tbody>`).join("");
	const tables = sections ? `<table class="print-table">${sections}</table>` : "";

	printView.innerHTML = `
		<header class="print-header">
			<h1>Picklist · ${escapeHtml(eventName)}</h1>
			<p>${escapeHtml(window.TEAM?.legacy === false ? `${window.TEAM.name} ${window.TEAM.number}` : "MakeShift 4039")} · Printed ${escapeHtml(printed)}</p>
		</header>
		${tables || `<p>No teams have been added to the lists yet.</p>`}`;
}

document.getElementById("printButton").addEventListener("click", () => {
	renderPrintView();
	window.print();
});
/* Cmd/Ctrl+P on the page gets the same printout. */
window.addEventListener("beforeprint", renderPrintView);

/* Lists side by side, like the old picklist spreadsheet. */
document.getElementById("csvButton").addEventListener("click", () => {
	const header = state.lists.flatMap(list => [list.name, "Notes"]);
	const length = Math.max(0, ...state.lists.map(list => list.entries.length));
	const rows = Array.from({ length }, (_, index) => state.lists.flatMap(list => {
		const entry = list.entries[index];
		return entry ? [`${entry.team}${isTaken(entry.team) ? " (taken)" : ""}`, entry.note ?? ""] : ["", ""];
	}));
	const csv = [header, ...rows]
		.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
		.join("\n");
	download(`ftc-picklist-${eventToken()}.csv`, "text/csv", csv);
});

document.getElementById("exportButton").addEventListener("click", () => {
	download(`ftc-picklist-${eventToken()}.json`, "application/json", JSON.stringify({ event: eventToken(), ...state }, null, 2));
});

const importFile = document.getElementById("importFile");
document.getElementById("importButton").addEventListener("click", () => importFile.click());
importFile.addEventListener("change", async () => {
	const file = importFile.files[0];
	importFile.value = "";
	if (!file) return;

	try {
		const data = JSON.parse(await file.text());
		if (!Array.isArray(data.lists)) throw new Error("That file isn't a picklist export.");
		const otherEvent = data.event && data.event !== eventToken() ? ` (it was made for ${data.event})` : "";
		if (!confirm(`Replace this event's lists with the imported file${otherEvent}?`)) return;

		state = {
			lists: data.lists.map(list => ({
				id: String(list.id ?? `list-${Math.random()}`),
				name: String(list.name ?? "List"),
				color: LIST_COLORS.includes(list.color) ? list.color : "neutral",
				entries: (Array.isArray(list.entries) ? list.entries : [])
					.filter(entry => teamNumberOf(entry?.team))
					.map(entry => ({ team: teamNumberOf(entry.team), note: String(entry.note ?? "") }))
			})),
			taken: (Array.isArray(data.taken) ? data.taken : []).map(teamNumberOf).filter(Boolean)
		};
		saveLists();
		render();
		status.textContent = `Imported ${state.lists.length} lists.`;
	} catch (error) {
		status.textContent = `Couldn't import: ${error.message}`;
	}
});


/* =================================
   START
================================= */

for (const [key, input] of Object.entries(toggles)) {
	if (typeof prefs.toggles[key] === "boolean") input.checked = prefs.toggles[key];
}

(async () => {
	const params = new URL(window.location).searchParams;
	ftcFillSeasons(seasonSelect, params.get("season") ?? "2026");
	await ftcFillEvents(eventKey, seasonSelect.value, { keep: params.get("event") });
	state = loadLists(eventToken());
	render();
	loadEvent();
})();
