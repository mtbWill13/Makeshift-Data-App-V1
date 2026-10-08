/* =================================
   PRESCOUTING
   Ranks a custom list of teams by their season results (Statbotics EPA,
   TBA records and finishes) and writes a short overview of each.
================================= */

const OUR_TEAM = 4039;
const MAX_TEAMS = 80;
const MEDIA_CONCURRENCY = 4;

const teamsInput = document.getElementById("teamsInput");
const eventImport = document.getElementById("eventImport");
const importButton = document.getElementById("importButton");
const seasonSelect = document.getElementById("seasonSelect");
const prescoutButton = document.getElementById("prescoutButton");
const status = document.getElementById("status");
const results = document.getElementById("results");

/* Worldwide EPA percentile → tier. Statbotics ranks ~3,700 teams. */
const TIERS = [
	{ min: 0.95, id: "elite", label: "Elite" },
	{ min: 0.85, id: "strong", label: "Strong" },
	{ min: 0.7, id: "solid", label: "Solid" },
	{ min: 0.4, id: "average", label: "Average" },
	{ min: 0, id: "developing", label: "Developing" }
];

const SORTS = {
	epa: { label: "EPA", value: team => team.epa },
	auto: { label: "Auto EPA", value: team => team.auto },
	teleop: { label: "Teleop EPA", value: team => team.teleop },
	endgame: { label: "Endgame EPA", value: team => team.endgame },
	peak: { label: "Peak EPA", value: team => team.peakEpa },
	winRate: { label: "Win rate", value: team => team.winRate },
	opr: { label: "Average OPR", value: team => team.avgOpr }
};

let teams = [];
let year = seasonSelect.value;
let sortKey = "epa";
let runId = 0;


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
	const number = Number(value);
	return value !== null && value !== undefined && value !== "" && Number.isFinite(number) ? number : null;
}

function format(value, digits = 1) {
	return value === null ? "—" : value.toFixed(digits);
}

function percent(value) {
	return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function listJoin(items) {
	return items.length <= 2
		? items.join(" and ")
		: `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function parseTeams(text) {
	const numbers = String(text).match(/\d{1,5}/g) ?? [];
	return [...new Set(numbers.map(Number).filter(number => number > 0))].slice(0, MAX_TEAMS);
}

/* Runs fn over items with at most `limit` running at once. */
async function mapLimit(items, limit, fn) {
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const index = next++;
			await fn(items[index], index);
		}
	});
	await Promise.all(workers);
}

/* =================================
   DATA
================================= */

function teamFromSeason(number, season) {
	const epa = season.epa ?? {};
	const breakdown = epa.breakdown ?? {};
	const officialEvents = (season.events ?? []).filter(event => event.official !== false);
	const oprs = officialEvents.map(event => finite(event.opr)).filter(opr => opr !== null && opr > 0);
	const worldRank = epa.ranks?.total ?? null;

	return {
		number,
		name: season.name ?? "",
		loaded: true,
		hasData: finite(epa.total_points?.mean ?? epa.total_points) !== null || officialEvents.length > 0,
		epa: finite(epa.total_points?.mean ?? epa.total_points),
		auto: finite(breakdown.auto_points),
		teleop: finite(breakdown.teleop_points),
		endgame: finite(breakdown.endgame_points),
		startEpa: finite(epa.stats?.start),
		peakEpa: finite(epa.stats?.max),
		worldRank: finite(worldRank?.rank),
		worldCount: finite(worldRank?.team_count),
		percentile: finite(worldRank?.percentile),
		wins: finite(season.record?.wins),
		losses: finite(season.record?.losses),
		ties: finite(season.record?.ties),
		winRate: finite(season.record?.winrate),
		avgOpr: oprs.length ? oprs.reduce((sum, opr) => sum + opr, 0) / oprs.length : null,
		events: officialEvents,
		offseasonCount: (season.events ?? []).length - officialEvents.length,
		photo: null,
		viewUrl: null,
		behindTheBumpers: null
	};
}

/* Robot photo and Behind the Bumpers are extras, loaded after the rankings. */
async function loadMedia(team, thisRun) {
	try {
		const response = await fetch(`/api/teams/${team.number}/media/${year}`);
		const media = response.ok ? await response.json() : null;
		if (!media || thisRun !== runId) return;

		team.photo = media.url;
		team.viewUrl = media.viewUrl;
		team.behindTheBumpers = media.behindTheBumpers;
		updateCardMedia(team);
	} catch {
		/* Optional; the card works without it. */
	}
}

async function prescout() {
	const numbers = parseTeams(teamsInput.value);

	if (!numbers.length) {
		status.textContent = "Enter at least one team number.";
		results.innerHTML = "";
		return;
	}

	year = seasonSelect.value;
	const thisRun = ++runId;
	teams = numbers.map(number => ({ number, loaded: false, hasData: false }));

	const url = new URL(window.location);
	url.searchParams.set("teams", numbers.join(","));
	url.searchParams.set("year", year);
	window.history.replaceState({}, "", url);

	prescoutButton.disabled = true;
	render();

	try {
		/* One request for every team's season (the server batches it). */
		const response = await fetch(`/api/prescout?year=${year}&teams=${numbers.join(",")}`);
		const data = await response.json().catch(() => ({}));
		if (thisRun !== runId) return;
		if (!response.ok) throw new Error(data.error || "Couldn't load these teams.");

		const seasons = new Map(data.map(season => [season.team, season]));
		teams = numbers.map(number => {
			const season = seasons.get(number);
			const team = season ? teamFromSeason(number, season) : { number, loaded: true, hasData: false };
			if (!team.hasData) team.error = `No ${year} results found. Possibly a new team, or they didn't compete this season.`;
			return team;
		});
	} catch (error) {
		if (thisRun !== runId) return;
		teams = [];
		results.innerHTML = "";
		status.textContent = error.message;
		prescoutButton.disabled = false;
		return;
	}

	prescoutButton.disabled = false;
	render();

	await mapLimit(teams.filter(team => team.hasData), MEDIA_CONCURRENCY, team => loadMedia(team, thisRun));
}

async function importEvent() {
	const key = eventImport.value.trim().toLowerCase();

	if (!/^\d{4}[a-z0-9]+$/.test(key)) {
		status.textContent = "Enter a TBA event key like 2027onwat.";
		return;
	}

	importButton.disabled = true;
	status.textContent = `Looking up ${key}…`;

	try {
		const response = await fetch(`/api/events/${encodeURIComponent(key)}/teams`);
		const data = await response.json().catch(() => ({}));

		if (!response.ok) throw new Error(data.error || "Event not found.");
		if (!data.length) throw new Error(`${key} has no teams published on TBA yet.`);

		teamsInput.value = data.join(", ");
		status.textContent = `Imported ${data.length} teams from ${key}.`;
		prescout();
	} catch (error) {
		status.textContent = error.message;
	} finally {
		importButton.disabled = false;
	}
}


/* =================================
   OVERVIEW TEXT
================================= */

const COMPONENTS = [
	{ key: "auto", label: "auto" },
	{ key: "teleop", label: "teleop" },
	{ key: "endgame", label: "endgame" }
];

/* Where a value sits among the group, 0 (lowest) to 1 (highest). */
function groupPercentile(value, values) {
	if (value === null || values.length < 2) return null;
	return values.filter(other => other < value).length / (values.length - 1);
}

function eventHighlights(team) {
	const wins = team.events.filter(event => /won the event/i.test(event.playoffStatus ?? ""));
	const finals = team.events.filter(event => /eliminated in the finals/i.test(event.playoffStatus ?? ""));
	const parts = [];

	if (wins.length) parts.push(`Won ${listJoin(wins.map(event => event.name))}`);
	if (finals.length) parts.push(`${wins.length ? "finalist" : "Finalist"} at ${listJoin(finals.map(event => event.name))}`);

	if (!parts.length) {
		const captain = team.events.find(event => /captain/i.test(event.allianceStatus ?? ""));
		const picked = team.events.find(event => /pick/i.test(event.allianceStatus ?? ""));
		const bestRank = team.events
			.filter(event => finite(event.rank) && finite(event.numTeams))
			.sort((a, b) => a.rank / a.numTeams - b.rank / b.numTeams)[0];

		if (captain) parts.push(`${captain.allianceStatus} at ${captain.name}`);
		else if (picked) parts.push(`${picked.allianceStatus} at ${picked.name}`);
		else if (bestRank) parts.push(`Best qualification rank: ${bestRank.rank} of ${bestRank.numTeams} at ${bestRank.name}`);
	}

	return parts.length ? `${parts.join("; ")}.` : "";
}

function overview(team, group) {
	if (!team.loaded) return "Loading…";
	if (!team.hasData) return team.error ?? `No ${year} results found. Possibly a new team, or they didn't compete this season.`;

	const sentences = [];

	if (team.worldRank && team.worldCount) {
		const top = Math.max(1, Math.ceil((1 - team.percentile) * 100));
		sentences.push(`#${team.worldRank.toLocaleString()} of ${team.worldCount.toLocaleString()} worldwide by EPA (top ${top}%).`);
	}

	if (team.wins !== null) {
		const record = `${team.wins}–${team.losses ?? 0}${team.ties ? `–${team.ties}` : ""}`;
		sentences.push(`${record} across ${team.events.length} official event${team.events.length === 1 ? "" : "s"}.`);
	}

	const highlights = eventHighlights(team);
	if (highlights) sentences.push(highlights);

	/* Strongest and weakest part of their game, relative to this group. */
	const withData = group.filter(other => other.hasData);
	if (withData.length >= 4) {
		const scored = COMPONENTS
			.map(component => ({
				...component,
				rank: groupPercentile(team[component.key], withData.map(other => other[component.key]).filter(value => value !== null)),
				best: team[component.key] !== null && withData.every(other => (other[component.key] ?? -Infinity) <= team[component.key])
			}))
			.filter(component => component.rank !== null);

		const strongest = [...scored].sort((a, b) => b.rank - a.rank)[0];
		const weakest = [...scored].sort((a, b) => a.rank - b.rank)[0];

		if (strongest?.best) sentences.push(`Best ${strongest.label} in this group.`);
		else if (strongest && strongest.rank >= 0.75) sentences.push(`${strongest.label[0].toUpperCase()}${strongest.label.slice(1)} is a strength.`);

		if (weakest && weakest !== strongest && weakest.rank <= 0.25) sentences.push(`${weakest.label[0].toUpperCase()}${weakest.label.slice(1)} trails this group.`);
	}

	/* How their season went. */
	if (team.startEpa && team.peakEpa && team.epa) {
		if (team.epa - team.startEpa >= Math.max(15, team.startEpa * 0.25)) {
			sentences.push(`Improved a lot through the season (EPA ${Math.round(team.startEpa)} → ${Math.round(team.epa)}).`);
		} else if (team.epa < team.peakEpa * 0.85) {
			sentences.push(`Finished below their peak (EPA peaked at ${Math.round(team.peakEpa)}).`);
		}
	}

	return sentences.join(" ");
}


/* =================================
   RENDER
================================= */

function tierFor(team) {
	if (!team.hasData || team.percentile === null) return null;
	return TIERS.find(tier => team.percentile >= tier.min);
}

function sortedTeams() {
	const value = SORTS[sortKey].value;

	return [...teams].sort((a, b) => {
		const left = a.hasData ? value(a) : null;
		const right = b.hasData ? value(b) : null;
		if (left === null && right === null) return a.number - b.number;
		if (left === null) return 1;
		if (right === null) return -1;
		return right - left || a.number - b.number;
	});
}

function componentBars(team, group) {
	const max = key => Math.max(1, ...group.map(other => other[key] ?? 0));

	return COMPONENTS.map(({ key, label }) => {
		const value = team[key];
		const width = value === null ? 0 : Math.max(2, (value / max(key)) * 100);
		return `
          <div class="bar-row">
            <span>${label}</span>
            <div class="bar-track"><div class="bar-fill ${key}" style="width:${width.toFixed(1)}%"></div></div>
            <b>${format(value)}</b>
          </div>`;
	}).join("");
}

/* Imgur serves a 160×160 square if "b" is added to the file name
   (i.imgur.com/abc.jpeg → abcb.jpeg); full photos can be several MB. */
function thumbnail(url) {
	return /^https:\/\/i\.imgur\.com\/\w+\.(jpe?g|png|gif|webp)$/i.test(url)
		? url.replace(/(\.\w+)$/, "b$1")
		: url;
}

function photoHtml(team) {
	return team.photo
		? `<a class="prescout-photo" href="${escapeHtml(team.viewUrl ?? team.photo)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(thumbnail(team.photo))}" alt="Team ${team.number}'s robot" loading="lazy"></a>`
		: `<div class="prescout-photo empty" aria-hidden="true">${team.number}</div>`;
}

function behindTheBumpersHtml(team) {
	return team.behindTheBumpers
		? `<a class="btb-link" href="${escapeHtml(team.behindTheBumpers.url)}" target="_blank" rel="noopener noreferrer">▶ Behind the Bumpers</a>`
		: "";
}

/* Media arrives after the cards are drawn; patch just that card rather than
   redrawing the list (which would restart every image download). */
function updateCardMedia(team) {
	const card = results.querySelector(`.prescout-card[data-team="${team.number}"]`);
	if (!card) return;

	const photo = card.querySelector(".prescout-photo");
	if (photo && team.photo) photo.outerHTML = photoHtml(team);

	const links = card.querySelector(".prescout-links");
	if (links && team.behindTheBumpers && !links.querySelector(".btb-link")) {
		links.insertAdjacentHTML("beforeend", behindTheBumpersHtml(team));
	}
}

function teamCard(team, position, group) {
	const tier = tierFor(team);
	const isUs = team.number === OUR_TEAM;
	const dashboard = `/?event=season&team=${team.number}`;

	if (!team.loaded) {
		return `
        <article class="prescout-card loading-card">
          <div class="prescout-rank">…</div>
          <div class="prescout-main">
            <div class="prescout-title"><span class="team-number">${team.number}</span></div>
            <p class="prescout-overview">Loading…</p>
          </div>
        </article>`;
	}

	return `
        <article class="prescout-card${tier ? ` tier-${tier.id}` : ""}${team.hasData ? "" : " no-data"}${isUs ? " is-us" : ""}" data-team="${team.number}">
          <div class="prescout-rank">${team.hasData ? position : "—"}</div>
          ${photoHtml(team)}
          <div class="prescout-main">
            <div class="prescout-title">
              <a class="team-number" href="${dashboard}">${team.number}</a>
              <span class="team-name">${escapeHtml(team.name)}</span>
              ${tier ? `<span class="tier-badge">${tier.label}</span>` : ""}
              ${isUs ? `<span class="us-badge">You</span>` : ""}
            </div>
            <p class="prescout-overview">${escapeHtml(overview(team, group))}</p>
            <div class="prescout-links">
              <a href="${dashboard}">Season dashboard →</a>
              ${behindTheBumpersHtml(team)}
            </div>
          </div>
          ${team.hasData ? `
          <div class="prescout-stats">
            <div class="epa-block">
              <span>EPA</span>
              <strong>${format(team.epa)}</strong>
              <small>peak ${format(team.peakEpa)}</small>
            </div>
            <div class="bars">${componentBars(team, group)}</div>
            <dl class="mini-stats">
              <div><dt>Win rate</dt><dd>${percent(team.winRate)}</dd></div>
              <div><dt>Avg OPR</dt><dd>${format(team.avgOpr)}</dd></div>
              <div><dt>Events</dt><dd>${team.events.length}</dd></div>
            </dl>
          </div>` : ""}
        </article>`;
}

function fieldSummary(group) {
	const withData = group.filter(team => team.hasData && team.epa !== null);
	const epas = withData.map(team => team.epa);
	const average = epas.length ? epas.reduce((sum, value) => sum + value, 0) / epas.length : null;
	const elite = withData.filter(team => tierFor(team)?.id === "elite").length;
	const byEpa = [...withData].sort((a, b) => b.epa - a.epa);
	const us = byEpa.findIndex(team => team.number === OUR_TEAM);
	const top = byEpa[0];

	const lastTile = us !== -1
		? { label: `Where ${OUR_TEAM} ranks`, value: `#${us + 1} of ${byEpa.length}`, note: "by EPA in this group" }
		: { label: "Top team", value: top ? `${top.number}` : "—", note: top ? `${escapeHtml(top.name)} • EPA ${format(top.epa)}` : "" };

	return `
      <section class="field-summary">
        <div class="stat-card"><div class="stat-label">Teams</div><div class="stat-value">${group.length}</div><div class="stat-description">${withData.length} with ${year} results</div></div>
        <div class="stat-card"><div class="stat-label">Average EPA</div><div class="stat-value">${format(average)}</div><div class="stat-description">Field strength</div></div>
        <div class="stat-card"><div class="stat-label">Elite teams</div><div class="stat-value">${elite}</div><div class="stat-description">Top 5% worldwide by EPA</div></div>
        <div class="stat-card"><div class="stat-label">${lastTile.label}</div><div class="stat-value">${lastTile.value}</div><div class="stat-description">${lastTile.note}</div></div>
      </section>`;
}

function render() {
	if (!teams.length) {
		results.innerHTML = "";
		return;
	}

	const loaded = teams.filter(team => team.loaded).length;
	const done = loaded === teams.length;

	status.textContent = done
		? `Ranked ${teams.length} team${teams.length === 1 ? "" : "s"} on ${year} results.`
		: `Loading ${teams.length} team${teams.length === 1 ? "" : "s"}…`;

	const ordered = sortedTeams();
	let position = 0;

	results.innerHTML = `
      ${fieldSummary(teams)}
      <div class="results-toolbar">
        <h3 class="section-title">Ranked by ${escapeHtml(SORTS[sortKey].label)}</h3>
        <div class="toolbar-controls">
          <label for="sortSelect">Sort by</label>
          <select id="sortSelect">
            ${Object.entries(SORTS).map(([key, sort]) => `<option value="${key}"${key === sortKey ? " selected" : ""}>${sort.label}</option>`).join("")}
          </select>
          <button id="csvButton" class="secondary-button" type="button"${done ? "" : " disabled"}>Download CSV</button>
        </div>
      </div>
      <section class="prescout-list">
        ${ordered.map(team => teamCard(team, team.hasData ? ++position : null, teams)).join("")}
      </section>
      <p class="prescout-note">
        Tiers use Statbotics' worldwide EPA percentile: Elite = top 5%, Strong = top 15%,
        Solid = top 30%, Average = top 60%. Offseason events are left out of records, OPR and highlights.
      </p>`;
}


/* =================================
   CSV EXPORT
================================= */

function downloadCsv() {
	const header = ["Rank", "Team", "Name", "Tier", "EPA", "Auto EPA", "Teleop EPA", "Endgame EPA", "Peak EPA", "World rank", "Win rate", "Wins", "Losses", "Ties", "Avg OPR", "Official events", "Overview"];
	let position = 0;
	const rows = sortedTeams().map(team => [
		team.hasData ? ++position : "",
		team.number,
		team.name ?? "",
		tierFor(team)?.label ?? "",
		team.epa ?? "",
		team.auto ?? "",
		team.teleop ?? "",
		team.endgame ?? "",
		team.peakEpa ?? "",
		team.worldRank ?? "",
		team.winRate === null || team.winRate === undefined ? "" : Math.round(team.winRate * 100) + "%",
		team.wins ?? "",
		team.losses ?? "",
		team.ties ?? "",
		team.avgOpr === null || team.avgOpr === undefined ? "" : team.avgOpr.toFixed(1),
		team.events?.length ?? "",
		overview(team, teams)
	]);

	const csv = [header, ...rows]
		.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
		.join("\n");

	const link = document.createElement("a");
	link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
	link.download = `prescout-${year}-${teams.length}-teams.csv`;
	link.click();
	URL.revokeObjectURL(link.href);
}


/* =================================
   EVENTS + START
================================= */

prescoutButton.addEventListener("click", prescout);
importButton.addEventListener("click", importEvent);
eventImport.addEventListener("keydown", event => {
	if (event.key === "Enter") importEvent();
});
teamsInput.addEventListener("keydown", event => {
	if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) prescout();
});

/* The results area is re-rendered, so listen there for its controls. */
results.addEventListener("change", event => {
	if (event.target.id === "sortSelect") {
		sortKey = event.target.value;
		render();
	}
});
results.addEventListener("click", event => {
	if (event.target.id === "csvButton") downloadCsv();
});

/* Shared links: ?teams=4039,1114&year=2026 */
const params = new URL(window.location).searchParams;
if ([...seasonSelect.options].some(option => option.value === params.get("year"))) {
	seasonSelect.value = params.get("year");
}
if (params.get("teams")) {
	teamsInput.value = parseTeams(params.get("teams")).join(", ");
	prescout();
}
