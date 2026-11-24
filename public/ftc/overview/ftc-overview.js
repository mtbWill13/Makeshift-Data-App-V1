/* =================================
   FTC STRATEGY BOARD
   Puts our own scouting reports next to FTCScout (and, when set up, FIRST's official
   feed and The Orange Alliance): a match preview with predictions, a sortable board of
   every team at the event, and a page per team.
================================= */

const $ = id => document.getElementById(id);
const els = {
	season: $("seasonSelect"), event: $("eventSelect"), custom: $("customEvent"), load: $("loadButton"),
	status: $("status"), matchSelect: $("matchSelect"), previewButton: $("previewButton"), preview: $("preview"),
	inputs: { r1: $("r1"), r2: $("r2"), b1: $("b1"), b2: $("b2") },
	filters: $("filters"), board: $("board"), detail: $("teamDetail"),
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
	const [event, scouting, schedule, sources] = await Promise.all([
		ftcFetch(`/api/ftc/event/${season}/${code}`).catch(() => null),
		ftcFetch(`/api/ftc/scouting/${season}/${code}/summary`).catch(() => ({ counts: { matches: 0, pits: 0 }, teams: {} })),
		ftcFetch(`/api/ftc/schedule/${season}/${code}`).catch(() => ({ source: null, matches: [] })),
		ftcFetch("/api/ftc/sources").catch(() => null)
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

	state = { season, code, event, schedule: schedule.matches, scheduleSource: schedule.source, scouting, rows: [...byTeam.values()], sources };

	els.status.textContent = event
		? `${event.event.name}${event.event.start ? ` · ${event.event.start}` : ""} · ${plural(state.rows.length, "team")}`
		: `${code} isn't on FTCScout${state.rows.length ? "" : "; only our own reports can show here"}.`;

	fillMatches();
	renderBoard();
	renderSources();
	els.detail.innerHTML = "";
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
	if (team) openTeam(Number(team.dataset.team));
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
	if (team) openTeam(Number(team.dataset.team));
});

/* ----- one team ----- */

async function openTeam(team) {
	els.detail.innerHTML = `<div class="team-detail"><div class="loading">Loading team ${team}…</div></div>`;
	els.detail.scrollIntoView({ behavior: "smooth", block: "start" });

	const [mine, links, season] = await Promise.all([
		ftcFetch(`/api/ftc/scouting/${state.season}/${state.code}/team/${team}`).catch(() => null),
		ftcFetch(`/api/ftc/team-links/${state.season}/${team}`).catch(() => null),
		ftcFetch(`/api/ftc/team/${team}/${state.season}`).catch(() => null)
	]);

	const row = { ...teamRow(team), s: mine?.summary ?? teamRow(team).s };
	const info = links?.toa ?? links?.team ?? {};
	const place = [info.city, info.state, info.country].filter(Boolean).join(", ");
	const quick = season?.quickStats;
	const card = (label, value, note = "") => `<div><dt>${label}</dt><dd>${value}${note ? `<small>${ftcEscape(note)}</small>` : ""}</dd></div>`;
	const reports = mine?.matchReports ?? [];
	const flagged = reports.filter(report => report.flagged).length;

	els.detail.innerHTML = `
      <section class="team-detail">
        <h3>${team}${info.name ? ` · ${ftcEscape(info.name)}` : ""}</h3>
        <p class="team-subtitle">${ftcEscape(place)}${info.rookieYear ? ` · rookie year ${info.rookieYear}` : ""}${links?.team?.school ? ` · ${ftcEscape(links.team.school)}` : ""}</p>
        <div class="links">${(links?.links ?? []).map(link => `<a class="back-link" href="${ftcEscape(link.url)}" target="_blank" rel="noopener noreferrer">${ftcEscape(link.label)} ↗</a>`).join("")}${state.event ? "" : ""}</div>
        <dl class="detail-grid">
          ${card("Event rank", finite(row.rank) ? row.rank : "—", row.stats ? ftcRecord(row.stats) : "")}
          ${card("Event OPR", num(row.opr?.total), row.opr ? `auto ${num(row.opr.auto)} · teleop ${num(row.opr.teleop)}` : "")}
          ${card("Season OPR", num(quick?.total?.value), quick?.total?.rank ? `world rank ${quick.total.rank} of ${quick.teamCount}` : "")}
          ${FtcTeamScouting.cardsHtml(row, mine)}
        </dl>
        ${flagged ? `<p class="check-this">${plural(flagged, "report")} flagged "check this": the scout wasn't sure they got ${flagged === 1 ? "it" : "them"} right.</p>` : ""}
        ${tagHtml(tagsFor(row))}
        ${FtcTeamScouting.pitHtml(mine)}
        <h4 class="pv-subtitle">Match reports (${reports.length})</h4>
        <div class="report-list">${FtcTeamScouting.reportCardsHtml(mine) || `<div class="empty-state">No match reports for this team yet.</div>`}</div>
      </section>`;
}

els.detail.addEventListener("click", event => {
	const team = event.target.closest("button[data-team]");
	if (team) openTeam(Number(team.dataset.team));
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
