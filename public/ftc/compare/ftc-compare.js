/* =================================
   FTC TEAM COMPARISON
================================= */

const seasonSelect = document.getElementById("seasonSelect");
const eventSelect = document.getElementById("eventSelect");
const teamAInput = document.getElementById("teamA");
const teamBInput = document.getElementById("teamB");
const compareButton = document.getElementById("compareButton");
const results = document.getElementById("results");

let loadId = 0;

function numericRow(label, a, b, { digits = 1, lowerIsBetter = false, suffix = "" } = {}) {
	const both = Number.isFinite(a) && Number.isFinite(b) && a !== b;
	const aWins = both && (lowerIsBetter ? a < b : a > b);
	const bWins = both && !aWins;
	const cell = value => Number.isFinite(value) ? `${value.toFixed(digits)}${suffix}` : "—";
	return `<tr><td>${ftcEscape(label)}</td><td class="${aWins ? "winner" : ""}">${cell(a)}</td><td class="${bWins ? "winner" : ""}">${cell(b)}</td></tr>`;
}

function textRow(label, a, b) {
	return `<tr><td>${ftcEscape(label)}</td><td>${ftcEscape(a ?? "—")}</td><td>${ftcEscape(b ?? "—")}</td></tr>`;
}

function table(title, a, b, rows) {
	return `
      <h3 class="section-title">${ftcEscape(title)}</h3>
      <table class="comparison-table">
        <thead><tr><th>Stat</th><th>Team ${ftcEscape(a.number)}</th><th>Team ${ftcEscape(b.number)}</th></tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table>`;
}

/* Season summary for one team from /api/ftc/team. */
function seasonProfile(data) {
	const official = data.events.filter(event => event.official && event.stats);
	const record = official.reduce((sum, event) => ({
		wins: sum.wins + event.stats.wins,
		losses: sum.losses + event.stats.losses,
		ties: sum.ties + event.stats.ties
	}), { wins: 0, losses: 0, ties: 0 });
	const played = record.wins + record.losses + record.ties;
	const ranks = official.map(event => event.stats.rank).filter(Number.isFinite);
	const q = data.quickStats;

	return {
		number: data.team.number,
		name: data.team.name,
		place: [data.team.city, data.team.state].filter(Boolean).join(", "),
		opr: q?.total?.value ?? null,
		auto: q?.auto?.value ?? null,
		teleop: q?.teleop?.value ?? null,
		endgame: q?.endgame?.value ?? null,
		worldRank: q?.total?.rank ?? null,
		ontarioRank: data.regionStats?.rank ?? null,
		record,
		winRate: played ? record.wins / played * 100 : null,
		events: official.length,
		bestRank: ranks.length ? Math.min(...ranks) : null,
		awards: data.events.flatMap(event => event.awards)
	};
}

function heading(a, b, scope) {
	return `
      <div class="comparison-heading">
        <div><h2 class="team-name">Team ${ftcEscape(a.number)}</h2><p class="team-detail">${ftcEscape(a.name ?? "")}</p></div>
        <div class="vs">VS</div>
        <div><h2 class="team-name right">Team ${ftcEscape(b.number)}</h2><p class="team-detail right">${ftcEscape(b.name ?? "")}</p></div>
      </div>
      <section class="summary">
        <div class="summary-card">
          <div class="summary-label">OPR edge</div>
          <div class="summary-value">${!Number.isFinite(a.opr) || !Number.isFinite(b.opr) ? "—" : a.opr === b.opr ? "Even" : `Team ${a.opr > b.opr ? a.number : b.number}`}</div>
          <div class="summary-note">${Number.isFinite(a.opr) && Number.isFinite(b.opr) ? `By ${Math.abs(a.opr - b.opr).toFixed(1)} points of OPR (no penalties).` : "Not enough data for both teams."}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Compared on</div>
          <div class="summary-value">${ftcEscape(scope)}</div>
          <div class="summary-note">Green cells mark the stronger value.</div>
        </div>
      </section>`;
}

function renderSeason(dataA, dataB, season) {
	const a = seasonProfile(dataA);
	const b = seasonProfile(dataB);
	const seasonName = FTC_SEASONS.find(item => item.year === season)?.label ?? season;

	results.innerHTML = `
      ${heading(a, b, seasonName)}
      ${table("Season OPR", a, b, [
		numericRow("OPR (no penalties)", a.opr, b.opr),
		numericRow("Auto OPR", a.auto, b.auto),
		numericRow("Teleop OPR", a.teleop, b.teleop),
		numericRow("Endgame OPR", a.endgame, b.endgame),
		numericRow("World rank", a.worldRank, b.worldRank, { digits: 0, lowerIsBetter: true }),
		numericRow("Ontario rank", a.ontarioRank, b.ontarioRank, { digits: 0, lowerIsBetter: true })
	])}
      ${table("Results", a, b, [
		textRow("Record (official events)", a.events ? ftcRecord(a.record) : "—", b.events ? ftcRecord(b.record) : "—"),
		numericRow("Win rate", a.winRate, b.winRate, { digits: 0, suffix: "%" }),
		numericRow("Official events", a.events, b.events, { digits: 0 }),
		numericRow("Best event rank", a.bestRank, b.bestRank, { digits: 0, lowerIsBetter: true }),
		numericRow("Awards", a.awards.length, b.awards.length, { digits: 0 }),
		textRow("Location", a.place, b.place)
	])}
      <p class="ftc-source-note">Data from FTCScout. Scrimmages are left out of records and event counts.</p>`;
}

function renderEvent(eventData, numberA, numberB, season) {
	const { event, teams, matches } = eventData;
	const find = number => teams.find(team => team.number === number);
	const entryA = find(numberA);
	const entryB = find(numberB);
	const missing = [[numberA, entryA], [numberB, entryB]].filter(([, entry]) => !entry).map(([number]) => number);

	if (missing.length) {
		results.innerHTML = `<div class="empty-state">Team ${missing.join(" and ")} ${missing.length > 1 ? "weren't" : "wasn't"} at ${ftcEscape(event.name)}.</div>`;
		return;
	}

	const profile = entry => ({
		number: entry.number,
		name: entry.name,
		opr: entry.stats?.opr?.total ?? null,
		stats: entry.stats
	});
	const a = profile(entryA);
	const b = profile(entryB);
	const shared = matches.filter(match => {
		const all = [...match.red.teams, ...match.blue.teams];
		return all.includes(numberA) && all.includes(numberB);
	});

	results.innerHTML = `
      ${heading(a, b, event.name)}
      ${table("Event performance", a, b, [
		numericRow("Event rank", a.stats?.rank, b.stats?.rank, { digits: 0, lowerIsBetter: true }),
		numericRow("OPR (no penalties)", a.opr, b.opr),
		numericRow("Auto OPR", a.stats?.opr?.auto, b.stats?.opr?.auto),
		numericRow("Teleop OPR", a.stats?.opr?.teleop, b.stats?.opr?.teleop),
		numericRow("Average RP", a.stats?.rp, b.stats?.rp, { digits: 2 }),
		numericRow("Average score", a.stats?.avg?.total, b.stats?.avg?.total),
		textRow("Record", ftcRecord(a.stats), ftcRecord(b.stats))
	])}
      <h3 class="section-title">Matches together or against each other</h3>
      ${shared.length
		? `<section class="match-list">${shared.map(match => ftcMatchCard(match, event, numberA, season)).join("")}</section>`
		: `<div class="empty-state">These teams didn't share a match at this event.</div>`}
      <p class="ftc-source-note">Data from FTCScout. Results are shown from Team ${ftcEscape(numberA)}'s side.</p>`;
}

async function compare() {
	const season = seasonSelect.value;
	const event = eventSelect.value;
	const numberA = Number(teamAInput.value.trim());
	const numberB = Number(teamBInput.value.trim());
	const option = eventSelect.selectedOptions[0];

	ftcSetParams({ season, event, name: option?.dataset.temporary ? option.text : null, teamA: numberA || null, teamB: numberB || null });

	if (!numberA || !numberB) {
		results.innerHTML = `<div class="empty-state">Enter two FTC team numbers to compare.</div>`;
		return;
	}
	if (numberA === numberB) {
		results.innerHTML = `<div class="empty-state">Choose two different teams.</div>`;
		return;
	}

	const thisLoad = ++loadId;
	results.innerHTML = `<div class="loading">Loading comparison…</div>`;

	try {
		if (event === FTC_SEASON_KEY) {
			const [dataA, dataB] = await Promise.all([
				ftcFetch(`/api/ftc/team/${numberA}/${season}`),
				ftcFetch(`/api/ftc/team/${numberB}/${season}`)
			]);
			if (thisLoad === loadId) renderSeason(dataA, dataB, season);
		} else {
			const eventData = await ftcFetch(`/api/ftc/event/${season}/${encodeURIComponent(event)}`);
			if (thisLoad === loadId) renderEvent(eventData, numberA, numberB, season);
		}
	} catch (error) {
		if (thisLoad === loadId) results.innerHTML = `<div class="empty-state">${ftcEscape(error.message)}</div>`;
	}
}

compareButton.addEventListener("click", compare);
[teamAInput, teamBInput].forEach(input => input.addEventListener("keydown", event => {
	if (event.key === "Enter") compare();
}));
seasonSelect.addEventListener("change", async () => {
	await ftcFillEvents(eventSelect, seasonSelect.value, { includeSeason: true, keep: FTC_SEASON_KEY });
	compare();
});
eventSelect.addEventListener("change", compare);

/* ?season=2025&event=season&teamA=19498&teamB=9999 */
(async () => {
	const params = ftcParams();
	ftcFillSeasons(seasonSelect);
	await ftcFillEvents(eventSelect, seasonSelect.value, {
		includeSeason: true,
		keep: params.get("event") ?? FTC_SEASON_KEY,
		keepName: params.get("name")
	});
	teamAInput.value = params.get("teamA") ?? "";
	teamBInput.value = params.get("teamB") ?? "";
	if (teamAInput.value && teamBInput.value) compare();
})();
