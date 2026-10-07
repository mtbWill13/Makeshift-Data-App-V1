/* =================================
   FTC PRESCOUTING
   Ranks a list of FTC teams by FTCScout season OPR and writes a short
   overview of each. Mirrors the FRC prescouting page.
================================= */

const MAX_TEAMS = 80;

const teamsInput = document.getElementById("teamsInput");
const eventImport = document.getElementById("eventImport");
const importButton = document.getElementById("importButton");
const seasonSelect = document.getElementById("seasonSelect");
const prescoutButton = document.getElementById("prescoutButton");
const status = document.getElementById("status");
const results = document.getElementById("results");

/* World OPR percentile → tier (same cut-offs as FRC prescouting). */
const TIERS = [
	{ min: 0.95, id: "elite", label: "Elite" },
	{ min: 0.85, id: "strong", label: "Strong" },
	{ min: 0.7, id: "solid", label: "Solid" },
	{ min: 0.4, id: "average", label: "Average" },
	{ min: 0, id: "developing", label: "Developing" }
];

const SORTS = {
	opr: { label: "OPR", value: team => team.opr },
	auto: { label: "Auto OPR", value: team => team.auto },
	teleop: { label: "Teleop OPR", value: team => team.teleop },
	endgame: { label: "Endgame OPR", value: team => team.endgame },
	winRate: { label: "Win rate", value: team => team.winRate },
	awards: { label: "Awards", value: team => team.awards.length }
};

const COMPONENTS = [
	{ key: "auto", label: "auto" },
	{ key: "teleop", label: "teleop" },
	{ key: "endgame", label: "endgame" }
];

let teams = [];
let season = FTC_DEFAULT_SEASON;
let sortKey = "opr";
let runId = 0;

function parseTeams(text) {
	const numbers = String(text).match(/\d{1,6}/g) ?? [];
	return [...new Set(numbers.map(Number).filter(number => number > 0))].slice(0, MAX_TEAMS);
}

function listJoin(items) {
	return items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function percent(value) {
	return Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—";
}

/* /api/ftc/prescout entry → the fields the page uses. */
function teamFromSeason(data) {
	const q = data.quickStats;
	const official = data.events.filter(event => event.official && event.stats);
	const record = official.reduce((sum, event) => ({
		wins: sum.wins + event.stats.wins,
		losses: sum.losses + event.stats.losses,
		ties: sum.ties + event.stats.ties
	}), { wins: 0, losses: 0, ties: 0 });
	const played = record.wins + record.losses + record.ties;
	const worldRank = q?.total?.rank ?? null;
	const count = q?.teamCount ?? null;

	return {
		number: data.team.number,
		name: data.team.name ?? "",
		place: [data.team.city, data.team.state].filter(Boolean).join(", "),
		hasData: Boolean(q) || official.length > 0,
		opr: q?.total?.value ?? null,
		auto: q?.auto?.value ?? null,
		teleop: q?.teleop?.value ?? null,
		endgame: q?.endgame?.value ?? null,
		worldRank,
		worldCount: count,
		percentile: worldRank && count ? 1 - (worldRank - 1) / count : null,
		ontarioRank: data.regionStats?.rank ?? null,
		ontarioCount: data.regionStats?.teamCount ?? null,
		record,
		winRate: played ? record.wins / played : null,
		events: official,
		awards: data.events.flatMap(event => event.awards.map(award => ({ award, event: event.name })))
	};
}

function tierFor(team) {
	if (!team.hasData || team.percentile === null) return null;
	return TIERS.find(tier => team.percentile >= tier.min);
}

function groupPercentile(value, values) {
	if (!Number.isFinite(value) || values.length < 2) return null;
	return values.filter(other => other < value).length / (values.length - 1);
}

function overview(team, group) {
	if (!team.hasData) return `No ${season} results found on FTCScout. Possibly a new team, or they didn't compete that season.`;

	const sentences = [];

	if (team.worldRank && team.worldCount) {
		const top = Math.max(1, Math.ceil((1 - team.percentile) * 100));
		const ontario = team.ontarioRank ? `, #${team.ontarioRank} of ${team.ontarioCount} in Ontario` : "";
		sentences.push(`#${team.worldRank.toLocaleString()} of ${team.worldCount.toLocaleString()} worldwide by OPR (top ${top}%${ontario}).`);
	}

	if (team.events.length) {
		sentences.push(`${ftcRecord(team.record)} across ${team.events.length} official event${team.events.length === 1 ? "" : "s"}.`);
	}

	/* Event wins and the awards that matter most for advancement. */
	const wins = team.awards.filter(({ award }) => award.startsWith("Winning alliance")).map(({ event }) => event);
	const inspire = team.awards.filter(({ award }) => award.startsWith("Inspire")).map(({ award, event }) => `${award} at ${event}`);
	if (wins.length) sentences.push(`Won ${listJoin([...new Set(wins)])}.`);
	if (inspire.length) sentences.push(`${listJoin(inspire)}.`);
	else if (team.awards.length) sentences.push(`${team.awards.length} award${team.awards.length === 1 ? "" : "s"} this season.`);

	/* Strongest and weakest part of their game, relative to this group. */
	const withData = group.filter(other => other.hasData);
	if (withData.length >= 4) {
		const scored = COMPONENTS
			.map(component => ({
				...component,
				rank: groupPercentile(team[component.key], withData.map(other => other[component.key]).filter(Number.isFinite)),
				best: Number.isFinite(team[component.key]) && withData.every(other => (other[component.key] ?? -Infinity) <= team[component.key])
			}))
			.filter(component => component.rank !== null);
		const strongest = [...scored].sort((a, b) => b.rank - a.rank)[0];
		const weakest = [...scored].sort((a, b) => a.rank - b.rank)[0];
		const capital = text => text[0].toUpperCase() + text.slice(1);

		if (strongest?.best) sentences.push(`Best ${strongest.label} in this group.`);
		else if (strongest && strongest.rank >= 0.75) sentences.push(`${capital(strongest.label)} is a strength.`);
		if (weakest && weakest !== strongest && weakest.rank <= 0.25) sentences.push(`${capital(weakest.label)} trails this group.`);
	}

	return sentences.join(" ");
}

function sortedTeams() {
	const value = SORTS[sortKey].value;
	return [...teams].sort((a, b) => {
		const left = a.hasData ? value(a) : null;
		const right = b.hasData ? value(b) : null;
		if (!Number.isFinite(left) && !Number.isFinite(right)) return a.number - b.number;
		if (!Number.isFinite(left)) return 1;
		if (!Number.isFinite(right)) return -1;
		return right - left || a.number - b.number;
	});
}

function componentBars(team) {
	const max = key => Math.max(1, ...teams.map(other => other[key] ?? 0));
	return COMPONENTS.map(({ key, label }) => {
		const value = team[key];
		const width = Number.isFinite(value) ? Math.max(2, value / max(key) * 100) : 0;
		return `
          <div class="bar-row">
            <span>${label}</span>
            <div class="bar-track"><div class="bar-fill ${key}" style="width:${width.toFixed(1)}%"></div></div>
            <b>${ftcFormat(value)}</b>
          </div>`;
	}).join("");
}

function teamCard(team, position) {
	const tier = tierFor(team);
	const dashboard = ftcTeamUrl(team.number, season);

	return `
      <article class="prescout-card${tier ? ` tier-${tier.id}` : ""}${team.hasData ? "" : " no-data"}">
        <div class="prescout-rank">${team.hasData ? position : "—"}</div>
        <div class="prescout-main">
          <div class="prescout-title">
            <a class="team-number" href="${dashboard}">${team.number}</a>
            <span class="team-name">${ftcEscape(team.name)}</span>
            ${tier ? `<span class="tier-badge">${tier.label}</span>` : ""}
          </div>
          <p class="prescout-overview">${ftcEscape(overview(team, teams))}</p>
          <div class="prescout-links">
            <a href="${dashboard}">Season dashboard →</a>
            <a href="https://ftcscout.org/teams/${team.number}" target="_blank" rel="noopener noreferrer">FTCScout ↗</a>
            ${team.place ? `<span class="team-name">${ftcEscape(team.place)}</span>` : ""}
          </div>
        </div>
        ${team.hasData ? `
        <div class="prescout-stats">
          <div class="epa-block">
            <span>OPR</span>
            <strong>${ftcFormat(team.opr)}</strong>
            <small>no penalties</small>
          </div>
          <div class="bars">${componentBars(team)}</div>
          <dl class="mini-stats">
            <div><dt>Win rate</dt><dd>${percent(team.winRate)}</dd></div>
            <div><dt>Events</dt><dd>${team.events.length}</dd></div>
            <div><dt>Awards</dt><dd>${team.awards.length}</dd></div>
          </dl>
        </div>` : ""}
      </article>`;
}

function fieldSummary() {
	const withData = teams.filter(team => Number.isFinite(team.opr));
	const average = withData.length ? withData.reduce((sum, team) => sum + team.opr, 0) / withData.length : null;
	const elite = withData.filter(team => tierFor(team)?.id === "elite").length;
	const top = [...withData].sort((a, b) => b.opr - a.opr)[0];

	return `
      <section class="field-summary">
        <div class="stat-card"><div class="stat-label">Teams</div><div class="stat-value">${teams.length}</div><div class="stat-description">${withData.length} with ${season} results</div></div>
        <div class="stat-card"><div class="stat-label">Average OPR</div><div class="stat-value">${ftcFormat(average)}</div><div class="stat-description">Field strength</div></div>
        <div class="stat-card"><div class="stat-label">Elite teams</div><div class="stat-value">${elite}</div><div class="stat-description">Top 5% worldwide by OPR</div></div>
        <div class="stat-card"><div class="stat-label">Top team</div><div class="stat-value">${top ? top.number : "—"}</div><div class="stat-description">${top ? `${ftcEscape(top.name)} • OPR ${ftcFormat(top.opr)}` : ""}</div></div>
      </section>`;
}

function render() {
	if (!teams.length) {
		results.innerHTML = "";
		return;
	}

	let position = 0;
	results.innerHTML = `
      ${fieldSummary()}
      <div class="results-toolbar">
        <h3 class="section-title">Ranked by ${ftcEscape(SORTS[sortKey].label)}</h3>
        <div class="toolbar-controls">
          <label for="sortSelect">Sort by</label>
          <select id="sortSelect">
            ${Object.entries(SORTS).map(([key, sort]) => `<option value="${key}"${key === sortKey ? " selected" : ""}>${sort.label}</option>`).join("")}
          </select>
          <button id="csvButton" class="secondary-button" type="button">Download CSV</button>
        </div>
      </div>
      <section class="prescout-list">
        ${sortedTeams().map(team => teamCard(team, team.hasData ? ++position : null)).join("")}
      </section>
      <p class="prescout-note">
        Data from FTCScout. Tiers use world OPR rank among ${teams.find(team => team.worldCount)?.worldCount?.toLocaleString() ?? "all"} FTC teams:
        Elite = top 5%, Strong = top 15%, Solid = top 30%, Average = top 60%. Scrimmages are left out of records.
      </p>`;
}

function downloadCsv() {
	const header = ["Rank", "Team", "Name", "Location", "Tier", "OPR", "Auto OPR", "Teleop OPR", "Endgame OPR", "World rank", "Ontario rank", "Win rate", "Record", "Official events", "Awards", "Overview"];
	let position = 0;
	const rows = sortedTeams().map(team => [
		team.hasData ? ++position : "",
		team.number,
		team.name,
		team.place,
		tierFor(team)?.label ?? "",
		team.opr?.toFixed(1) ?? "",
		team.auto?.toFixed(1) ?? "",
		team.teleop?.toFixed(1) ?? "",
		team.endgame?.toFixed(1) ?? "",
		team.worldRank ?? "",
		team.ontarioRank ?? "",
		Number.isFinite(team.winRate) ? `${Math.round(team.winRate * 100)}%` : "",
		team.events.length ? ftcRecord(team.record) : "",
		team.events.length,
		team.awards.map(({ award, event }) => `${award} (${event})`).join("; "),
		overview(team, teams)
	]);
	const csv = [header, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
	const link = document.createElement("a");
	link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
	link.download = `ftc-prescout-${season}-${teams.length}-teams.csv`;
	link.click();
	URL.revokeObjectURL(link.href);
}

async function prescout() {
	const numbers = parseTeams(teamsInput.value);
	if (!numbers.length) {
		status.textContent = "Enter at least one FTC team number.";
		results.innerHTML = "";
		return;
	}

	season = seasonSelect.value;
	const thisRun = ++runId;
	ftcSetParams({ teams: numbers.join(","), season });
	prescoutButton.disabled = true;
	status.textContent = `Loading ${numbers.length} team${numbers.length === 1 ? "" : "s"}…`;

	try {
		const data = await ftcFetch(`/api/ftc/prescout?season=${season}&teams=${numbers.join(",")}`);
		if (thisRun !== runId) return;
		const byNumber = new Map(data.map(entry => [entry.team.number, entry]));
		teams = numbers.map(number => byNumber.has(number)
			? teamFromSeason(byNumber.get(number))
			: teamFromSeason({ team: { number }, quickStats: null, events: [] }));
		status.textContent = `Ranked ${teams.length} team${teams.length === 1 ? "" : "s"} on ${season} results.`;
		render();
	} catch (error) {
		if (thisRun === runId) status.textContent = error.message;
	} finally {
		if (thisRun === runId) prescoutButton.disabled = false;
	}
}

/* Import: Ontario events from the newest two seasons (upcoming events first). */
async function fillImportList() {
	const groups = await Promise.all(FTC_SEASONS.slice(0, 2).map(async item => ({ item, events: await ftcEvents(item.year) })));
	eventImport.innerHTML = `<option value="">Choose an event…</option>` + groups
		.filter(group => group.events.length)
		.map(({ item, events }) => `<optgroup label="${ftcEscape(item.label)}">${events
			.map(event => `<option value="${item.year}:${ftcEscape(event.code)}">${ftcEscape(event.name)}${event.start ? ` · ${ftcEventDate(event)}` : ""}</option>`)
			.join("")}</optgroup>`)
		.join("");
}

async function importEvent() {
	const [eventSeason, code] = eventImport.value.split(":");
	if (!code) {
		status.textContent = "Choose an event to import.";
		return;
	}

	importButton.disabled = true;
	status.textContent = `Looking up ${eventImport.selectedOptions[0].text}…`;

	try {
		const numbers = await ftcFetch(`/api/ftc/event-teams/${eventSeason}/${encodeURIComponent(code)}`);
		if (!numbers.length) throw new Error(`${eventImport.selectedOptions[0].text} has no teams published yet. Paste the team list instead.`);
		teamsInput.value = numbers.join(", ");
		prescout();
	} catch (error) {
		status.textContent = error.message;
	} finally {
		importButton.disabled = false;
	}
}

prescoutButton.addEventListener("click", prescout);
importButton.addEventListener("click", importEvent);
teamsInput.addEventListener("keydown", event => {
	if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) prescout();
});
results.addEventListener("change", event => {
	if (event.target.id === "sortSelect") {
		sortKey = event.target.value;
		render();
	}
});
results.addEventListener("click", event => {
	if (event.target.id === "csvButton") downloadCsv();
});

/* ?teams=19498,9999&season=2025 */
(async () => {
	const params = ftcParams();
	ftcFillSeasons(seasonSelect);
	// Prescouting rates teams on a season with results, not the upcoming one.
	if (!params.get("season") && seasonSelect.value === FTC_SEASONS[0].year) seasonSelect.value = FTC_DEFAULT_SEASON;
	fillImportList();
	if (params.get("teams")) {
		teamsInput.value = parseTeams(params.get("teams")).join(", ");
		prescout();
	}
})();
