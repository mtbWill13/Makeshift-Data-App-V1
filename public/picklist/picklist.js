/* =================================
   PICKLIST
   Draft the order we want to pick teams in. The team list on the right is
   built from TBA (rank, OPR), Statbotics (EPA), match scouting and pit
   scouting, and can be filtered and sorted. Teams are dragged into the lists
   on the left. Lists are saved in this browser, per event.
================================= */

const eventKey = document.getElementById("eventKey");
const status = document.getElementById("status");
const listsEl = document.getElementById("lists");
const poolEl = document.getElementById("pool");
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

const OUR_TEAM = "4039";
const DISPLAY_COLUMNS = 5;
const PREFS_KEY = "makeshift-picklist-prefs";
const listsKey = event => `makeshift-picklist-${event}`;

const LIST_COLORS = ["green", "blue", "orange", "yellow", "red", "neutral"];
const DEFAULT_LISTS = [
	{ id: "captains", name: "Alliance Captains", color: "green" },
	{ id: "first", name: "1st Pick", color: "blue" },
	{ id: "offense", name: "2nd Pick – Offense", color: "orange" },
	{ id: "defense", name: "2nd Pick – Defense", color: "yellow" },
	{ id: "dnp", name: "Do Not Pick", color: "red" }
];
const DEFAULT_COLUMNS = ["rank", "opr", "epa", "scoutTotal", "climbRate"];

/* Scouting/pit columns that aren't stats. */
const SKIP_SCOUTING = /^(event|scouter name|match number|team number|driver station|comments|score preloaded|calculated rows.*|)$/i;
const SKIP_PIT = /^(event|pit scouter name|team number of team being scouted|timestamp)$/i;
/* Columns where a smaller number is better (ratings where 1 is best, breakdowns…). */
const LOWER_IS_BETTER = /\(best\)|incredible|died|breakdown|tipped|fouls|card|no show|was defended/i;

let teams = [];          // [{ number, name, stats: {key: number|null}, pit: {header: string}, reports }]
let stats = new Map();   // key → { label, title, group, digits, percent, lower, pit, kind, options }
let state = loadLists(eventKey.value);
let prefs = loadPrefs();
let loadId = 0;


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
	storageSet(listsKey(eventKey.value), state);
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

function scoutingTotal(row) {
	const find = names => {
		const entry = Object.entries(row).find(([header]) => names.includes(String(header).trim().toLowerCase()));
		return entry ? finite(entry[1]) : null;
	};
	const values = [
		find(["auto scoring points"]),
		find(["teleop scoring points"]),
		find(["endgame scoring points", "end game scoring points", "endgame points", "end game points", "endgame climb points", "end game climb points"])
	].filter(value => value !== null);
	return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function isNoShow(row) {
	return String(row["No Show"] ?? "").trim().toUpperCase() === "TRUE";
}

function addStat(key, stat) {
	stats.set(key, { digits: 1, group: "Event", lower: false, percent: false, kind: "number", ...stat });
}

/* The fixed stats, plus one for every numeric or yes/no scouting column. */
function buildStats(scouting, pit) {
	stats = new Map();
	addStat("rank", { label: "Rank", title: "Qualification rank (TBA)", digits: 0, lower: true });
	addStat("winRate", { label: "Win rate", title: "Qualification win rate", percent: true });
	addStat("opr", { label: "OPR" });
	addStat("dpr", { label: "DPR", lower: true });
	addStat("ccwm", { label: "CCWM" });
	addStat("epa", { label: "EPA", group: "Statbotics" });
	addStat("autoEpa", { label: "Auto EPA", group: "Statbotics" });
	addStat("teleopEpa", { label: "Teleop EPA", group: "Statbotics" });
	addStat("endgameEpa", { label: "Endgame EPA", group: "Statbotics" });
	addStat("scoutTotal", { label: "Scout avg", title: "Average auto + teleop + endgame points per scouting report", group: "Match scouting" });
	addStat("bestMatch", { label: "Best match", title: "Highest scouted total in one report", group: "Match scouting" });
	addStat("spread", { label: "Spread", title: "Standard deviation of scouted totals (lower = more consistent)", group: "Match scouting", lower: true });
	addStat("reports", { label: "Reports", title: "Scouting reports", group: "Match scouting", digits: 0 });
	addStat("climbRate", { label: "Climb %", title: "Played matches with any climb (auto or endgame)", group: "Match scouting", percent: true });
	addStat("noShowRate", { label: "No show %", group: "Match scouting", percent: true, lower: true });

	const headers = [...new Set(scouting.flatMap(row => Object.keys(row)))]
		.filter(header => !SKIP_SCOUTING.test(header.trim()) && header.trim() !== "No Show");

	for (const header of headers) {
		const values = scouting.map(row => String(row[header] ?? "").trim()).filter(value => value !== "" && value.toLowerCase() !== "x");
		if (!values.length) continue;
		const lower = LOWER_IS_BETTER.test(header);

		if (values.every(isBoolean)) {
			addStat(`pct:${header}`, { label: `${shortLabel(header)} %`, title: `${header} (% of played matches)`, group: "Match scouting", percent: true, lower, column: header });
		} else if (values.filter(value => finite(value) !== null).length >= values.length * 0.8) {
			addStat(`avg:${header}`, { label: `Avg ${shortLabel(header)}`, title: `Average ${header}`, group: "Match scouting", lower, column: header });
		}
	}

	const pitHeaders = [...new Set(pit.flatMap(row => Object.keys(row)))]
		.filter(header => header.trim() && !SKIP_PIT.test(header.trim()));

	for (const header of pitHeaders) {
		const values = pit.map(row => String(row[header] ?? "").trim()).filter(Boolean);
		if (!values.length) continue;
		const distinct = [...new Set(values)].sort();
		const kind = values.every(isBoolean)
			? "bool"
			: distinct.length <= 10 && distinct.every(value => value.length <= 30) ? "choice" : "text";
		stats.set(`pit:${header}`, { label: shortLabel(header), title: header, group: "Pit scouting", pit: true, kind, options: distinct, column: header });
	}
}

function scoutingStats(rows) {
	const played = rows.filter(row => !isNoShow(row));
	const totals = played.map(scoutingTotal).filter(value => value !== null);
	const mean = average(totals);
	const result = {
		reports: rows.length,
		scoutTotal: mean,
		bestMatch: totals.length ? Math.max(...totals) : null,
		spread: totals.length >= 2 ? Math.sqrt(totals.reduce((sum, total) => sum + (total - mean) ** 2, 0) / totals.length) : null,
		noShowRate: rows.length ? rows.filter(isNoShow).length / rows.length * 100 : null
	};

	/* "Climb points" covers auto and endgame climbs; older sheets only have "End Game Climb". */
	const climbColumn = played.some(row => "Climb points" in row) ? "Climb points" : "End Game Climb";
	const climbs = played.map(row => finite(row[climbColumn])).filter(value => value !== null);
	result.climbRate = climbs.length ? climbs.filter(value => value > 0).length / climbs.length * 100 : null;

	for (const [key, stat] of stats) {
		if (!stat.column || stat.pit) continue;
		const values = played.map(row => String(row[stat.column] ?? "").trim()).filter(value => value !== "" && value.toLowerCase() !== "x");
		if (key.startsWith("pct:")) {
			const answers = values.filter(isBoolean);
			result[key] = answers.length ? answers.filter(value => value.toUpperCase() === "TRUE").length / answers.length * 100 : null;
		} else {
			result[key] = average(values.map(finite));
		}
	}

	return result;
}

function teamNumberOf(value) {
	const match = String(value ?? "").match(/\d+/);
	return match ? match[0] : null;
}

/* Builds the team list from whatever has loaded so far. */
function buildTeams({ oprs, rankings, scouting, pit, eventTeams, epas }) {
	buildStats(scouting, pit);

	const numbers = new Set([
		...eventTeams.map(String),
		...Object.keys(oprs?.oprs ?? {}).map(teamNumberOf),
		...rankings.map(row => teamNumberOf(row.team_key)),
		...scouting.map(row => teamNumberOf(row["Team Number"])),
		...epas.map(row => teamNumberOf(row.team ?? row.team_number))
	].filter(Boolean));

	const ranks = new Map(rankings.map(row => [teamNumberOf(row.team_key), row]));
	const epaRows = new Map(epas.map(row => [teamNumberOf(row.team ?? row.team_number), row]));

	teams = [...numbers].map(number => {
		const key = `frc${number}`;
		const ranking = ranks.get(number);
		const record = ranking?.record;
		const played = record ? record.wins + record.losses + record.ties : 0;
		const epa = epaRows.get(number);
		const breakdown = epa?.epa?.breakdown ?? {};
		const rows = scouting.filter(row => teamNumberOf(row["Team Number"]) === number);
		/* Last pit report for the team wins. */
		const pitRow = pit.filter(row => teamNumberOf(row["Team Number of Team Being Scouted"]) === number).at(-1) ?? {};

		return {
			number,
			name: epa?.team_name ?? "",
			pit: Object.fromEntries(Object.entries(pitRow).map(([header, value]) => [header, String(value ?? "").trim()])),
			stats: {
				rank: finite(ranking?.rank),
				winRate: played ? (record.wins + record.ties / 2) / played * 100 : null,
				opr: finite(oprs?.oprs?.[key]),
				dpr: finite(oprs?.dprs?.[key]),
				ccwm: finite(oprs?.ccwms?.[key]),
				epa: finite(epa?.epa?.total_points?.mean ?? epa?.epa?.total_points),
				autoEpa: finite(breakdown.auto_points),
				teleopEpa: finite(breakdown.teleop_points),
				endgameEpa: finite(breakdown.endgame_points),
				...scoutingStats(rows)
			}
		};
	});

	/* Values in the top quarter of the event are highlighted. */
	for (const [key, stat] of stats) {
		if (stat.pit) continue;
		const values = teams.map(team => team.stats[key]).filter(value => value !== null)
			.sort((a, b) => (stat.lower ? a - b : b - a));
		const cutoff = values.length >= 4 ? values[Math.ceil(values.length / 4) - 1] : null;
		const worst = values.at(-1);
		for (const team of teams) {
			const value = team.stats[key];
			team.top ??= {};
			team.top[key] = cutoff !== null && value !== null && value !== worst && (stat.lower ? value <= cutoff : value >= cutoff);
		}
	}
}

async function loadEvent() {
	const event = eventKey.value;
	const thisLoad = ++loadId;
	const url = new URL(window.location);
	url.searchParams.set("event", event);
	window.history.replaceState({}, "", url);

	status.textContent = "Loading event data…";
	const data = {
		oprs: {},
		rankings: [],
		scouting: [],
		pit: [],
		eventTeams: [],
		epas: []
	};
	const settle = (promise, fallback) => promise.catch(() => fallback);

	/* Statbotics is often slow, so the page draws without it and adds EPA later. */
	const epaRequest = settle(fetchJson(`/api/statbotics/event-teams/${event}`), null);

	const [oprs, rankings, scouting, pit, eventTeams] = await Promise.all([
		settle(fetchJson(`/api/events/${event}/oprs`), {}),
		settle(fetchJson(`/api/events/${event}/rankings`), []),
		settle(fetchJson(`/api/scouting/${event}`), []),
		settle(fetchJson(`/api/pitscouting/${event}`), []),
		settle(fetchJson(`/api/events/${event}/teams`), [])
	]);
	if (thisLoad !== loadId) return;

	Object.assign(data, {
		oprs: oprs ?? {},
		rankings: Array.isArray(rankings) ? rankings : [],
		scouting: Array.isArray(scouting) ? scouting : [],
		pit: Array.isArray(pit) ? pit : [],
		eventTeams: Array.isArray(eventTeams) ? eventTeams : []
	});
	buildTeams(data);
	render();
	status.textContent = teams.length
		? `${teams.length} teams • ${data.scouting.length} scouting reports • ${data.pit.length} pit reports. Loading EPA from Statbotics…`
		: "No teams found for this event yet.";

	const epas = await epaRequest;
	if (thisLoad !== loadId) return;
	if (Array.isArray(epas)) data.epas = epas;
	buildTeams(data);
	render();
	status.textContent = `${teams.length} teams • ${data.scouting.length} scouting reports • ${data.pit.length} pit reports${Array.isArray(epas) ? "" : " • Statbotics didn't respond, so EPA is blank (try Reload data)"}.`;
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

function teamLink(number) {
	return `/?${new URLSearchParams({ event: eventKey.value, team: number })}`;
}

function renderPool() {
	if (!teams.length) {
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
		<div class="pool-row${team.number === OUR_TEAM ? " is-us" : ""}" data-drag data-team="${team.number}">
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
			<button class="add-button" type="button" data-menu="${team.number}" aria-label="Add ${team.number} to a list" title="Add to a list">+</button>
		</div>`).join("");

	const empty = available
		? `<div class="empty-state">No teams match these filters.</div>`
		: `<div class="empty-state">Every team has been placed in a list.</div>`;
	poolEl.innerHTML = `<div class="pool-table">${header}${rows || empty}</div>`;
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

poolEl.addEventListener("click", event => {
	const sort = event.target.closest("[data-sort]");
	const menuButton = event.target.closest("[data-menu]");

	if (sort) {
		const key = sort.dataset.sort;
		/* First click sorts best-first (lowest first for rank, team number and text). */
		const lowerFirst = key === "team" || stats.get(key)?.lower || stats.get(key)?.pit;
		prefs.sort = prefs.sort.key === key
			? { key, dir: -prefs.sort.dir }
			: { key, dir: lowerFirst ? 1 : -1 };
		savePrefs();
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

eventKey.addEventListener("change", () => {
	state = loadLists(eventKey.value);
	teams = [];
	render();
	loadEvent();
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
	download(`picklist-${eventKey.value}.csv`, "text/csv", csv);
});

document.getElementById("exportButton").addEventListener("click", () => {
	download(`picklist-${eventKey.value}.json`, "application/json", JSON.stringify({ event: eventKey.value, ...state }, null, 2));
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
		const otherEvent = data.event && data.event !== eventKey.value ? ` (it was made for ${data.event})` : "";
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

const eventFromUrl = new URL(window.location).searchParams.get("event");
if ([...eventKey.options].some(option => option.value === eventFromUrl)) {
	eventKey.value = eventFromUrl;
} else if (/^\d{4}[a-z0-9]+$/i.test(eventFromUrl ?? "")) {
	eventKey.add(new Option(eventFromUrl, eventFromUrl));
	eventKey.value = eventFromUrl;
}
state = loadLists(eventKey.value);

render();
loadEvent();
