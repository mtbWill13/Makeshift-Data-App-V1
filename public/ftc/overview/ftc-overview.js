/* =================================
   FTC EVENT OVERVIEW
   Our own scouting reports next to FTCScout (and, when set up, FIRST's official feed and
   The Orange Alliance): event-wide graphs, a chart builder, a match lookup with predictions
   and a sortable board of every team. A team's own page is on the FTC Data Hub.
================================= */

const $ = id => document.getElementById(id);
const els = {
	season: $("seasonSelect"), event: $("eventSelect"), custom: $("customEvent"), load: $("loadButton"),
	status: $("status"), summary: $("summary"), dashboard: $("dashboard"), matchSelect: $("matchSelect"), previewButton: $("previewButton"), preview: $("preview"),
	inputs: { r1: $("r1"), r2: $("r2"), b1: $("b1"), b2: $("b2") },
	filters: $("filters"), board: $("board"),
	builder: {
		stat: $("builderStat"), chart: $("builderChart"), aggregate: $("builderAggregate"), x: $("builderX"), teams: $("builderTeams"),
		show: $("builderShow"), sort: $("builderSort"), output: $("builderOutput"), aggregateGroup: $("aggregateGroup"), xGroup: $("xGroup")
	},
	counts: $("counts"), sources: $("sources"), exportMatch: $("exportMatch"), exportPit: $("exportPit"),
	openSheet: $("openSheet"), syncSheet: $("syncSheet"), sheetStatus: $("sheetStatus")
};

let game = null;
let picker = null;
let state = null;
let sort = { id: "rank", direction: 1 };
const seasonOprCache = new Map();       // team -> { value, label } when the event has no OPR yet

/* ----- small helpers ----- */

const finite = value => value !== null && value !== undefined && Number.isFinite(Number(value));
const num = (value, digits = 1) => finite(value) ? Number(value).toFixed(digits) : "—";
const pct = value => finite(value) ? `${Math.round(value * 100)}%` : "—";
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const humanize = key => key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, letter => letter.toUpperCase());

function erf(x) {
	const sign = x < 0 ? -1 : 1;
	const t = 1 / (1 + 0.3275911 * Math.abs(x));
	const poly = ((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592;
	return sign * (1 - poly * t * Math.exp(-x * x));
}

const normalCdf = x => 0.5 * (1 + erf(x / Math.SQRT2));

const { profile, tagsFor, tagHtml, optionLabel } = FtcTeamScouting;

/* ----- loading an event ----- */

async function loadEvent() {
	const { season, code } = picker.current();
	if (!code) {
		els.status.textContent = "Pick an event first.";
		return;
	}

	els.status.textContent = "Loading the event…";
	const [event, scouting, schedule, sources, reports] = await Promise.all([
		ftcFetch(`/api/ftc/event/${season}/${code}`).catch(() => null),
		ftcFetch(`/api/ftc/scouting/${season}/${code}/summary`).catch(() => ({ counts: { matches: 0, pits: 0 }, teams: {} })),
		ftcFetch(`/api/ftc/schedule/${season}/${code}`).catch(() => ({ source: null, matches: [] })),
		ftcFetch("/api/ftc/sources").catch(() => null),
		ftcFetch(`/api/ftc/scouting/${season}/${code}/reports`).catch(() => ({ match: [], pit: [] }))
	]);

	const byTeam = new Map();
	const row = team => {
		if (!byTeam.has(team)) byTeam.set(team, { team, name: null, rank: null, opr: null, stats: null, s: null });
		return byTeam.get(team);
	};

	for (const entry of event?.teams ?? []) {
		const item = row(entry.number);
		item.name = entry.name;
		item.rank = entry.stats?.rank ?? null;
		item.opr = entry.stats?.opr ?? null;
		item.stats = entry.stats ?? null;
	}
	for (const match of schedule.matches) {
		for (const side of [match.red, match.blue]) for (const team of side.teams) row(team);
	}
	for (const [team, summary] of Object.entries(scouting.teams)) row(Number(team)).s = summary;

	state = { season, code, event, schedule: schedule.matches, scheduleSource: schedule.source, scouting, rows: [...byTeam.values()], sources, reports };

	els.status.textContent = event
		? `${event.event.name}${event.event.start ? ` · ${event.event.start}` : ""} · ${plural(state.rows.length, "team")}`
		: `${code} isn't on FTCScout${state.rows.length ? "" : "; only our own reports can show here"}.`;

	fillMatches();
	renderBoard();
	renderSources();
	buildStats();
	renderSummary();
	renderDashboard();
	fillBuilder();
	renderBuilder();
	els.preview.innerHTML = `<div class="empty-state">Pick a scheduled match, or type four teams to see how any alliances would match up.</div>`;
}

function renderSources() {
	const counts = state.scouting.counts;
	els.counts.textContent = `${plural(counts.matches, "match report")} and ${plural(counts.pits, "pit report")} saved for this event.`;
	els.exportMatch.href = `/api/ftc/scouting/${state.season}/${state.code}/export.csv?kind=match`;
	els.exportPit.href = `/api/ftc/scouting/${state.season}/${state.code}/export.csv?kind=pit`;
	showSheet();

	const info = state.sources ?? {};
	const rows = [
		["FTCScout", info.ftcscout, "https://ftcscout.org/"],
		["FIRST FTC Events API", info.official, "https://ftc-events.firstinspires.org/services/API"],
		["The Orange Alliance", info.toa, "https://theorangealliance.org/apidocs"],
		["Our scouting reports", info.scouting, null]
	];
	els.sources.innerHTML = rows.map(([name, source, url]) => `
      <li><b class="${source?.configured ? "on" : "off"}">${source?.configured ? "On" : "Not set up"}</b>
        ${url ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${name}</a>` : name}
        <small>${ftcEscape(source?.note ?? "")}</small></li>`).join("");
}

/* The event's Google Sheet, if one is linked (see ftc-sheets.js). */
async function showSheet() {
	els.sheetStatus.textContent = "";
	const { season, code } = state;
	const sheet = await ftcFetch(`/api/ftc/sheet/${season}/${code}`).catch(() => ({ linked: false }));
	if (state.season !== season || state.code !== code) return;

	els.openSheet.hidden = !sheet.linked;
	els.syncSheet.hidden = !sheet.linked;
	if (sheet.linked) els.openSheet.href = sheet.url;
}

els.syncSheet.addEventListener("click", async () => {
	els.syncSheet.disabled = true;
	els.sheetStatus.textContent = "Syncing…";

	try {
		const response = await fetch(`/api/ftc/sheet/${state.season}/${state.code}/sync`, { method: "POST" });
		const data = await response.json().catch(() => ({}));
		if (!response.ok) throw new Error(data.error || "Couldn't sync the sheet.");
		els.sheetStatus.textContent = `Synced: ${plural(data.matches, "match report")}, ${plural(data.pits, "pit report")}, ${plural(data.teams, "team")}, ${plural(data.scheduled, "scheduled match")}.`;
	} catch (error) {
		els.sheetStatus.textContent = error.message;
	} finally {
		els.syncSheet.disabled = false;
	}
});

/* ----- the board ----- */

const COLUMNS = [
	{ id: "team", label: "Team", get: row => row.team, asc: true },
	{ id: "rank", label: "Rank", get: row => row.rank, asc: true, format: value => finite(value) ? value : "—" },
	{ id: "opr", label: "OPR", get: row => row.opr?.total, format: value => num(value) },
	{ id: "reports", label: "Reports", get: row => profile(row).reports, format: value => value || "—" },
	{ id: "leave", label: "Leaves auto", get: row => profile(row).leave, format: pct },
	{ id: "autoPark", label: "Parks auto", get: row => profile(row).autoPark, format: pct },
	{ id: "tips", label: "Hive tips", get: row => profile(row).tips, format: value => num(value) },
	{ id: "points", label: "Est. points", get: row => profile(row).points, format: value => num(value) },
	{ id: "autoPieces", label: "Auto scored", get: row => profile(row).autoPieces, format: value => num(value) },
	{ id: "telePieces", label: "Teleop scored", get: row => profile(row).telePieces, format: value => num(value) },
	{ id: "pollen", label: "Pollen acc.", get: row => profile(row).pollenAccuracy, format: pct },
	{ id: "nectar", label: "Nectar acc.", get: row => profile(row).nectarAccuracy, format: pct },
	{ id: "endPark", label: "Parks end", get: row => profile(row).endPark, format: pct },
	{ id: "removes", label: "Removes pollen", get: row => profile(row).removes, format: pct },
	{ id: "blocker", label: "Blocker", get: row => profile(row).blocker, format: pct },
	{ id: "breakdown", label: "Breakdowns", get: row => profile(row).breakdown, format: pct, asc: true },
	{ id: "driver", label: "Driver", get: row => profile(row).driver, format: value => num(value) },
	{ id: "notes", label: "Notes", get: () => null, noSort: true }
];

const FILTERS = {
	scouted: row => profile(row).scouted,
	blocker: row => (profile(row).blocker ?? 0) >= 0.3,
	removes: row => (profile(row).removes ?? 0) >= 0.3,
	park: row => (profile(row).endPark ?? 0) >= 0.5,
	second: row => profile(row).secondSide,
	tipper: row => (profile(row).tips ?? 0) >= 0.5 || profile(row).canTip,
	reliable: row => profile(row).breakdown !== null && profile(row).breakdown <= 0.15
};

function renderBoard() {
	const active = [...els.filters.querySelectorAll("input:checked")].map(input => input.dataset.filter);
	const column = COLUMNS.find(item => item.id === sort.id) ?? COLUMNS[0];
	const rows = state.rows.filter(row => active.every(name => FILTERS[name](row)));

	rows.sort((a, b) => {
		const left = column.get(a);
		const right = column.get(b);
		if (!finite(left) && !finite(right)) return a.team - b.team;
		if (!finite(left)) return 1;                      // teams with no number go last either way
		if (!finite(right)) return -1;
		return (left - right) * sort.direction || a.team - b.team;
	});

	if (!state.rows.length) {
		els.board.innerHTML = `<div class="empty-state">No teams yet: this event has no team list or schedule and nothing has been scouted.</div>`;
		return;
	}

	els.board.innerHTML = `
      <table class="board">
        <thead><tr>${COLUMNS.map(item => `<th data-column="${item.id}" class="${sort.id === item.id ? "sorted" : ""}${item.id === "notes" ? " left" : ""}">${item.label}${sort.id === item.id ? (sort.direction === 1 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead>
        <tbody>${rows.map(row => `
          <tr>
            <td class="team-cell"><button type="button" data-team="${row.team}">${row.team}</button>${row.name ? `<small>${ftcEscape(row.name)}</small>` : ""}</td>
            ${COLUMNS.slice(1, -1).map(item => {
		const value = item.get(row);
		return `<td class="${finite(value) ? "" : "dim"}">${item.format ? item.format(value) : value}</td>`;
	}).join("")}
            <td class="tags">${tagHtml(tagsFor(row))}</td>
          </tr>`).join("")}
        </tbody>
      </table>`;
}

els.board.addEventListener("click", event => {
	const header = event.target.closest("th[data-column]");
	if (header) {
		const column = COLUMNS.find(item => item.id === header.dataset.column);
		if (column.noSort) return;
		sort = sort.id === column.id ? { id: column.id, direction: -sort.direction } : { id: column.id, direction: column.asc ? 1 : -1 };
		renderBoard();
		return;
	}

	const team = event.target.closest("button[data-team]");
	if (team) window.location.href = teamUrl(Number(team.dataset.team));
});

els.filters.addEventListener("change", () => state && renderBoard());

/* ----- match preview ----- */

function fillMatches() {
	els.matchSelect.innerHTML = `<option value="">Pick a match</option>` + state.schedule.map((match, index) =>
		`<option value="${index}">${ftcEscape(match.label)}: ${match.red.teams.join(", ")} vs ${match.blue.teams.join(", ")}${match.played ? ` (${match.red.score}–${match.blue.score})` : ""}</option>`
	).join("");
	if (!state.schedule.length) els.matchSelect.innerHTML = `<option value="">No schedule yet (type four teams instead)</option>`;
}

els.matchSelect.addEventListener("change", () => {
	const match = state.schedule[Number(els.matchSelect.value)];
	if (!match) return;
	[els.inputs.r1.value, els.inputs.r2.value] = [match.red.teams[0] ?? "", match.red.teams[1] ?? ""];
	[els.inputs.b1.value, els.inputs.b2.value] = [match.blue.teams[0] ?? "", match.blue.teams[1] ?? ""];
	showPreview(match);
});

els.previewButton.addEventListener("click", () => {
	const picked = state?.schedule[Number(els.matchSelect.value)];
	const typed = Object.values(els.inputs).map(input => Number(input.value));
	const same = picked && [...picked.red.teams, ...picked.blue.teams].join() === typed.join();
	showPreview(same ? picked : null);
});

/* The team's event OPR, or (before the event has any) its season or last season's OPR, labelled. */
async function oprFor(row) {
	if (finite(row.opr?.total)) return { value: row.opr.total, label: "event OPR" };
	if (seasonOprCache.has(row.team)) return seasonOprCache.get(row.team);

	let result = { value: null, label: "" };
	for (const season of [state.season, String(Number(state.season) - 1)]) {
		try {
			const data = await ftcFetch(`/api/ftc/team/${row.team}/${season}`);
			if (finite(data.quickStats?.total?.value)) {
				result = { value: data.quickStats.total.value, label: season === state.season ? "season OPR" : `${season} season OPR` };
				break;
			}
		} catch { /* no stats for that season */ }
	}

	seasonOprCache.set(row.team, result);
	return result;
}

/* How far off OPR sums were on the event's played matches (the width of the win-chance curve). */
function oprSpread() {
	const oprs = new Map(state.rows.filter(row => finite(row.opr?.total)).map(row => [row.team, row.opr.total]));
	const errors = [];

	for (const match of state.schedule) {
		if (!match.played) continue;
		for (const side of [match.red, match.blue]) {
			if (!side.teams.length || !side.teams.every(team => oprs.has(team))) continue;
			const predicted = side.teams.reduce((sum, team) => sum + oprs.get(team), 0);
			errors.push((side.score - (finite(side.penalties) ? side.penalties : 0)) - predicted);
		}
	}

	return errors.length >= 8 ? Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / errors.length) : null;
}

/* A team's page on the FTC Data Hub (stats, our scouting, every match). */
const teamUrl = team => ftcTeamUrl(team, state.season, state.code);

const teamRow = team => state.rows.find(row => row.team === team) ?? { team, name: null, rank: null, opr: null, stats: null, s: null };

function teamCard(row, oprInfo) {
	const p = profile(row);
	return `
      <div class="pv-team">
        <div class="pv-team-head">
          <button type="button" data-team="${row.team}">${row.team}</button>
          <span>${ftcEscape(row.name ?? "")}</span>
          ${finite(row.rank) ? `<em>Rank ${row.rank}${row.stats ? ` · ${ftcRecord(row.stats)}` : ""}</em>` : ""}
        </div>
        <dl class="pv-numbers">
          <div><dt>${ftcEscape(oprInfo.label || "OPR")}</dt><dd>${num(oprInfo.value)}</dd></div>
          <div><dt>Hive tips</dt><dd>${num(p.tips)}</dd></div>
          <div><dt>Auto scored</dt><dd>${num(p.autoPieces)}</dd></div>
          <div><dt>Teleop scored</dt><dd>${num(p.telePieces)}</dd></div>
          <div><dt>Leaves auto</dt><dd>${pct(p.leave)}</dd></div>
          <div><dt>Parks end</dt><dd>${pct(p.endPark)}</dd></div>
          ${finite(p.points) ? `<div><dt>Est. points</dt><dd>${num(p.points)}</dd></div>` : ""}
        </dl>
        ${tagHtml(tagsFor(row))}
        <small class="dim">${p.reports ? `${plural(p.reports, "scouting report")}` : "No match reports yet"}${p.pit && Object.keys(p.pit).length ? " · pit scouted" : ""}</small>
      </div>`;
}

/* A few facts a strategy meeting would want, from the tags above. */
function notesFor(red, blue) {
	const notes = [];
	const group = (name, rows) => {
		const list = (predicate, text) => {
			const teams = rows.filter(predicate).map(row => row.team);
			if (teams.length) notes.push(`<b>${name}</b> ${text}: ${teams.join(", ")}.`);
		};
		list(row => (profile(row).tips ?? 0) >= 0.5 || profile(row).canTip, "can tip the hive");
		list(row => (profile(row).clearsGarden ?? 0) >= 0.3, "can clear a garden");
		list(row => (profile(row).blocker ?? 0) >= 0.3, "can play blocker");
		list(row => (profile(row).removes ?? 0) >= 0.3, "can remove pollen from the bottom of a flower");
		list(row => profile(row).secondSide, "can start on the second side");
		list(row => (profile(row).breakdown ?? 0) >= 0.25, "has been breaking down");
		list(row => (profile(row).leave ?? 0) >= 0.8, "reliably leaves in auto");
		list(row => (profile(row).endPark ?? 0) >= 0.6, "usually parks at the end");
	};

	group("Red", red);
	group("Blue", blue);
	return notes;
}

async function showPreview(match) {
	const typed = Object.values(els.inputs).map(input => Number(input.value));
	if (!typed.every(team => Number.isInteger(team) && team > 0)) {
		els.preview.innerHTML = `<div class="empty-state">Enter four team numbers, two per alliance.</div>`;
		return;
	}
	if (new Set(typed).size !== 4) {
		els.preview.innerHTML = `<div class="empty-state">Each alliance needs different teams.</div>`;
		return;
	}

	els.preview.innerHTML = `<div class="loading">Loading the preview…</div>`;
	const red = typed.slice(0, 2).map(teamRow);
	const blue = typed.slice(2).map(teamRow);
	const oprs = new Map();
	await Promise.all([...red, ...blue].map(async row => oprs.set(row.team, await oprFor(row))));

	/* Predictions: the sum of the teams' OPR, and (once the game's points are filled in) scouted points. */
	const predictions = [];
	const sums = rows => rows.every(row => finite(oprs.get(row.team).value)) ? rows.reduce((sum, row) => sum + oprs.get(row.team).value, 0) : null;
	const redOpr = sums(red);
	const blueOpr = sums(blue);

	if (redOpr !== null && blueOpr !== null) {
		const spread = oprSpread() ?? Math.max(10, (redOpr + blueOpr) * 0.2);
		predictions.push({ name: "OPR", note: "FTCScout", red: redOpr, blue: blueOpr, chance: normalCdf((redOpr - blueOpr) / (spread * Math.SQRT2)), spread });
	}

	const scouted = rows => rows.every(row => finite(profile(row).points)) ? rows.reduce((sum, row) => sum + profile(row).points, 0) : null;
	const redScouted = scouted(red);
	const blueScouted = scouted(blue);
	if (redScouted !== null && blueScouted !== null) {
		predictions.push({ name: "Scouted points", note: "our reports", red: redScouted, blue: blueScouted, chance: normalCdf((redScouted - blueScouted) / Math.max(10, (redScouted + blueScouted) * 0.2 * Math.SQRT2)) });
	}

	const alliances = [["Red alliance", "red", red], ["Blue alliance", "blue", blue]];
	const average = predictions.length ? predictions.reduce((sum, item) => sum + item.chance, 0) / predictions.length : null;
	const favourite = average === null ? null : average >= 0.5 ? "red" : "blue";
	const chance = average === null ? null : Math.max(average, 1 - average);

	const outcome = match?.played
		? `${match.winner === "tie" ? "Tie" : `${match.winner === "red" ? "Red" : "Blue"} won`} ${match.red.score}–${match.blue.score}`
		: "Not played yet";

	const verdict = average === null
		? `<p class="setup-note">No OPR yet for these teams, so there's no score prediction. The scouting below still applies.</p>`
		: `
      <div class="pv-verdict ${favourite}">
        <div><span>${chance < 0.6 ? "Too close to call" : "Favoured to win"}</span>
          <strong>${chance < 0.6 ? `${favourite === "red" ? "Red" : "Blue"} ${pct(chance)}` : `${favourite === "red" ? "Red" : "Blue"} alliance · ${pct(chance)}`}</strong>
          <small>Expected score <b class="pv-red">${num(predictions[0].red, 0)}</b> – <b class="pv-blue">${num(predictions[0].blue, 0)}</b> (${ftcEscape(predictions[0].name)})</small></div>
        <div class="pv-bar"><i class="red" style="width:${(average * 100).toFixed(1)}%">Red ${pct(average)}</i><i class="blue" style="width:${((1 - average) * 100).toFixed(1)}%">Blue ${pct(1 - average)}</i></div>
      </div>`;

	const predictionTable = predictions.length ? `
      <h4 class="pv-subtitle">Each prediction</h4>
      <table class="pv-table"><thead><tr><th>Based on</th><th>Red</th><th>Blue</th><th>Red wins</th><th>Blue wins</th></tr></thead><tbody>
        ${predictions.map(item => `<tr><td>${ftcEscape(item.name)} <small class="dim">${ftcEscape(item.note)}</small></td><td class="red">${num(item.red, 0)}</td><td class="blue">${num(item.blue, 0)}</td><td>${pct(item.chance)}</td><td>${pct(1 - item.chance)}</td></tr>`).join("")}
      </tbody></table>` : "";

	const notes = notesFor(red, blue);
	const details = match?.played ? scoreDetailsTable(match) : "";
	const rankingTable = rankingPointsTable(red, blue);

	els.preview.innerHTML = `
      <article class="pv-card">
        <div class="pv-head">
          <div><h3>${ftcEscape(match?.label ?? "Custom match-up")}</h3><p>${ftcEscape(state.event?.event.name ?? state.code)}${state.scheduleSource ? ` · schedule from ${ftcEscape(state.scheduleSource)}` : ""}</p></div>
          <span class="tag">${ftcEscape(outcome)}</span>
        </div>
        ${verdict}
        <div class="pv-alliances">${alliances.map(([title, side, rows]) => `<div class="pv-alliance ${side}"><h4>${title}</h4>${rows.map(row => teamCard(row, oprs.get(row.team))).join("")}</div>`).join("")}</div>
        ${notes.length ? `<h4 class="pv-subtitle">What our scouting says</h4><ul class="pv-notes">${notes.map(note => `<li>${note}</li>`).join("")}</ul>` : ""}
        ${predictionTable}
        ${rankingTable}
        ${details}
        <p class="ftc-source-note">OPR is the average points a team adds to an alliance (penalties left out). The win chance treats the score gap as a bell curve${predictions[0]?.spread ? `, sized by how far off OPR was on this event's played matches` : ""}. Scouting stats are per match, from the reports saved here.</p>
      </article>`;
}

/* Expected ranking-point progress for each alliance, from our scouting: hive tips (POLLINATOR 1 and 2)
   and LEAVE + PARK points (SWARM). Only what the reports support is shown. */
function rankingPointsTable(red, blue) {
	const rules = game.match.rankingPoints;
	/* Adds up the teams we have numbers for, and says how many that is. */
	const total = (rows, key) => {
		const known = rows.map(row => profile(row)[key]).filter(finite);
		return { value: known.length ? known.reduce((sum, value) => sum + value, 0) : null, known: known.length, of: rows.length };
	};
	const side = rows => ({ tips: total(rows, "tips"), swarm: total(rows, "swarm") });
	const [r, b] = [side(red), side(blue)];
	if ([r.tips, b.tips, r.swarm, b.swarm].every(item => item.value === null)) return "";

	const reach = (item, threshold) => item.value === null
		? "—"
		: `${num(item.value)} <small class="dim">${item.value >= threshold ? "✓ reaches" : "needs"} ${threshold}${item.known < item.of ? ` · only ${item.known} of ${item.of} scouted` : ""}</small>`;
	const rows = [
		[`Hive tips <small class="dim">(POLLINATOR RP at ${rules.pollinator.join(" and ")})</small>`, reach(r.tips, rules.pollinator[0]), reach(b.tips, rules.pollinator[0])],
		[`LEAVE + PARK points <small class="dim">(SWARM RP at ${rules.swarm.threshold})</small>`, reach(r.swarm, rules.swarm.threshold), reach(b.swarm, rules.swarm.threshold)]
	];

	return `
      <h4 class="pv-subtitle">Ranking points to expect</h4>
      <table class="pv-table"><thead><tr><th>Per match, from scouting</th><th>Red</th><th>Blue</th></tr></thead><tbody>
        ${rows.map(([label, left, right]) => `<tr><td>${label}</td><td class="red">${left}</td><td class="blue">${right}</td></tr>`).join("")}
      </tbody></table>`;
}

/* FTCScout's own score breakdown for a played match, whatever the game scores. */
function scoreDetailsTable(match) {
	const keys = [...new Set([...Object.keys(match.red.details ?? {}), ...Object.keys(match.blue.details ?? {})])]
		.filter(key => match.red.details?.[key] || match.blue.details?.[key]);
	if (!keys.length) return "";

	const show = value => value === true ? "Yes" : value === false || value === undefined ? "—" : value;
	return `
      <details class="pv-details">
        <summary class="pv-subtitle">Official score breakdown (FTCScout)</summary>
        <table class="pv-table"><thead><tr><th>Scored</th><th>Red</th><th>Blue</th></tr></thead><tbody>
          ${keys.map(key => `<tr><td>${ftcEscape(humanize(key))}</td><td class="red">${show(match.red.details?.[key])}</td><td class="blue">${show(match.blue.details?.[key])}</td></tr>`).join("")}
        </tbody></table>
      </details>`;
}

els.preview.addEventListener("click", event => {
	const team = event.target.closest("button[data-team]");
	if (team) window.location.href = teamUrl(Number(team.dataset.team));
});

/* =================================
   STATS, SUMMARY AND GRAPHS
   Built from the questions in ftc-game.js, so a new season's questions are charted without changes here.
   Kinds: "match" (a number per report), "flag" (yes = 1 / no = 0 per report) and "team" (one number, e.g. OPR).
================================= */

let stats = [];
const LINE_COLOURS = [BRAND.red, BRAND.orange, BRAND.yellow, BRAND.green, BRAND.blue, "#c08de8", "#ef8fb7", "#9be3d6"];

const AGGREGATES = {
	mean: { label: "Average", apply: values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null },
	median: { label: "Median", apply: values => values.length ? quantile([...values].sort((a, b) => a - b), 0.5) : null },
	max: { label: "Best match (max)", apply: values => values.length ? Math.max(...values) : null },
	min: { label: "Worst match (min)", apply: values => values.length ? Math.min(...values) : null },
	total: { label: "Total", apply: values => values.length ? values.reduce((sum, value) => sum + value, 0) : null },
	count: { label: "Count (times yes)", apply: values => values.length ? values.filter(Boolean).length : null },
	rate: { label: "% of matches", apply: values => values.length ? values.filter(Boolean).length / values.length * 100 : null }
};

const statById = id => stats.find(stat => stat.id === id);

/* Every team's reports at this event: all of them, and the ones where the robot played. */
function reportsByTeam() {
	const byTeam = new Map();
	for (const report of state.reports.match ?? []) {
		if (!byTeam.has(report.team)) byTeam.set(report.team, { rows: [], played: [] });
		const entry = byTeam.get(report.team);
		entry.rows.push(report);
		if (report.noShow !== "yes") entry.played.push(report);
	}
	return byTeam;
}

function buildStats() {
	stats = [];
	state.byTeam = reportsByTeam();

	const sections = game.match.sections;
	const fields = sections.flatMap(section => section.fields.map(field => ({ ...field, section: section.title })));
	const count = (report, ids) => ids.reduce((total, id) => total + (Number(report.data[id]) || 0), 0);
	const scored = fields.filter(field => field.type === "count" && /Scored$/.test(field.id)).map(field => field.id);
	const worth = (report, id, value) => report.data[id] === "yes" ? value : (Number(report.data[id]) || 0) * value;

	const add = (id, label, short, value, extra = {}) => stats.push({ id, label, short, kind: "match", value, ...extra });
	const points = game.match.points;
	const ranking = game.match.rankingPoints;

	if (Object.keys(points).length) add("points", "Estimated points per match (from the game's point values)", "Est. points", report => Object.entries(points).reduce((total, [id, value]) => total + worth(report, id, value), 0));
	add("tips", "Hive tips (auto + teleop)", "Hive tips", report => count(report, ranking.tipFields));
	add("pieces", "Pollen and nectar scored (all)", "Pieces scored", report => count(report, scored));
	add("autoPieces", "Pollen and nectar scored in auto", "Auto scored", report => count(report, scored.filter(id => id.startsWith("auto"))));
	add("telePieces", "Pollen and nectar scored in teleop", "Teleop scored", report => count(report, scored.filter(id => id.startsWith("tele"))));
	add("swarm", "Leave + park points", "Leave + park", report => Object.entries(ranking.swarm.fields).reduce((total, [id, value]) => total + worth(report, id, value), 0));

	for (const field of fields) {
		if (field.type === "count") {
			add(`field:${field.id}`, `${field.section}: ${field.label}`, field.label, report => report.data[field.id] === undefined ? null : Number(report.data[field.id]));
		} else if (field.type === "yesno") {
			stats.push({ id: `field:${field.id}`, label: field.label, short: field.label, kind: "flag", value: report => report.data[field.id] === "yes" ? 1 : report.data[field.id] === "no" ? 0 : null });
		} else if (field.type === "scale") {
			add(`field:${field.id}`, `${field.label} (1 poor, 5 excellent)`, field.label, report => report.data[field.id] === undefined ? null : Number(report.data[field.id]));
		}
	}
	stats.push({ id: "noShow", label: "No shows", short: "No shows", kind: "flag", includeNoShows: true, value: report => report.noShow === "yes" ? 1 : 0 });

	stats.push({ id: "opr", label: "OPR (FTCScout)", short: "OPR", kind: "team", value: team => teamRow(team).opr?.total ?? null });
	stats.push({ id: "autoOpr", label: "Auto OPR (FTCScout)", short: "Auto OPR", kind: "team", value: team => teamRow(team).opr?.auto ?? null });
	stats.push({ id: "teleOpr", label: "Teleop OPR (FTCScout)", short: "Teleop OPR", kind: "team", value: team => teamRow(team).opr?.teleop ?? null });
}

function teamValues(stat, team) {
	const entry = state.byTeam.get(team);
	if (!entry || stat.kind === "team") return [];
	return (stat.includeNoShows ? entry.rows : entry.played).map(stat.value).filter(value => value !== null);
}

const aggregatesFor = stat => stat.kind === "team" ? [] : stat.kind === "flag" ? ["count", "rate"] : ["mean", "median", "max", "min", "total"];
const teamValue = (stat, team, aggregate) => stat.kind === "team" ? stat.value(team) : AGGREGATES[aggregate ?? (stat.kind === "flag" ? "rate" : "mean")].apply(teamValues(stat, team));
const allTeams = () => state.rows.map(row => row.team).sort((a, b) => a - b);

/* ----- summary cards ----- */

function renderSummary() {
	const reports = state.reports.match ?? [];
	const played = reports.filter(report => report.noShow !== "yes");
	const scouts = new Set([...reports, ...(state.reports.pit ?? [])].map(report => String(report.scout ?? "").trim()).filter(Boolean));
	const best = statById("points") ?? statById("tips");
	const top = best ? [...state.byTeam.keys()].map(team => ({ team, value: teamValue(best, team, "mean") })).filter(item => item.value !== null).sort((a, b) => b.value - a.value)[0] : null;

	els.summary.innerHTML = `
      <div class="stat-card"><div class="stat-label">Teams at the event</div><div class="stat-value">${state.rows.length}</div><div class="stat-description">${state.byTeam.size} scouted so far</div></div>
      <div class="stat-card"><div class="stat-label">Match reports</div><div class="stat-value">${played.length}</div><div class="stat-description">${reports.length - played.length} no-shows left out</div></div>
      <div class="stat-card"><div class="stat-label">Scouts</div><div class="stat-value">${scouts.size}</div><div class="stat-description">People who submitted reports</div></div>
      <div class="stat-card"><div class="stat-label">Top scouted average</div><div class="stat-value">${top ? top.team : "—"}</div><div class="stat-description">${top ? `${top.value.toFixed(1)} ${best.short.toLowerCase()} per match` : "No scouting data yet"}</div></div>`;
}

/* ----- graph cards ----- */

const chartCard = (id, title, description, chartHtml) => `
      <article class="overview-chart" data-chart-id="${id}">
        <div class="overview-chart-heading">
          <div><h3>${ftcEscape(title)}</h3><p>${ftcEscape(description)}</p></div>
          <button class="secondary-button download-chart" type="button" data-title="${ftcEscape(title)}">Download PNG</button>
        </div>
        <div class="chart-scroll">${chartHtml}</div>
      </article>`;

function rankedBoxPlot(stat, yLabel) {
	const groups = [...state.byTeam.keys()]
		.map(team => ({ team, values: teamValues(stat, team) }))
		.filter(group => group.values.length)
		.map(group => ({ ...group, mean: AGGREGATES.mean.apply(group.values) }))
		.sort((a, b) => b.mean - a.mean);

	return boxPlot(groups.map((group, index) => ({
		label: String(group.team), values: group.values,
		colour: rankColour(groups.length > 1 ? index / (groups.length - 1) : 0), href: teamUrl(group.team)
	})), { yLabel, xLabel: "Team number", title: stat.label });
}

function countBars(stat, yLabel) {
	const items = [...state.byTeam.keys()]
		.map(team => ({ team, values: teamValues(stat, team) }))
		.map(item => ({ ...item, count: item.values.filter(Boolean).length }))
		.filter(item => item.count > 0)
		.sort((a, b) => b.count - a.count || a.team - b.team);
	const max = Math.max(1, ...items.map(item => item.count));

	return barChart(items.map(item => ({
		label: String(item.team), value: item.count, colour: heatColour(max > 1 ? (item.count - 1) / (max - 1) : 1),
		title: `${item.team}: ${item.count} of ${item.values.length} matches`, href: teamUrl(item.team)
	})), { yLabel, xLabel: "Team number", title: stat.label, empty: `No ${stat.label.toLowerCase()} reported at this event.` });
}

function rateBars(stat, yLabel) {
	const items = [...state.byTeam.keys()]
		.map(team => ({ team, values: teamValues(stat, team) }))
		.filter(item => item.values.length)
		.map(item => ({ ...item, rate: item.values.filter(Boolean).length / item.values.length * 100 }))
		.sort((a, b) => b.rate - a.rate || a.team - b.team);

	return barChart(items.map((item, index) => ({
		label: String(item.team), value: item.rate, colour: rankColour(items.length > 1 ? index / (items.length - 1) : 0),
		title: `${item.team}: ${Math.round(item.rate)}% (${item.values.filter(Boolean).length} of ${item.values.length} matches)`, href: teamUrl(item.team)
	})), { yLabel, xLabel: "Team number", title: stat.label, yMax: 100 });
}

function averageBars(stat, yLabel) {
	const items = [...state.byTeam.keys()]
		.map(team => ({ team, values: teamValues(stat, team) }))
		.filter(item => item.values.length)
		.map(item => ({ ...item, mean: AGGREGATES.mean.apply(item.values) }))
		.sort((a, b) => b.mean - a.mean);

	return barChart(items.map((item, index) => ({
		label: String(item.team), value: item.mean, colour: rankColour(items.length > 1 ? index / (items.length - 1) : 0),
		title: `${item.team}: ${item.mean.toFixed(1)} on average over ${item.values.length} matches`, href: teamUrl(item.team)
	})), { yLabel, xLabel: "Team number", title: stat.label });
}

function teamStatBars(stat) {
	const items = allTeams().map(team => ({ team, value: stat.value(team) })).filter(item => Number.isFinite(item.value)).sort((a, b) => b.value - a.value);
	return barChart(items.map((item, index) => ({
		label: String(item.team), value: item.value, colour: rankColour(items.length > 1 ? index / (items.length - 1) : 0),
		title: `${item.team}: ${item.value.toFixed(1)}`, href: teamUrl(item.team)
	})), { yLabel: stat.short, xLabel: "Team number", title: stat.label, empty: `No ${stat.short} data for this event.` });
}

function scoutingVsOpr() {
	const stat = statById("points") ?? statById("pieces");
	const opr = statById("opr");
	const points = [...state.byTeam.keys()].map(team => ({ label: String(team), x: opr.value(team), y: teamValue(stat, team, "mean"), colour: BRAND.orange, href: teamUrl(team) }));
	return scatterChart(points, { xLabel: "OPR (FTCScout)", yLabel: `${stat.short} (scouted average)`, xName: "OPR", yName: stat.short, title: `${stat.short} vs OPR` });
}

function renderDashboard() {
	const cards = [];
	const add = (id, title, description, html) => cards.push(chartCard(id, title, description, html));
	const has = id => statById(id) && state.reports.match?.length;

	if (!state.reports.match?.length) {
		cards.push(`<div class="empty-state">No match reports for this event yet, so only FTCScout's OPR is graphed. Scout a match and it appears here.</div>`);
	}

	if (has("points")) add("points", "Estimated Points", "Points each robot adds per match, from the game's point values (hive tips, parking, flowers, gardens).", rankedBoxPlot(statById("points"), "Estimated points"));
	if (has("tips")) add("tips", "Hive Tips", "Hive tips per match (20 points each, and the ranking points at 4 and 7).", rankedBoxPlot(statById("tips"), "Hive tips"));
	if (has("telePieces")) add("tele", "Teleop Scoring", "Pollen and nectar scored in teleop per match.", rankedBoxPlot(statById("telePieces"), "Teleop scored"));
	if (has("autoPieces")) add("auto", "Auto Scoring", "Pollen and nectar scored in auto per match.", rankedBoxPlot(statById("autoPieces"), "Auto scored"));
	if (has("field:teleParks")) add("parks", "Parks at the End", "How often each robot ended teleop parked.", rateBars(statById("field:teleParks"), "% of matches"));
	if (has("field:autoLeave")) add("leave", "Leaves in Auto", "How often each robot left the wall in auto.", rateBars(statById("field:autoLeave"), "% of matches"));
	if (has("field:breakdown")) add("breakdown", "Breakdown Counts", "Matches where the robot broke down.", countBars(statById("field:breakdown"), "Breakdowns"));
	if (has("field:blocker")) add("blocker", "Blocker Counts", "Matches where the robot played blocker.", countBars(statById("field:blocker"), "Matches as blocker"));
	if (has("field:minorFouls")) add("fouls", "Minor Fouls", "Minor fouls scouts saw, per match.", averageBars(statById("field:minorFouls"), "Minor fouls per match"));
	if (has("field:driver")) add("driver", "Driver Skill", "Scouts rate each driver 1 (poor) to 5 (excellent).", averageBars(statById("field:driver"), "Driver skill"));
	if ((statById("points") || statById("pieces")) && state.byTeam.size && state.rows.some(row => finite(row.opr?.total))) add("vs-opr", "Scouting vs OPR", "Does our scouting agree with FTCScout's OPR? Each dot is a team.", scoutingVsOpr());
	if (state.rows.some(row => finite(row.opr?.total))) add("opr", "OPR", "Offensive Power Rating from FTCScout (penalties left out).", teamStatBars(statById("opr")));

	els.dashboard.innerHTML = cards.join("");
}

/* ----- chart builder ----- */

const CHART_TYPES = {
	box: { label: "Box plot (spread per match)", kinds: ["match"] },
	bar: { label: "Bar chart", kinds: ["match", "flag", "team"] },
	line: { label: "Line over matches", kinds: ["match", "flag"] },
	scatter: { label: "Scatter vs another stat", kinds: ["match", "flag", "team"] }
};

function fillBuilder() {
	const builder = els.builder;
	const groups = [["Our scouting", stats.filter(stat => stat.kind !== "team")], ["FTCScout", stats.filter(stat => stat.kind === "team")]];
	const options = groups.map(([name, list]) => `<optgroup label="${name}">${list.map(stat => `<option value="${ftcEscape(stat.id)}">${ftcEscape(stat.label)}</option>`).join("")}</optgroup>`).join("");
	builder.stat.innerHTML = options;
	builder.x.innerHTML = options;
	builder.stat.value = statById("points") ? "points" : statById("tips") ? "tips" : "opr";
	builder.x.value = "opr";
	syncBuilderControls();
}

function syncBuilderControls() {
	const builder = els.builder;
	const stat = statById(builder.stat.value);
	if (!stat) return;

	const allowed = Object.entries(CHART_TYPES).filter(([, type]) => type.kinds.includes(stat.kind));
	const wantedChart = builder.chart.value;
	builder.chart.innerHTML = allowed.map(([id, type]) => `<option value="${id}">${type.label}</option>`).join("");
	builder.chart.value = allowed.some(([id]) => id === wantedChart) ? wantedChart : allowed[0][0];

	const aggregates = aggregatesFor(stat);
	builder.aggregate.innerHTML = aggregates.map(id => `<option value="${id}">${AGGREGATES[id].label}</option>`).join("");
	builder.aggregate.value = aggregates.includes(stat.kind === "flag" ? "rate" : "mean") ? (stat.kind === "flag" ? "rate" : "mean") : (aggregates[0] ?? "");

	builder.aggregateGroup.hidden = builder.chart.value !== "bar" || !aggregates.length;
	builder.xGroup.hidden = builder.chart.value !== "scatter";
}

/* The teams to chart: those typed in the box, or everyone, then trimmed and ordered. */
function chosenTeams(stat, aggregate) {
	const builder = els.builder;
	const typed = [...new Set(builder.teams.value.match(/\d{1,5}/g) ?? [])].map(Number);
	const base = typed.length ? typed : [...new Set([...state.byTeam.keys(), ...(stat.kind === "team" ? allTeams() : [])])];
	let picked = base.map(team => ({ team, value: teamValue(stat, team, aggregate) })).filter(item => typed.length || Number.isFinite(item.value));

	const better = stat.lowerIsBetter ? (a, b) => a.value - b.value : (a, b) => b.value - a.value;
	const sortMode = builder.sort.value;
	picked.sort((a, b) => {
		if (sortMode === "team") return a.team - b.team;
		if (!Number.isFinite(a.value)) return 1;
		if (!Number.isFinite(b.value)) return -1;
		return sortMode === "low" ? a.value - b.value : better(a, b) * (sortMode === "high" ? 1 : 1) || a.team - b.team;
	});

	const show = builder.show.value;
	if (!typed.length && show !== "all") {
		const size = show === "top20" ? 20 : 10;
		picked = show === "bottom10" ? [...picked].reverse().slice(0, size).reverse() : picked.slice(0, size);
	}

	return { picked, typed };
}

function renderBuilder() {
	const builder = els.builder;
	const stat = statById(builder.stat.value);
	if (!stat || !state) return;

	const chart = builder.chart.value;
	const aggregate = builder.aggregate.value || undefined;
	const unit = stat.kind === "flag" && aggregate === "rate" ? `${stat.short} (% of matches)` : stat.kind === "flag" ? `${stat.short} (count)` : stat.short;
	const { picked, typed } = chosenTeams(stat, aggregate);
	const colourAt = index => rankColour(picked.length > 1 ? index / (picked.length - 1) : 0);
	let html;
	let title;

	if (chart === "box") {
		title = `${stat.short} per match`;
		html = boxPlot(picked.map((item, index) => ({ label: String(item.team), values: teamValues(stat, item.team), colour: colourAt(index), href: teamUrl(item.team) })), { yLabel: stat.short, xLabel: "Team number", title });
	} else if (chart === "bar") {
		title = stat.kind === "team" ? stat.short : stat.kind === "flag" ? `${stat.short} (${aggregate === "rate" ? "% of matches" : "count"})` : `${AGGREGATES[aggregate].label} ${stat.short.toLowerCase()}`;
		html = barChart(picked.map((item, index) => ({
			label: String(item.team), value: item.value, colour: colourAt(index),
			title: `${item.team}: ${Number.isFinite(item.value) ? item.value.toFixed(1) : "no data"}${stat.kind === "team" ? "" : ` (${teamValues(stat, item.team).length} matches)`}`, href: teamUrl(item.team)
		})), { yLabel: unit, xLabel: "Team number", title, empty: "No values for these teams." });
	} else if (chart === "line") {
		const lineTeams = typed.length ? picked.slice(0, 8) : picked.slice(0, 6);
		title = `${stat.short} by match`;
		html = lineChart(lineTeams.map((item, index) => ({
			label: String(item.team), colour: LINE_COLOURS[index % LINE_COLOURS.length],
			points: (state.byTeam.get(item.team)?.[stat.includeNoShows ? "rows" : "played"] ?? []).map(report => ({ x: report.matchNumber, y: stat.value(report) })).filter(point => point.y !== null)
		})), { yLabel: stat.short, xLabel: "Qualification match", xName: "match", title })
			+ (!typed.length && picked.length > 6 ? `<p class="chart-caption">Showing the top 6 teams. Type team numbers above to choose which lines to show (up to 8).</p>` : "");
	} else {
		const xStat = statById(builder.x.value);
		const xAggregate = xStat.kind === "flag" ? "rate" : "mean";
		title = `${stat.short} vs ${xStat.short}`;
		html = scatterChart(picked.map(item => ({ label: String(item.team), x: teamValue(xStat, item.team, xAggregate), y: item.value, colour: BRAND.orange, href: teamUrl(item.team) })), {
			xLabel: `${xStat.short}${xStat.kind === "match" ? " (average)" : xStat.kind === "flag" ? " (% of matches)" : ""}`, yLabel: unit, xName: xStat.short, yName: stat.short, title
		});
	}

	const missing = typed.filter(team => stat.kind === "team" ? !Number.isFinite(stat.value(team)) : !teamValues(stat, team).length);
	if (missing.length) html += `<p class="chart-caption">No ${ftcEscape(stat.short.toLowerCase())} data at this event for team ${missing.join(", ")}.</p>`;

	builder.output.innerHTML = chartCard("builder", title, `${state.event?.event.name ?? state.code} • ${picked.length - missing.length} team${picked.length - missing.length === 1 ? "" : "s"}`, html);
}

els.builder.stat.addEventListener("change", () => { syncBuilderControls(); renderBuilder(); });
els.builder.chart.addEventListener("change", () => { syncBuilderControls(); renderBuilder(); });
[els.builder.aggregate, els.builder.x, els.builder.show, els.builder.sort].forEach(control => control.addEventListener("change", renderBuilder));
els.builder.teams.addEventListener("input", () => {
	clearTimeout(els.builder.teams.timer);
	els.builder.teams.timer = setTimeout(renderBuilder, 300);
});

document.addEventListener("click", event => {
	const button = event.target.closest(".download-chart");
	if (!button) return;
	const svgElement = button.closest(".overview-chart")?.querySelector("svg");
	if (svgElement) {
		const name = button.dataset.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
		downloadChartPng(svgElement, `${state.code}-${name}.png`, `${button.dataset.title}: ${state.event?.event.name ?? state.code}`);
	}
});

/* ----- start ----- */

els.load.addEventListener("click", loadEvent);

(async () => {
	try {
		game = await ftcFetch("/api/ftc/game");
	} catch (error) {
		els.status.textContent = `Couldn't load the game definition: ${error.message}`;
		return;
	}

	FtcTeamScouting.setGame(game);
	picker = await FtcScout.eventPicker({ seasonSelect: els.season, eventSelect: els.event, customInput: els.custom });
	await loadEvent();
})();
