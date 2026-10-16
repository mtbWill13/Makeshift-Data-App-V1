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

/* Series colours, checked for contrast and colour-blind separation on the dark
   chart surface: blue = each match, amber = running average. */
const TREND_COLORS = { match: "#4a95c4", average: "#ba8820" };
/* "compact" draws on a narrower canvas so text stays readable in half-width
   cards (compare page); the SVG scales to fit either way. */
const TREND_SIZES = {
	full: { width: 760, height: 300, left: 48, right: 84, top: 18, bottom: 46, maxTicks: 13 },
	compact: { width: 440, height: 270, left: 42, right: 84, top: 16, bottom: 46, maxTicks: 7 }
};

function trendSize(chart) {
	return TREND_SIZES[chart?.dataset?.size] ?? TREND_SIZES.full;
}

/* Round axis maximum and evenly spaced ticks (0, 50, 100…). */
function trendTicks(maxValue) {
	const target = Math.max(1, maxValue) / 4;
	const power = 10 ** Math.floor(Math.log10(target));
	const step = [1, 2, 2.5, 5, 10].map(multiple => multiple * power).find(candidate => candidate >= target);
	const top = Math.ceil(Math.max(1, maxValue) / step) * step;
	const ticks = [];
	for (let value = 0; value <= top + step / 2; value += step) ticks.push(value);
	return { top, ticks };
}

function formatTrendValue(value) {
	return Number.isFinite(value) ? value.toFixed(1) : "—";
}

/* Scouting chart: each match's score (dots) plus the running average (line).
   options.yMax lets two charts share a scale (compare page). */
function performanceTrendChart(points, label = "Scouting by match", xLabel = "Match", options = {}) {
	const usable = points.filter(point => Number.isFinite(point.match) && Number.isFinite(Number(point.scouting)));

	if (!usable.length) {
		return `<section class="performance-chart empty-chart"><h3>${escapeChartText(label)}</h3><p>Match-by-match data will appear after scouting reports are available.</p></section>`;
	}

	let total = 0;
	const data = usable.map((point, index) => {
		const score = Number(point.scouting);
		total += score;
		/* x-axis counts the team's matches 1, 2, 3…; the real match number is
		   kept for the tooltip and table. */
		return { number: index + 1, match: point.match, score, average: total / (index + 1) };
	});
	const showQualNumbers = data.some(point => point.match !== point.number);

	/* Phones always get the compact layout so the text stays readable. */
	const sizeName = options.compact || window.innerWidth < 700 ? "compact" : "full";
	const { width, height, left, right, top, bottom, maxTicks } = TREND_SIZES[sizeName];
	const plotWidth = width - left - right;
	const plotBottom = height - bottom;
	const { top: yTop, ticks } = trendTicks(Math.max(options.yMax ?? 0, ...data.map(point => point.score)));
	const x = index => data.length === 1 ? left + plotWidth / 2 : left + (index / (data.length - 1)) * plotWidth;
	const y = value => plotBottom - (value / yTop) * (plotBottom - top);
	const path = key => data.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`).join("");

	const grid = ticks.map(value => `
		<line x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}"/>
		<text x="${left - 10}" y="${y(value) + 4}" text-anchor="end">${value.toLocaleString()}</text>`).join("");

	/* A limited number of match labels so they never collide. */
	const every = Math.max(1, Math.ceil(data.length / maxTicks));
	const xTicks = data
		.map((point, index) => ({ point, index }))
		.filter(({ index }) => index % every === 0 || index === data.length - 1)
		/* Drop a label that would crowd the last match's label. */
		.filter(({ index }) => index === 0 || index === data.length - 1 || data.length - 1 - index >= every * 0.6)
		.map(({ point, index }) => `<text x="${x(index)}" y="${plotBottom + 20}" text-anchor="middle">${point.number}</text>`)
		.join("");

	const last = data.at(-1);
	const dots = data.map((point, index) =>
		`<circle class="trend-dot" cx="${x(index).toFixed(1)}" cy="${y(point.score).toFixed(1)}" r="4.5" fill="${TREND_COLORS.match}"/>`
	).join("");

	const tableRows = data.map(point =>
		`<tr><td>${point.number}</td>${showQualNumbers ? `<td>${escapeChartText(point.match)}</td>` : ""}<td>${formatTrendValue(point.score)}</td><td>${formatTrendValue(point.average)}</td></tr>`
	).join("");

	return `
	<section class="performance-chart trend-chart" data-trend="${escapeChartText(JSON.stringify(data))}" data-ytop="${yTop}" data-size="${sizeName}">
		<div class="chart-heading">
			<h3>${escapeChartText(label)}</h3>
			<div class="chart-legend">
				<span><i class="key-dot" style="background:${TREND_COLORS.match}"></i>Match score</span>
				<span><i class="key-line" style="background:${TREND_COLORS.average}"></i>Running average</span>
			</div>
		</div>
		<div class="trend-plot">
			<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeChartText(`${label}: ${data.length} matches, latest running average ${formatTrendValue(last.average)}`)}">
				<g class="chart-grid">${grid}</g>
				<line class="chart-axis" x1="${left}" x2="${width - right}" y1="${plotBottom}" y2="${plotBottom}"/>
				<path class="trend-match-line" d="${path("score")}" stroke="${TREND_COLORS.match}"/>
				<path class="trend-average-line" d="${path("average")}" stroke="${TREND_COLORS.average}"/>
				${dots}
				<circle class="trend-average-end" cx="${x(data.length - 1)}" cy="${y(last.average)}" r="4.5" fill="${TREND_COLORS.average}"/>
				<text class="trend-end-label" x="${x(data.length - 1) + 10}" y="${y(last.average) + 4}">avg ${formatTrendValue(last.average)}</text>
				<g class="chart-labels">${xTicks}<text x="${left + plotWidth / 2}" y="${height - 4}" text-anchor="middle">${escapeChartText(xLabel)}</text></g>
				<line class="trend-crosshair" x1="0" x2="0" y1="${top}" y2="${plotBottom}" visibility="hidden"/>
				<circle class="trend-focus trend-focus-match" r="6" fill="${TREND_COLORS.match}" visibility="hidden"/>
				<circle class="trend-focus trend-focus-average" r="6" fill="${TREND_COLORS.average}" visibility="hidden"/>
				<rect class="trend-hit" x="${left - 12}" y="${top}" width="${plotWidth + 24}" height="${plotBottom - top}" tabindex="0" aria-label="Explore values with the arrow keys"/>
			</svg>
			<div class="trend-tooltip" hidden></div>
		</div>
		<p class="chart-note">Dots are each match's scouted points (auto + teleop + endgame; several reports for one match are averaged). The line is the running average up to that match.</p>
		<details class="trend-table">
			<summary>Show data table</summary>
			<table><thead><tr><th>Match</th>${showQualNumbers ? "<th>Qual match</th>" : ""}<th>Match score</th><th>Running avg</th></tr></thead><tbody>${tableRows}</tbody></table>
		</details>
	</section>`;
}

/* Hover/keyboard crosshair: snaps to the nearest match and shows both values. */
(() => {
	function showPoint(chart, index) {
		const data = JSON.parse(chart.dataset.trend);
		const { width, height, left, right, top, bottom } = trendSize(chart);
		const point = data[Math.max(0, Math.min(data.length - 1, index))];
		if (!point) return;
		chart.dataset.index = data.indexOf(point);

		const plotWidth = width - left - right;
		const plotBottom = height - bottom;
		const yTop = Number(chart.dataset.ytop);
		const svg = chart.querySelector("svg");
		const px = data.length === 1 ? left + plotWidth / 2 : left + (data.indexOf(point) / (data.length - 1)) * plotWidth;
		const py = value => plotBottom - (value / yTop) * (plotBottom - top);

		const crosshair = svg.querySelector(".trend-crosshair");
		crosshair.setAttribute("x1", px);
		crosshair.setAttribute("x2", px);
		crosshair.setAttribute("visibility", "visible");
		for (const [selector, value] of [[".trend-focus-match", point.score], [".trend-focus-average", point.average]]) {
			const dot = svg.querySelector(selector);
			dot.setAttribute("cx", px);
			dot.setAttribute("cy", py(value));
			dot.setAttribute("visibility", "visible");
		}

		const tooltip = chart.querySelector(".trend-tooltip");
		tooltip.replaceChildren();
		const title = document.createElement("div");
		title.className = "trend-tooltip-title";
		title.textContent = point.match !== point.number
			? `Match ${point.number} · Qual ${point.match}`
			: `Match ${point.number}`;
		tooltip.append(title);
		for (const [name, value, color] of [["Match score", point.score, TREND_COLORS.match], ["Running avg", point.average, TREND_COLORS.average]]) {
			const row = document.createElement("div");
			row.className = "trend-tooltip-row";
			const key = document.createElement("i");
			key.style.background = color;
			const strong = document.createElement("strong");
			strong.textContent = formatTrendValue(value);
			const span = document.createElement("span");
			span.textContent = name;
			row.append(key, strong, span);
			tooltip.append(row);
		}
		tooltip.hidden = false;

		/* Place beside the crosshair, flipping to the left near the right edge. */
		const box = svg.getBoundingClientRect();
		const plot = chart.querySelector(".trend-plot").getBoundingClientRect();
		const scale = box.width / width;
		const screenX = box.left - plot.left + px * scale;
		const tipWidth = tooltip.offsetWidth;
		tooltip.style.left = `${screenX + 14 + tipWidth > plot.width ? screenX - 14 - tipWidth : screenX + 14}px`;
		tooltip.style.top = `${Math.max(0, box.top - plot.top + py(Math.max(point.score, point.average)) * scale - tooltip.offsetHeight - 8)}px`;
	}

	function hide(chart) {
		chart.querySelector(".trend-tooltip").hidden = true;
		chart.querySelectorAll(".trend-crosshair, .trend-focus").forEach(element => element.setAttribute("visibility", "hidden"));
	}

	function indexAt(chart, clientX) {
		const data = JSON.parse(chart.dataset.trend);
		const { width, left, right } = trendSize(chart);
		const box = chart.querySelector("svg").getBoundingClientRect();
		const viewX = (clientX - box.left) * (width / box.width);
		return data.length === 1 ? 0 : Math.round(((viewX - left) / (width - left - right)) * (data.length - 1));
	}

	document.addEventListener("pointermove", event => {
		const hit = event.target.closest?.(".trend-hit");
		if (!hit) return;
		const chart = hit.closest(".trend-chart");
		showPoint(chart, indexAt(chart, event.clientX));
	});
	document.addEventListener("pointerout", event => {
		const hit = event.target.closest?.(".trend-hit");
		if (hit && document.activeElement !== hit) hide(hit.closest(".trend-chart"));
	});
	document.addEventListener("focusin", event => {
		if (!event.target.classList?.contains("trend-hit")) return;
		const chart = event.target.closest(".trend-chart");
		showPoint(chart, JSON.parse(chart.dataset.trend).length - 1);
	});
	document.addEventListener("focusout", event => {
		if (event.target.classList?.contains("trend-hit")) hide(event.target.closest(".trend-chart"));
	});
	document.addEventListener("keydown", event => {
		if (!event.target.classList?.contains("trend-hit")) return;
		const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
		if (!step) return;
		event.preventDefault();
		const chart = event.target.closest(".trend-chart");
		const start = chart.dataset.index ?? JSON.parse(chart.dataset.trend).length - 1;
		showPoint(chart, Number(start) + (chart.dataset.index === undefined ? 0 : step));
	});
})();

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

document.addEventListener("wheel", event => {
	if (document.activeElement.type == "number") {
		document.activeElement.blur();
	}
});
