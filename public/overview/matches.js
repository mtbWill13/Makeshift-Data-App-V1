/* =================================
   MATCH LOOKUP
   Search a match of the selected event: who's playing (with a little about each
   team) and a score prediction from three sources: Statbotics EPA, TBA OPR and
   our own scouting average, each with the chance either alliance wins.

   Prediction: an alliance's score is the sum of its teams' values. The gap
   between the alliances is treated as a bell curve around the predicted gap;
   its width comes from how far off that same source was on the event's matches
   already played (or, before enough matches are played, from the teams' own
   spread). Teams missing a value are filled in with the event's typical team.
================================= */

const matchInput = document.getElementById("matchInput");
const matchSearch = document.getElementById("matchSearch");
const matchResult = document.getElementById("matchResult");

const MIN_CALIBRATION_ALLIANCES = 10;
const MIN_SIGMA = 5;
const FALLBACK_SPREAD = 0.25;   // fraction of the predicted score, when nothing better is known

let matchData = null;           // { event, matches, rankings } for the selected event
let matchLoadId = 0;

function erf(x) {
	const sign = x < 0 ? -1 : 1;
	const t = 1 / (1 + 0.3275911 * Math.abs(x));
	const poly = ((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592;
	return sign * (1 - poly * t * Math.exp(-x * x));
}

const normalCdf = x => 0.5 * (1 + erf(x / Math.SQRT2));

const matchLabel = match => {
	const code = match.key.split("_")[1] ?? "";
	const parsed = /^(qm|ef|qf|sf|f)(\d+)?(?:m(\d+))?$/.exec(code);
	if (!parsed) return code || "Match";
	const [, level, first, second] = parsed;
	if (level === "qm") return `Qualification ${first}`;
	const names = { ef: "Eighthfinal", qf: "Quarterfinal", sf: "Semifinal", f: "Final" };
	return level === "f" ? `Final ${second ?? first}` : `${names[level]} ${first} • Match ${second ?? 1}`;
};

const teamNumbers = alliance => (alliance?.team_keys ?? []).map(key => Number(String(key).replace(/^frc/, "")));
const isPlayed = match => match.red?.score >= 0 && match.blue?.score >= 0 && match.red.score !== null && match.blue.score !== null;

/* ----- per-team numbers ----- */

function scoutedProfile(team) {
	const total = statById("total");
	const values = total ? teamValues(total, team) : [];
	const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
	const spread = values.length > 1 ? Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)) : null;
	const average = id => {
		const stat = statById(id);
		const list = stat ? teamValues(stat, team) : [];
		return list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : null;
	};
	const count = id => {
		const stat = statById(id);
		return stat ? teamValues(stat, team).filter(Boolean).length : null;
	};
	const defenseStat = statById("defense");
	const defense = defenseStat ? teamValues(defenseStat, team) : [];

	return {
		mean, spread, reports: data.byTeam.get(team)?.played.length ?? 0,
		auto: average("auto"), teleop: average("teleop"), climb: average("climb"),
		breakdowns: count("breakdown"),
		defenseGames: defense.length
	};
}

const SOURCES = [
	{
		id: "epa", label: "EPA", note: "Statbotics",
		value: team => data.epa.get(team) ?? null,
		spread: team => data.epaSd?.get(team) ?? null
	},
	{
		id: "opr", label: "OPR", note: "The Blue Alliance",
		value: team => data.opr.get(team) ?? null,
		spread: () => null
	},
	{
		id: "scouting", label: "Scouting average", note: "our match reports",
		value: team => scoutedProfile(team).mean,
		spread: team => scoutedProfile(team).spread
	}
];

/* The typical team's value for a source, used for a team with no number. */
function typicalValue(source) {
	const values = allTeams().map(source.value).filter(Number.isFinite).sort((a, b) => a - b);
	return values.length ? values[Math.floor(values.length / 2)] : null;
}

function predictAlliance(source, teams, typical) {
	let total = 0;
	let missing = 0;
	let spreadSquares = 0;
	let spreadKnown = true;

	for (const team of teams) {
		let value = source.value(team);
		if (!Number.isFinite(value)) {
			missing += 1;
			value = typical;
		}
		if (!Number.isFinite(value)) return null;
		total += value;

		const spread = source.spread(team);
		if (Number.isFinite(spread)) spreadSquares += spread ** 2;
		else spreadKnown = false;
	}

	return { score: total, missing, teamSpread: spreadKnown && !missing ? Math.sqrt(spreadSquares) : null };
}

/* How far off the source is on alliances that have already played (RMS error). */
function calibration(source, typical) {
	const errors = [];

	for (const match of matchData.matches) {
		if (!isPlayed(match) || !match.key.split("_")[1]?.startsWith("qm")) continue;
		for (const side of [match.red, match.blue]) {
			const prediction = predictAlliance(source, teamNumbers(side), typical);
			if (prediction && !prediction.missing) errors.push(side.score - prediction.score);
		}
	}

	return errors.length >= MIN_CALIBRATION_ALLIANCES
		? { sigma: Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / errors.length), samples: errors.length }
		: null;
}

function predictMatch(match) {
	const red = teamNumbers(match.red);
	const blue = teamNumbers(match.blue);

	return SOURCES.map(source => {
		const typical = typicalValue(source);
		const redPrediction = predictAlliance(source, red, typical);
		const bluePrediction = predictAlliance(source, blue, typical);
		if (!redPrediction || !bluePrediction) return { source, unavailable: true };

		const fitted = calibration(source, typical);
		const sigmaFor = prediction => Math.max(MIN_SIGMA, fitted?.sigma ?? prediction.teamSpread ?? prediction.score * FALLBACK_SPREAD);
		const sigma = Math.sqrt(sigmaFor(redPrediction) ** 2 + sigmaFor(bluePrediction) ** 2);
		const redWin = normalCdf((redPrediction.score - bluePrediction.score) / sigma);

		return {
			source, red: redPrediction.score, blue: bluePrediction.score, redWin, blueWin: 1 - redWin,
			missing: redPrediction.missing + bluePrediction.missing,
			basis: fitted ? `${fitted.samples} played alliances` : "team spread"
		};
	});
}

/* ----- loading ----- */

async function loadMatchData() {
	const event = data.event;
	const thisLoad = ++matchLoadId;
	const [matches, rankings] = await Promise.all([
		fetchJson(`/api/events/${event}/matches`, []),
		fetchJson(`/api/events/${event}/rankings`, [])
	]);

	if (thisLoad !== matchLoadId || event !== data?.event) return false;
	matchData = { event, matches: Array.isArray(matches) ? matches : [], rankings: Array.isArray(rankings) ? rankings : [] };
	return true;
}

/* "12" is qualification 12; "sf2m1", "qf3m1", "f1m2" name playoff matches. */
function findMatch(text) {
	const query = text.trim().toLowerCase().replace(/\s+/g, "");
	if (!query) return null;
	const code = /^\d+$/.test(query) ? `qm${query}` : query;
	return matchData.matches.find(match => match.key.split("_")[1] === code) ?? null;
}

/* ----- display ----- */

const fixed = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : "—";
const percent = value => `${Math.round(value * 100)}%`;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

/* Defence from our scouting: how often a team plays it, and how well (1 = incredible, 5 = poor). */
function defenseProfile(team) {
	const stat = statById("defense");
	const ratings = stat ? teamValues(stat, team) : [];
	const played = data.byTeam.get(team)?.played.length ?? 0;
	const rate = played ? ratings.length / played : null;
	const rating = ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : null;
	const defended = statById("defended");
	const defendedList = defended ? teamValues(defended, team) : [];
	const timesDefended = defendedList.length ? defendedList.filter(Boolean).length / defendedList.length : null;

	let level = "none";
	if (rate === null) level = "unknown";
	else if (rate >= 0.5) level = "often";
	else if (rate >= 0.2) level = "sometimes";
	else if (rate > 0) level = "rarely";

	const quality = rating === null ? "" : rating <= 2 ? "strong" : rating <= 3.5 ? "decent" : "weak";
	return { level, rate, rating, quality, matches: ratings.length, played, timesDefended };
}

const DEFENSE_TEXT = {
	often: "Plays defence often",
	sometimes: "Plays defence sometimes",
	rarely: "Rarely plays defence",
	none: "Hasn't played defence",
	unknown: "No defence data"
};

function defenseChip(team) {
	const profile = defenseProfile(team);
	const detail = profile.level === "none" || profile.level === "unknown"
		? ""
		: `${plural(profile.matches, "match")} of ${profile.played}${profile.quality ? `, ${profile.quality} (${fixed(profile.rating)} / 5)` : ""}`;
	return `<div class="match-chip defense ${profile.level}"><b>${DEFENSE_TEXT[profile.level]}</b>${detail ? `<small>${detail}</small>` : ""}</div>`;
}

function teamCard(team, side) {
	const ranking = matchData.rankings.find(row => Number(String(row.team_key).replace(/^frc/, "")) === team);
	const record = ranking?.record ? `${ranking.record.wins}-${ranking.record.losses}${ranking.record.ties ? `-${ranking.record.ties}` : ""}` : null;
	const scouted = scoutedProfile(team);
	const name = data.names?.get(team);
	const defended = defenseProfile(team).timesDefended;

	return `
      <div class="match-team ${side}">
        <div class="match-team-head">
          <a href="${teamUrl(team)}">${team}</a>
          <span>${escapeHtml(name ?? "")}</span>
          ${ranking ? `<em>Rank ${ranking.rank}${record ? ` · ${record}` : ""}</em>` : ""}
        </div>
        <dl class="match-numbers">
          <div><dt>EPA</dt><dd>${fixed(data.epa.get(team))}</dd></div>
          <div><dt>OPR</dt><dd>${fixed(data.opr.get(team))}</dd></div>
          <div><dt>Scouted</dt><dd>${fixed(scouted.mean)}</dd></div>
        </dl>
        ${defenseChip(team)}
        <p class="match-notes">${[
			scouted.reports ? plural(scouted.reports, "scouting report") : "Not scouted yet",
			scouted.breakdowns ? `${plural(scouted.breakdowns, "breakdown")}` : null,
			defended !== null && defended >= 0.3 ? `Defended in ${percent(defended)} of matches` : null
		].filter(Boolean).join(" · ")}</p>
      </div>`;
}

/* Is this alliance a defence threat? Counts the teams that play it often or sometimes. */
function allianceDefense(teams) {
	const profiles = teams.map(defenseProfile);
	const known = profiles.filter(profile => profile.level !== "unknown");
	const active = profiles.filter(profile => profile.level === "often" || profile.level === "sometimes");
	if (!known.length) return "No defence data for these teams.";
	return active.length
		? `${plural(active.length, "robot")} here can play defence.`
		: "None of these robots play much defence.";
}

function allianceCard(title, side, teams) {
	return `
      <div class="match-alliance ${side}">
        <h4>${title}</h4>
        ${teams.map(team => teamCard(team, side)).join("")}
        <p class="match-alliance-note">🛡 ${allianceDefense(teams)}</p>
      </div>`;
}

/* One plain sentence per source, with a bar. */
function predictionRow(prediction, result) {
	const { source } = prediction;
	if (prediction.unavailable) {
		return `<div class="match-source"><div class="match-source-name">${source.label}<small>${source.note}</small></div><p class="match-none">Not enough data for this source.</p></div>`;
	}

	const { red, blue, redWin, blueWin, missing } = prediction;
	const favourite = redWin >= blueWin ? "Red" : "Blue";
	const chance = Math.max(redWin, blueWin);
	const called = result ? ((red > blue) === (result.red > result.blue) ? "right" : "wrong") : "";

	return `
      <div class="match-source">
        <div class="match-source-name">${source.label}<small>${source.note}</small></div>
        <div class="match-source-body">
          <p><strong class="${favourite.toLowerCase()}">${favourite}</strong> is favoured, <strong>${percent(chance)}</strong>${called ? `<span class="call ${called}">${called === "right" ? "✓ called it" : "✗ missed"}</span>` : ""}</p>
          <div class="chance-bar" role="img" aria-label="Red ${percent(redWin)}, blue ${percent(blueWin)}"><i class="red" style="width:${(redWin * 100).toFixed(1)}%">${redWin >= 0.18 ? percent(redWin) : ""}</i><i class="blue" style="width:${(blueWin * 100).toFixed(1)}%">${blueWin >= 0.18 ? percent(blueWin) : ""}</i></div>
          <small>Predicted score: <span class="red">Red ${fixed(red, 0)}</span> – <span class="blue">Blue ${fixed(blue, 0)}</span>${missing ? ` · ${plural(missing, "team")} estimated` : ""}</small>
        </div>
      </div>`;
}

/* The three sources averaged: one headline answer. */
function verdict(predictions) {
	const usable = predictions.filter(prediction => !prediction.unavailable);
	if (!usable.length) return "";

	const average = key => usable.reduce((sum, prediction) => sum + prediction[key], 0) / usable.length;
	const redWin = average("redWin");
	const red = average("red");
	const blue = average("blue");
	const favourite = redWin >= 0.5 ? "red" : "blue";
	const chance = Math.max(redWin, 1 - redWin);
	const closeCall = chance < 0.6;

	return `
      <div class="match-verdict ${favourite}">
        <div class="match-verdict-main">
          <span>${closeCall ? "Too close to call" : "Favoured to win"}</span>
          <strong>${closeCall ? `${favourite === "red" ? "Red" : "Blue"} ${percent(chance)}` : `${favourite === "red" ? "Red" : "Blue"} alliance · ${percent(chance)}`}</strong>
          <small>Average of ${usable.length} prediction${usable.length === 1 ? "" : "s"} · expected score <b class="red">${fixed(red, 0)}</b> – <b class="blue">${fixed(blue, 0)}</b></small>
        </div>
        <div class="chance-bar big" role="img" aria-label="Red ${percent(redWin)}, blue ${percent(1 - redWin)}"><i class="red" style="width:${(redWin * 100).toFixed(1)}%">Red ${percent(redWin)}</i><i class="blue" style="width:${((1 - redWin) * 100).toFixed(1)}%">Blue ${percent(1 - redWin)}</i></div>
      </div>`;
}

function renderMatch(match) {
	const red = teamNumbers(match.red);
	const blue = teamNumbers(match.blue);
	const played = isPlayed(match);
	const result = played ? { red: match.red.score, blue: match.blue.score } : null;
	const predictions = predictMatch(match);

	const outcome = !played ? "Not played yet"
		: result.red === result.blue ? `Tie ${result.red}–${result.blue}`
			: `${result.red > result.blue ? "Red" : "Blue"} won ${Math.max(result.red, result.blue)}–${Math.min(result.red, result.blue)}`;

	matchResult.innerHTML = `
      <article class="match-card">
        <div class="match-heading">
          <div><h3>${escapeHtml(matchLabel(match))}</h3><p>${escapeHtml(eventSelect.selectedOptions[0].text)}</p></div>
          <div class="match-outcome ${played ? (result.red > result.blue ? "red" : result.red < result.blue ? "blue" : "") : ""}">${outcome}</div>
        </div>
        ${verdict(predictions)}
        <div class="match-alliances">${allianceCard("Red alliance", "red", red)}${allianceCard("Blue alliance", "blue", blue)}</div>
        <h4 class="match-subtitle">Each prediction on its own</h4>
        <div class="match-sources">${predictions.map(prediction => predictionRow(prediction, result)).join("")}</div>
        <details class="match-help">
          <summary>How to read this</summary>
          <ul>
            <li><b>EPA</b> (Statbotics) and <b>OPR</b> (The Blue Alliance) are each team's usual points per match. <b>Scouted</b> is the same from our own match reports.</li>
            <li>An alliance's predicted score is its three teams added together. The win chance is how likely that gap is to hold up, based on how far off that source was on matches already played here.</li>
            <li><b>Defence</b> comes from our scouting: how many of a team's matches had a defence rating, and the average (1 = incredible, 5 = poor). It isn't part of the score prediction. A strong defender can pull a good opponent below their usual score.</li>
            ${played ? "<li>A ✓ means that source picked the actual winner.</li>" : ""}
          </ul>
        </details>
      </article>`;
}

async function searchMatch() {
	const text = matchInput.value;
	if (!data) return;

	if (!text.trim()) {
		matchResult.innerHTML = "";
		return;
	}

	matchResult.innerHTML = `<div class="loading">Loading match…</div>`;
	if (!matchData || matchData.event !== data.event) {
		if (!(await loadMatchData())) return;
	}

	const url = new URL(window.location);
	url.searchParams.set("match", text.trim());
	window.history.replaceState({}, "", url);

	const match = findMatch(text);
	if (!match) {
		matchResult.innerHTML = matchData.matches.length
			? `<div class="empty-state">No match "${escapeHtml(text.trim())}" at this event. Try a qualification number like 12, or a playoff match like sf2m1.</div>`
			: `<div class="empty-state">The Blue Alliance has no match schedule for this event yet.</div>`;
		return;
	}

	renderMatch(match);
}

matchSearch.addEventListener("click", searchMatch);
matchInput.addEventListener("keydown", event => {
	if (event.key === "Enter") searchMatch();
});

/* A different event was picked (or loaded): old results no longer apply. */
document.addEventListener("overview-loaded", () => {
	matchData = null;
	matchResult.innerHTML = "";
	if (matchInput.value.trim()) searchMatch();
});

const matchFromUrl = new URL(window.location).searchParams.get("match");
if (matchFromUrl) matchInput.value = matchFromUrl;
