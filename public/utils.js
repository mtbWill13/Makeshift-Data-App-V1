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

	const valueName = options.valueName ?? "Match score";
	const note = options.note ?? "Dots are each match's scouted points (auto + teleop + endgame; several reports for one match are averaged). The line is the running average up to that match.";
	const last = data.at(-1);
	const dots = data.map((point, index) =>
		`<circle class="trend-dot" cx="${x(index).toFixed(1)}" cy="${y(point.score).toFixed(1)}" r="4.5" fill="${TREND_COLORS.match}"/>`
	).join("");

	const tableRows = data.map(point =>
		`<tr><td>${point.number}</td>${showQualNumbers ? `<td>${escapeChartText(point.match)}</td>` : ""}<td>${formatTrendValue(point.score)}</td><td>${formatTrendValue(point.average)}</td></tr>`
	).join("");

	return `
	<section class="performance-chart trend-chart" data-trend="${escapeChartText(JSON.stringify(data))}" data-ytop="${yTop}" data-size="${sizeName}" data-value-name="${escapeChartText(valueName)}"${options.clickable ? " data-clickable" : ""}>
		<div class="chart-heading">
			<h3>${escapeChartText(label)}</h3>
			<div class="chart-legend">
				<span><i class="key-dot" style="background:${TREND_COLORS.match}"></i>${escapeChartText(valueName)}</span>
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
				<rect class="trend-hit" x="${left - 12}" y="${top}" width="${plotWidth + 24}" height="${plotBottom - top}" tabindex="0" aria-label="${options.clickable ? "Explore values with the arrow keys, Enter opens that match's report" : "Explore values with the arrow keys"}"/>
			</svg>
			<div class="trend-tooltip" hidden></div>
		</div>
		<p class="chart-note">${escapeChartText(note)}${options.clickable ? " Click a match to jump to its scouting report." : ""}</p>
		<details class="trend-table">
			<summary>Show data table</summary>
			<table><thead><tr><th>Match</th>${showQualNumbers ? "<th>Qual match</th>" : ""}<th>${escapeChartText(valueName)}</th><th>Running avg</th></tr></thead><tbody>${tableRows}</tbody></table>
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
		for (const [name, value, color] of [[chart.dataset.valueName || "Match score", point.score, TREND_COLORS.match], ["Running avg", point.average, TREND_COLORS.average]]) {
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
		if (chart.dataset.clickable !== undefined) {
			const hint = document.createElement("div");
			hint.className = "trend-tooltip-hint";
			hint.textContent = "Click to open the report";
			tooltip.append(hint);
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
	/* Picking a match (click, tap or Enter) tells the page, which opens that match's report. */
	function select(chart, index) {
		if (chart.dataset.clickable === undefined) return;
		const data = JSON.parse(chart.dataset.trend);
		const point = data[Math.max(0, Math.min(data.length - 1, index))];
		if (point) chart.dispatchEvent(new CustomEvent("trend-select", { bubbles: true, detail: { match: point.match, number: point.number } }));
	}

	document.addEventListener("click", event => {
		const hit = event.target.closest?.(".trend-hit");
		if (!hit) return;
		const chart = hit.closest(".trend-chart");
		select(chart, indexAt(chart, event.clientX));
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
		const chart = event.target.closest(".trend-chart");
		if (event.key === "Enter") {
			select(chart, Number(chart.dataset.index ?? JSON.parse(chart.dataset.trend).length - 1));
			return;
		}
		const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
		if (!step) return;
		event.preventDefault();
		const start = chart.dataset.index ?? JSON.parse(chart.dataset.trend).length - 1;
		showPoint(chart, Number(start) + (chart.dataset.index === undefined ? 0 : step));
	});
})();

function trendNumber(value) {
	const text = String(value ?? "").trim();
	if (text === "") return null;
	const number = Number(text);
	return Number.isFinite(number) ? number : null;
}

/* The first of these columns the row has, as a number. */
function trendColumn(row, headers) {
	const entry = Object.entries(row).find(([header]) =>
		headers.some(candidate => candidate.toLowerCase() === String(header).trim().toLowerCase())
	);
	return entry ? trendNumber(entry[1]) : null;
}

function trendRowTotal(row) {
	const auto = trendColumn(row, ["Auto Scoring Points"]);
	const teleop = trendColumn(row, ["Teleop Scoring Points"]);
	const endgame = trendColumn(row, [
		"Endgame Scoring Points",
		"End Game Scoring Points",
		"Endgame Points",
		"End Game Points",
		"Endgame Climb Points",
		"End Game Climb Points"
	]);
	const scores = [auto, teleop, endgame].filter(Number.isFinite);
	return scores.length ? scores.reduce((sum, score) => sum + score, 0) : null;
}

/* What the by-match chart can show. `value` reads one report; reports for the
   same match are averaged. */
const TREND_STATS = [
	{
		id: "total", label: "Total points", valueName: "Match score", value: trendRowTotal,
		note: "Dots are each match's scouted points (auto + teleop + endgame; several reports for one match are averaged). The line is the running average up to that match."
	},
	{
		id: "auto", label: "Auto points", valueName: "Auto points", value: row => trendColumn(row, ["Auto Scoring Points"]),
		note: "Dots are the auto points scouted in each match. The line is the running average up to that match."
	},
	{
		id: "teleop", label: "Teleop points", valueName: "Teleop points", value: row => trendColumn(row, ["Teleop Scoring Points"]),
		note: "Dots are the teleop points scouted in each match. The line is the running average up to that match."
	},
	{
		id: "climb", label: "Climb points", valueName: "Climb points", value: row => trendColumn(row, ["Climb points", "End Game Climb", "Endgame Climb Points", "End Game Climb Points"]),
		note: "Dots are the climb points scouted in each match (0 = no climb). The line is the running average up to that match."
	},
	{
		id: "defense", label: "Defence rating", valueName: "Defence rating", rating: 5, value: row => {
			const header = Object.keys(row).find(key => /^defen[cs]e rating/i.test(key.trim()));
			const rating = header ? trendNumber(row[header]) : null;
			return rating >= 1 && rating <= 5 ? rating : null;
		},
		note: "Dots are the defence rating in matches where the team played defence (1 = incredible, 5 = poor, so lower is better). Matches without defence are left out."
	},
	{
		id: "driver", label: "Driver skill", valueName: "Driver skill", rating: 6, value: row => {
			const header = Object.keys(row).find(key => /^driver skill/i.test(key.trim()));
			const rating = header ? trendNumber(row[header]) : null;
			return rating >= 1 && rating <= 6 ? rating : null;
		},
		note: "Dots are the driver skill ranking in each match (1 = best, 6 = worst, so lower is better)."
	}
];

/* One colour per stat, so a stat keeps its colour whatever else is picked.
   Chosen to stay apart on the dark chart surface. */
const TREND_STAT_COLORS = {
	total: "#4a95c4", auto: "#e8b63f", teleop: "#5ec27a", climb: "#c08de8", defense: "#eb6a5c", driver: "#ef8fb7"
};

/* Several stats on one chart, one coloured line each (no running average).
   series: [{ id, label, points, rating? }] where points come from performanceTrendPoints.
   `rating` is the top of a rating scale (e.g. 5): when ratings are shown together
   with points, they get their own axis on the right and a dashed line. */
function performanceMultiTrendChart(series, label = "Scouting by match", xLabel = "Match", options = {}) {
	const usable = series
		.map(item => ({ ...item, points: item.points.filter(point => Number.isFinite(point.match) && Number.isFinite(Number(point.scouting))) }))
		.filter(item => item.points.length);

	if (!usable.length) {
		return `<section class="performance-chart empty-chart"><h3>${escapeChartText(label)}</h3><p>Match-by-match data will appear after scouting reports are available.</p></section>`;
	}

	const matches = [...new Set(usable.flatMap(item => item.points.map(point => point.match)))].sort((a, b) => a - b);
	const lines = usable.map(item => {
		const byMatch = new Map(item.points.map(point => [point.match, Number(point.scouting)]));
		return {
			id: item.id,
			label: item.label,
			color: TREND_STAT_COLORS[item.id] ?? "#9be3d6",
			rating: item.rating ?? 0,
			values: matches.map(match => byMatch.get(match) ?? null)
		};
	});
	/* Ratings only move to the right axis when there are points to share the chart with. */
	const useRightAxis = lines.some(line => line.rating) && lines.some(line => !line.rating);
	for (const line of lines) line.right = useRightAxis && Boolean(line.rating);
	const leftLines = lines.filter(line => !line.right);
	const rightLines = lines.filter(line => line.right);
	const rightTop = Math.max(0, ...rightLines.map(line => line.rating));

	const sizeName = options.compact || window.innerWidth < 700 ? "compact" : "full";
	const { width, height, left, right, top, bottom, maxTicks } = TREND_SIZES[sizeName];
	const plotRight = width - (useRightAxis ? 46 : 20);   // no end label here; leave room for the right axis
	const plotWidth = plotRight - left;
	const plotBottom = height - bottom;
	const { top: yTop, ticks } = trendTicks(Math.max(...leftLines.flatMap(line => line.values.filter(Number.isFinite))));
	const x = index => matches.length === 1 ? left + plotWidth / 2 : left + (index / (matches.length - 1)) * plotWidth;
	const y = value => plotBottom - (value / yTop) * (plotBottom - top);
	/* Flipped: 1 (the best rating) is at the top, the worst at the bottom, so higher is better like the points. */
	const yRight = value => top + ((value - 1) / Math.max(1, rightTop - 1)) * (plotBottom - top);
	const rightAxis = useRightAxis ? `
		<line class="chart-axis" x1="${plotRight}" x2="${plotRight}" y1="${top}" y2="${plotBottom}"/>
		${Array.from({ length: rightTop }, (_, index) => index + 1).map(value => `<text x="${plotRight + 10}" y="${yRight(value) + 4}" text-anchor="start">${value}</text>`).join("")}
		<text class="right-axis-title" transform="translate(${plotRight + 38} ${(top + plotBottom) / 2}) rotate(90)" text-anchor="middle">Rating (1 = best, at top)</text>` : "";

	const grid = ticks.map(value => `
		<line x1="${left}" x2="${plotRight}" y1="${y(value)}" y2="${y(value)}"/>
		<text x="${left - 10}" y="${y(value) + 4}" text-anchor="end">${value.toLocaleString()}</text>`).join("");

	const every = Math.max(1, Math.ceil(matches.length / maxTicks));
	const xTicks = matches
		.map((match, index) => ({ index }))
		.filter(({ index }) => index % every === 0 || index === matches.length - 1)
		.filter(({ index }) => index === 0 || index === matches.length - 1 || matches.length - 1 - index >= every * 0.6)
		.map(({ index }) => `<text x="${x(index)}" y="${plotBottom + 20}" text-anchor="middle">${index + 1}</text>`)
		.join("");

	/* A line skips matches where that stat has no value (e.g. no defence played). */
	const drawn = lines.map(line => {
		const known = line.values.map((value, index) => ({ value, index })).filter(point => Number.isFinite(point.value));
		const yFor = line.right ? yRight : y;
		const path = known.map((point, order) => `${order ? "L" : "M"}${x(point.index).toFixed(1)},${yFor(point.value).toFixed(1)}`).join("");
		const dots = known.map(point => `<circle class="trend-dot" cx="${x(point.index).toFixed(1)}" cy="${yFor(point.value).toFixed(1)}" r="4" fill="${line.color}"/>`).join("");
		return `<path class="multi-line${line.right ? " right-axis" : ""}" d="${path}" stroke="${line.color}"/>${dots}`;
	}).join("");

	const showQualNumbers = matches.some((match, index) => match !== index + 1);
	const tableRows = matches.map((match, index) =>
		`<tr><td>${index + 1}</td>${showQualNumbers ? `<td>${escapeChartText(match)}</td>` : ""}${lines.map(line => `<td>${formatTrendValue(line.values[index])}</td>`).join("")}</tr>`
	).join("");

	const data = { matches, lines, plotRight };

	return `
	<section class="performance-chart trend-chart multi-trend" data-multi="${escapeChartText(JSON.stringify(data))}" data-ytop="${yTop}" data-size="${sizeName}"${options.clickable ? " data-clickable" : ""}>
		<div class="chart-heading">
			<h3>${escapeChartText(label)}</h3>
			<div class="chart-legend">
				${lines.map(line => `<span><i class="key-line" style="background:${line.color}"></i>${escapeChartText(line.label)}${line.right ? " (right axis)" : ""}</span>`).join("")}
			</div>
		</div>
		<div class="trend-plot">
			<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeChartText(`${label}: ${lines.map(line => line.label).join(", ")} over ${matches.length} matches`)}">
				<g class="chart-grid">${grid}</g>
				<line class="chart-axis" x1="${left}" x2="${plotRight}" y1="${plotBottom}" y2="${plotBottom}"/>
				<g class="chart-labels">${rightAxis}</g>
				${drawn}
				<g class="chart-labels">${xTicks}<text x="${left + plotWidth / 2}" y="${height - 4}" text-anchor="middle">${escapeChartText(xLabel)}</text></g>
				<line class="trend-crosshair" x1="0" x2="0" y1="${top}" y2="${plotBottom}" visibility="hidden"/>
				<rect class="multi-hit" x="${left - 12}" y="${top}" width="${plotWidth + 24}" height="${plotBottom - top}" tabindex="0" aria-label="${options.clickable ? "Explore values with the arrow keys, Enter opens that match's report" : "Explore values with the arrow keys"}"/>
			</svg>
			<div class="trend-tooltip" hidden></div>
		</div>
		<p class="chart-note">Each line is one stat, match by match (several reports for one match are averaged). A line skips matches where that stat wasn't recorded.${useRightAxis ? " Dashed lines are ratings and use the right-hand axis, which is flipped so the best rating (1) is at the top: higher on the chart is better." : ""}${options.clickable ? " Click a match to jump to its scouting report." : ""}</p>
		<details class="trend-table">
			<summary>Show data table</summary>
			<table><thead><tr><th>Match</th>${showQualNumbers ? "<th>Qual match</th>" : ""}${lines.map(line => `<th>${escapeChartText(line.label)}</th>`).join("")}</tr></thead><tbody>${tableRows}</tbody></table>
		</details>
	</section>`;
}

/* Hover, keyboard and click for the several-stats chart. */
(() => {
	const chartData = chart => JSON.parse(chart.dataset.multi);

	function geometry(chart) {
		const data = chartData(chart);
		const { width, height, left, top, bottom } = trendSize(chart);
		const plotWidth = data.plotRight - left;
		return {
			data, width, top, plotBottom: height - bottom,
			x: index => data.matches.length === 1 ? left + plotWidth / 2 : left + (index / (data.matches.length - 1)) * plotWidth,
			indexAt: viewX => data.matches.length === 1 ? 0 : Math.round(((viewX - left) / plotWidth) * (data.matches.length - 1))
		};
	}

	const clamp = (data, index) => Math.max(0, Math.min(data.matches.length - 1, index));

	function showPoint(chart, rawIndex) {
		const { data, width, top, plotBottom, x } = geometry(chart);
		const index = clamp(data, rawIndex);
		chart.dataset.index = index;

		const svg = chart.querySelector("svg");
		const crosshair = svg.querySelector(".trend-crosshair");
		crosshair.setAttribute("x1", x(index));
		crosshair.setAttribute("x2", x(index));
		crosshair.setAttribute("visibility", "visible");

		const tooltip = chart.querySelector(".trend-tooltip");
		tooltip.replaceChildren();
		const title = document.createElement("div");
		title.className = "trend-tooltip-title";
		title.textContent = data.matches[index] !== index + 1 ? `Match ${index + 1} · Qual ${data.matches[index]}` : `Match ${index + 1}`;
		tooltip.append(title);
		for (const line of data.lines) {
			const row = document.createElement("div");
			row.className = "trend-tooltip-row";
			const key = document.createElement("i");
			key.style.background = line.color;
			const strong = document.createElement("strong");
			strong.textContent = formatTrendValue(line.values[index]);
			const span = document.createElement("span");
			span.textContent = line.label;
			row.append(key, strong, span);
			tooltip.append(row);
		}
		if (chart.dataset.clickable !== undefined) {
			const hint = document.createElement("div");
			hint.className = "trend-tooltip-hint";
			hint.textContent = "Click to open the report";
			tooltip.append(hint);
		}
		tooltip.hidden = false;

		const box = svg.getBoundingClientRect();
		const plot = chart.querySelector(".trend-plot").getBoundingClientRect();
		const scale = box.width / width;
		const screenX = box.left - plot.left + x(index) * scale;
		const tipWidth = tooltip.offsetWidth;
		tooltip.style.left = `${screenX + 14 + tipWidth > plot.width ? screenX - 14 - tipWidth : screenX + 14}px`;
		tooltip.style.top = `${Math.max(0, box.top - plot.top + top * scale)}px`;
	}

	function hide(chart) {
		chart.querySelector(".trend-tooltip").hidden = true;
		chart.querySelector(".trend-crosshair").setAttribute("visibility", "hidden");
	}

	function indexAt(chart, clientX) {
		const { width, indexAt: fromView } = geometry(chart);
		const box = chart.querySelector("svg").getBoundingClientRect();
		return fromView((clientX - box.left) * (width / box.width));
	}

	function select(chart, rawIndex) {
		if (chart.dataset.clickable === undefined) return;
		const data = chartData(chart);
		const index = clamp(data, rawIndex);
		chart.dispatchEvent(new CustomEvent("trend-select", { bubbles: true, detail: { match: data.matches[index], number: index + 1 } }));
	}

	const hitOf = event => event.target.closest?.(".multi-hit");

	document.addEventListener("pointermove", event => {
		const hit = hitOf(event);
		if (hit) showPoint(hit.closest(".multi-trend"), indexAt(hit.closest(".multi-trend"), event.clientX));
	});
	document.addEventListener("pointerout", event => {
		const hit = hitOf(event);
		if (hit && document.activeElement !== hit) hide(hit.closest(".multi-trend"));
	});
	document.addEventListener("click", event => {
		const hit = hitOf(event);
		if (hit) select(hit.closest(".multi-trend"), indexAt(hit.closest(".multi-trend"), event.clientX));
	});
	document.addEventListener("focusin", event => {
		if (!event.target.classList?.contains("multi-hit")) return;
		const chart = event.target.closest(".multi-trend");
		showPoint(chart, chartData(chart).matches.length - 1);
	});
	document.addEventListener("focusout", event => {
		if (event.target.classList?.contains("multi-hit")) hide(event.target.closest(".multi-trend"));
	});
	document.addEventListener("keydown", event => {
		if (!event.target.classList?.contains("multi-hit")) return;
		const chart = event.target.closest(".multi-trend");
		const current = Number(chart.dataset.index ?? chartData(chart).matches.length - 1);
		if (event.key === "Enter") return select(chart, current);
		const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
		if (!step) return;
		event.preventDefault();
		showPoint(chart, current + step);
	});
})();

/* One point per scouted match. `valueOf` picks the stat (default: total points). */
function performanceTrendPoints(scoutingRows, valueOf = trendRowTotal) {
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
	const rowTotal = row => {
		if (String(row["No Show"] ?? "").trim().toUpperCase() === "TRUE") return null;
		return valueOf(row);
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
