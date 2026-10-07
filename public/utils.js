function saveTeamsInUrl(...teams) {
	const url = new URL(window.location);

	if (teams.length == 1) {
		url.searchParams.set("team", teams[0]);
	} else {
		for (let i = 0; i < teams.length; i++) {
			url.searchParams.set(`team${i + 1}`, teams[i]);
		}
	}

	window.history.replaceState({}, "", url);
}

function getTeamsFromUrl() {
	const url = new URL(window.location);

	if (url.searchParams.has("team")) {
		return [Number(url.searchParams.get("team"))];
	}

	let teams = [];

	for (let i = 0; i > -1; i++) {
		if (url.searchParams.has(`team${i + 1}`)) {
			teams.push(Number(url.searchParams.get(`team${i + 1}`)));
		} else {
			break;
		}
	}

	return teams;
}

/* =================================
   PERFORMANCE TREND CHART
================================= */

function escapeChartText(value) {
	return String(value ?? "").replace(/[&<>"']/g, character => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#39;"
	})[character]);
}

function performanceTrendChart(points, label = "Scouting average by match", xLabel = "Qualification match") {
	const usable = points.filter(point => Number.isFinite(point.match));

	if (!usable.length) {
		return `<section class="performance-chart empty-chart"><h3>${escapeChartText(label)}</h3><p>Match-by-match data will appear after scouting reports or completed matches are available.</p></section>`;
	}

	const series = [{ key: "scouting", label: "Scouting average", color: "#59a8d7" }];
	const values = usable.map(point => Number(point.scouting)).filter(Number.isFinite);

	if (!values.length) {
		return `<section class="performance-chart empty-chart"><h3>${escapeChartText(label)}</h3><p>No scouting scores are available yet.</p></section>`;
	}

	const matches = usable.map(point => point.match);
	const minMatch = Math.min(...matches);
	const maxMatch = Math.max(...matches);
	const minValue = Math.min(0, ...values);
	const maxValue = Math.max(...values);
	const range = Math.max(1, maxValue - minValue);
	const width = 760;
	const height = 330;
	const left = 52;
	const right = 22;
	const top = 28;
	const bottom = 45;
	const x = match => left + ((match - minMatch) / Math.max(1, maxMatch - minMatch)) * (width - left - right);
	const y = value => height - bottom - ((value - minValue) / range) * (height - top - bottom);
	const paths = series.map(line => {
		const coordinates = usable
			.filter(point => Number.isFinite(Number(point[line.key])))
			.map(point => `${x(point.match).toFixed(1)},${y(Number(point[line.key])).toFixed(1)}`);
		return coordinates.length > 1
			? `<polyline points="${coordinates.join(" ")}" fill="none" stroke="${line.color}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`
			: coordinates.length === 1
				? `<circle cx="${coordinates[0].split(",")[0]}" cy="${coordinates[0].split(",")[1]}" r="5" fill="${line.color}"/>`
				: "";
	}).join("");
	const grid = [0, 0.25, 0.5, 0.75, 1].map(position => {
		const value = minValue + range * position;
		const vertical = y(value);
		return `<line x1="${left}" x2="${width - right}" y1="${vertical}" y2="${vertical}" stroke="#d9d9d9"/><text x="${left - 8}" y="${vertical + 4}" text-anchor="end">${value.toFixed(0)}</text>`;
	}).join("");
	const labels = [...new Set([minMatch, Math.round((minMatch + maxMatch) / 2), maxMatch])]
		.map(match => `<text x="${x(match)}" y="${height - 17}" text-anchor="middle">${match}</text>`)
		.join("");

	return `<section class="performance-chart"><div class="chart-heading"><h3>${escapeChartText(label)}</h3><div class="chart-legend">${series.map(line => `<span><i style="background:${line.color}"></i>${line.label}</span>`).join("")}</div></div><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeChartText(label)}"><g class="chart-grid">${grid}</g><line x1="${left}" x2="${width - right}" y1="${height - bottom}" y2="${height - bottom}" class="chart-axis" stroke-width="1.5"/>${paths}<g class="chart-labels">${labels}<text x="${width / 2}" y="${height - 2}" text-anchor="middle">${escapeChartText(xLabel)}</text></g></svg><p class="chart-note">Each point is that match’s average report score: auto + teleop + endgame points. Multiple reports for one match are averaged together.</p></section>`;
}

function performanceTrendPoints(scoutingRows) {
	const numberOrNull = value => {
		const number = Number(value);
		return Number.isFinite(number) ? number : null;
	};
	const rowMatch = row => {
		const value = row["Match Number"] ?? row.match_number ?? row.match_num ?? row.number;
		const direct = numberOrNull(value);

		if (direct !== null) return direct;

		const match = String(value ?? "").match(/\d+/);
		return match ? numberOrNull(match[0]) : null;
	};
	const firstScore = (row, headers) => {
		const entry = Object.entries(row).find(([header]) =>
			headers.some(candidate => candidate.toLowerCase() === String(header).trim().toLowerCase())
		);
		return entry ? numberOrNull(entry[1]) : null;
	};
	const rowTotal = row => {
		if (String(row["No Show"] ?? "").trim().toUpperCase() === "TRUE") return null;
		const auto = firstScore(row, ["Auto Scoring Points"]);
		const teleop = firstScore(row, ["Teleop Scoring Points"]);
		const endgame = firstScore(row, [
			"Endgame Scoring Points",
			"End Game Scoring Points",
			"Endgame Points",
			"End Game Points",
			"Endgame Climb Points",
			"End Game Climb Points"
		]);
		const scores = [auto, teleop, endgame].filter(Number.isFinite);
		return scores.length ? scores.reduce((sum, score) => sum + score, 0) : null;
	};
	const scoutByMatch = new Map();
	for (const row of scoutingRows || []) {
		const match = rowMatch(row);
		const total = rowTotal(row);
		if (!Number.isFinite(match) || !Number.isFinite(total)) continue;
		const totals = scoutByMatch.get(match) || [];
		totals.push(total);
		scoutByMatch.set(match, totals);
	}
	const matches = [...scoutByMatch.keys()].sort((a, b) => a - b);
	return matches.map(match => {
		const scores = scoutByMatch.get(match);
		return {
			match,
			scouting: scores.reduce((sum, score) => sum + score, 0) / scores.length
		};
	});
}


/* =================================
   SEASON-WIDE DATA
   Used by the compare pages when "Entire Season" is selected.
================================= */

/* The season year, taken from the first real event key in a dropdown. */
function seasonYearFrom(select) {
	return [...select.options]
		.map(option => option.value)
		.find(value => /^\d{4}/.test(value))
		.slice(0, 4);
}

function seasonAverage(values) {
	const usable = values
		.filter(value => value !== null && value !== undefined && value !== "")
		.map(Number)
		.filter(Number.isFinite);

	return usable.length
		? usable.reduce((total, value) => total + value, 0) / usable.length
		: null;
}

/* Loads each team's season summary plus every scouting and pit-scouting row
   from all of their events. Rows are tagged with their event key and ordered
   oldest event first; pit rows are newest first so the latest answer wins. */
async function loadSeasonData(teamNumbers, year) {
	const seasons = await Promise.all(teamNumbers.map(async team => {
		const response = await fetch(`/api/teams/${team}/season/${year}`);
		const data = await response.json().catch(() => ({}));
		if (!response.ok) throw new Error(data.error || `Could not load team ${team}'s season.`);
		return data;
	}));

	const events = new Map();
	for (const season of seasons) {
		for (const event of season.events ?? []) events.set(event.key, event);
	}
	const eventKeys = [...events.values()]
		.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)))
		.map(event => event.key);

	const loadSheet = path => Promise.all(eventKeys.map(key =>
		fetch(`/api/${path}/${key}`)
			.then(response => response.ok ? response.json() : [])
			.catch(() => [])
			.then(rows => (Array.isArray(rows) ? rows : []).map(row => ({ ...row, __event: key })))
	));

	const [scouting, pit] = await Promise.all([loadSheet("scouting"), loadSheet("pitscouting")]);

	return {
		seasons: Object.fromEntries(teamNumbers.map((team, index) => [team, seasons[index]])),
		scouting: scouting.flat(),
		pit: pit.reverse().flat()
	};
}

/* Season OPR/DPR/CCWM are the average of the team's per-event values. */
function seasonTeamStats(season) {
	const events = season?.events ?? [];

	return {
		opr: seasonAverage(events.map(event => event.opr)),
		dpr: seasonAverage(events.map(event => event.dpr)),
		ccwm: seasonAverage(events.map(event => event.ccwm)),
		matches: season?.record?.count ?? 0
	};
}

/* Match numbers repeat between events, so number scouted matches 1..n in
   event order instead. */
function seasonTrendPoints(scoutingRows) {
	const byEvent = new Map();
	for (const row of scoutingRows) {
		if (!byEvent.has(row.__event)) byEvent.set(row.__event, []);
		byEvent.get(row.__event).push(row);
	}

	return [...byEvent.values()]
		.flatMap(rows => performanceTrendPoints(rows))
		.map((point, index) => ({ ...point, match: index + 1 }));
}
