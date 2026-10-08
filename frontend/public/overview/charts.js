/* =================================
   SVG CHARTS
   Small, dependency-free chart drawing for the event overview: bar charts,
   box plots, line charts and scatter plots. Charts are plain SVG styled by
   overview.css, so they follow the site theme and work offline.
================================= */

const CHART_HEIGHT = 380;
// Left margin fits word tick labels like "Incredible" next to the rotated axis title.
const MARGIN = { top: 16, right: 20, bottom: 78, left: 88 };

/* Brand colours, used for rank gradients and scales. */
const BRAND = {
	red: "#eb4e3f",
	orange: "#e8b63f",
	yellow: "#fae251",
	green: "#77d866",
	blue: "#59a8d7"
};

function chartEscape(value) {
	return String(value ?? "").replace(/[&<>"']/g, character => ({
		"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
	})[character]);
}

/* ---------- colour helpers ---------- */

function hexToRgb(hex) {
	const value = parseInt(hex.slice(1), 16);
	return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function mix(colours, t) {
	const clamped = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
	const scaled = clamped * (colours.length - 1);
	const index = Math.min(colours.length - 2, Math.floor(scaled));
	const local = scaled - index;
	const [a, b] = [hexToRgb(colours[index]), hexToRgb(colours[index + 1])];
	return `rgb(${a.map((channel, i) => Math.round(channel + (b[i] - channel) * local)).join(",")})`;
}

/* Best → worst across the brand rainbow (like a "Spectral" palette). */
const rankColour = t => mix([BRAND.red, BRAND.orange, BRAND.yellow, BRAND.green, BRAND.blue], t);
/* Counts: few = pale yellow, many = brand red (like a heat palette). */
const heatColour = t => mix(["#f6eaa0", BRAND.orange, "#e07a3a", BRAND.red], t);
/* Sample sizes: few = pale, many = deep blue. */
const depthColour = t => mix(["#cfe7f5", BRAND.blue, "#2c5f86"], t);

/* ---------- scale helpers ---------- */

function niceStep(range, count) {
	const raw = range / Math.max(1, count);
	const power = 10 ** Math.floor(Math.log10(raw || 1));
	const fraction = raw / power;
	return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * power;
}

function niceTicks(min, max, count = 5) {
	if (min === max) max = min + 1;
	const step = niceStep(max - min, count);
	const start = Math.floor(min / step) * step;
	const end = Math.ceil(max / step) * step;
	const ticks = [];
	for (let value = start; value <= end + step / 2; value += step) ticks.push(Number(value.toFixed(10)));
	return { ticks, min: start, max: end };
}

function formatTick(value) {
	return Math.abs(value) >= 1000 ? `${Math.round(value / 100) / 10}k` : Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/* Shared frame: gridlines, y-axis ticks/label, x-axis label. */
function frame({ width, plotWidth, plotHeight, yScale, yTicks, yTickLabel = formatTick, yLabel, xLabel }) {
	const grid = yTicks.map(tick => {
		const y = MARGIN.top + yScale(tick);
		return `<line class="chart-gridline" x1="${MARGIN.left}" x2="${MARGIN.left + plotWidth}" y1="${y}" y2="${y}"/>
			<text class="chart-tick" x="${MARGIN.left - 8}" y="${y + 4}" text-anchor="end">${chartEscape(yTickLabel(tick))}</text>`;
	}).join("");

	return `
		${grid}
		<line class="chart-baseline" x1="${MARGIN.left}" x2="${MARGIN.left + plotWidth}" y1="${MARGIN.top + plotHeight}" y2="${MARGIN.top + plotHeight}"/>
		${yLabel ? `<text class="chart-axis-label" transform="translate(16 ${MARGIN.top + plotHeight / 2}) rotate(-90)" text-anchor="middle">${chartEscape(yLabel)}</text>` : ""}
		${xLabel ? `<text class="chart-axis-label" x="${MARGIN.left + plotWidth / 2}" y="${CHART_HEIGHT - 6}" text-anchor="middle">${chartEscape(xLabel)}</text>` : ""}`;
}

/* Rotated category labels under the plot (team numbers), linked if href given. */
function categoryLabels(items, xCenter, plotHeight) {
	return items.map((item, index) => {
		const x = xCenter(index);
		const y = MARGIN.top + plotHeight + 14;
		const text = `<text class="chart-tick chart-category" transform="translate(${x} ${y}) rotate(-45)" text-anchor="end">${chartEscape(item.label)}</text>`;
		return item.href ? `<a href="${chartEscape(item.href)}">${text}</a>` : text;
	}).join("");
}

function svg(width, body, title) {
	return `<svg class="chart-svg" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${CHART_HEIGHT}" viewBox="0 0 ${width} ${CHART_HEIGHT}" role="img" aria-label="${chartEscape(title)}">${body}</svg>`;
}

/* Width grows with the number of categories so labels never collide;
   the card scrolls sideways on small screens. */
function widthFor(count, slot, minWidth) {
	const plotWidth = Math.max(minWidth - MARGIN.left - MARGIN.right, count * slot);
	return { plotWidth, width: plotWidth + MARGIN.left + MARGIN.right };
}

function legend(entries) {
	if (!entries?.length) return "";
	return `<div class="chart-legend-row">${entries
		.map(entry => entry.shape
			? `<span><i class="legend-${entry.shape}"></i>${chartEscape(entry.label)}</span>`
			: `<span><i style="background:${entry.colour}"></i>${chartEscape(entry.label)}</span>`)
		.join("")}</div>`;
}

function emptyChart(message) {
	return `<div class="chart-empty-state">${chartEscape(message)}</div>`;
}

/* =================================
   BAR CHART
   items: [{ label, value, colour, title, href }]
   Options: yLabel, xLabel, yMin, yMax, yTicks (fixed), yTickLabel, minWidth.
================================= */
function barChart(items, options = {}) {
	const usable = items.filter(item => Number.isFinite(item.value));
	if (!usable.length) return emptyChart(options.empty ?? "No data for this chart.");

	const { width, plotWidth } = widthFor(usable.length, 25, options.minWidth ?? 720);
	const plotHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
	const values = usable.map(item => item.value);
	const scale = options.yTicks
		? { ticks: options.yTicks, min: options.yMin ?? Math.min(...options.yTicks), max: options.yMax ?? Math.max(...options.yTicks) }
		: niceTicks(Math.min(0, options.yMin ?? 0, ...values), Math.max(options.yMax ?? 0, ...values));
	const yScale = value => plotHeight - (value - scale.min) / (scale.max - scale.min) * plotHeight;
	const slot = plotWidth / usable.length;
	const barWidth = Math.min(44, slot * 0.78);
	const xCenter = index => MARGIN.left + slot * index + slot / 2;

	const bars = usable.map((item, index) => {
		const top = MARGIN.top + yScale(Math.max(item.value, scale.min));
		const bottom = MARGIN.top + yScale(Math.max(0, scale.min));
		const rect = `<rect class="chart-bar" x="${(xCenter(index) - barWidth / 2).toFixed(1)}" y="${Math.min(top, bottom).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(1, Math.abs(bottom - top)).toFixed(1)}" rx="3" fill="${item.colour ?? BRAND.blue}"><title>${chartEscape(item.title ?? `${item.label}: ${item.value}`)}</title></rect>`;
		return item.href ? `<a href="${chartEscape(item.href)}">${rect}</a>` : rect;
	}).join("");

	return svg(width, `
		${frame({ width, plotWidth, plotHeight, yScale, yTicks: scale.ticks, yTickLabel: options.yTickLabel, yLabel: options.yLabel, xLabel: options.xLabel })}
		${bars}
		${categoryLabels(usable, xCenter, plotHeight)}`, options.title) + legend(options.legend);
}

/* =================================
   BOX PLOT
   groups: [{ label, values: [numbers], colour, href }]
   Box = quartiles, line = median, whiskers = furthest points within 1.5×IQR,
   dots = outliers, diamond = mean.
================================= */
function quantile(sorted, q) {
	const position = (sorted.length - 1) * q;
	const base = Math.floor(position);
	const next = sorted[base + 1] ?? sorted[base];
	return sorted[base] + (next - sorted[base]) * (position - base);
}

function boxStats(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const q1 = quantile(sorted, 0.25);
	const q3 = quantile(sorted, 0.75);
	const iqr = q3 - q1;
	const inside = sorted.filter(value => value >= q1 - 1.5 * iqr && value <= q3 + 1.5 * iqr);
	return {
		q1, q3,
		median: quantile(sorted, 0.5),
		mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
		low: inside[0] ?? sorted[0],
		high: inside.at(-1) ?? sorted.at(-1),
		outliers: sorted.filter(value => value < q1 - 1.5 * iqr || value > q3 + 1.5 * iqr),
		count: sorted.length
	};
}

function boxPlot(groups, options = {}) {
	const usable = groups.filter(group => group.values.length);
	if (!usable.length) return emptyChart(options.empty ?? "No data for this chart.");

	const { width, plotWidth } = widthFor(usable.length, 28, options.minWidth ?? 720);
	const plotHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
	const all = usable.flatMap(group => group.values);
	const scale = niceTicks(Math.min(0, ...all), Math.max(...all));
	const yScale = value => plotHeight - (value - scale.min) / (scale.max - scale.min) * plotHeight;
	const slot = plotWidth / usable.length;
	const boxWidth = Math.min(40, slot * 0.7);
	const xCenter = index => MARGIN.left + slot * index + slot / 2;
	const y = value => (MARGIN.top + yScale(value)).toFixed(1);

	const boxes = usable.map((group, index) => {
		const stats = boxStats(group.values);
		const x = xCenter(index);
		const left = (x - boxWidth / 2).toFixed(1);
		const title = `${group.label}: mean ${stats.mean.toFixed(1)}, median ${stats.median.toFixed(1)}, range ${Math.min(...group.values)}–${Math.max(...group.values)} (${stats.count} matches)`;
		const body = `
			<g class="chart-box"><title>${chartEscape(title)}</title>
				<line class="chart-whisker" x1="${x}" x2="${x}" y1="${y(stats.high)}" y2="${y(stats.q3)}"/>
				<line class="chart-whisker" x1="${x}" x2="${x}" y1="${y(stats.q1)}" y2="${y(stats.low)}"/>
				<line class="chart-whisker" x1="${x - boxWidth / 4}" x2="${x + boxWidth / 4}" y1="${y(stats.high)}" y2="${y(stats.high)}"/>
				<line class="chart-whisker" x1="${x - boxWidth / 4}" x2="${x + boxWidth / 4}" y1="${y(stats.low)}" y2="${y(stats.low)}"/>
				<rect x="${left}" y="${y(stats.q3)}" width="${boxWidth.toFixed(1)}" height="${Math.max(1.5, y(stats.q1) - y(stats.q3)).toFixed(1)}" rx="2" fill="${group.colour ?? BRAND.blue}" class="chart-box-body"/>
				<line class="chart-median" x1="${left}" x2="${(x + boxWidth / 2).toFixed(1)}" y1="${y(stats.median)}" y2="${y(stats.median)}"/>
				${stats.outliers.map(value => `<circle class="chart-outlier" cx="${x}" cy="${y(value)}" r="3.5"/>`).join("")}
				<rect class="chart-mean" x="${x - 5}" y="${(Number(y(stats.mean)) - 5).toFixed(1)}" width="10" height="10" transform="rotate(45 ${x} ${y(stats.mean)})"/>
			</g>`;
		return group.href ? `<a href="${chartEscape(group.href)}">${body}</a>` : body;
	}).join("");

	return svg(width, `
		${frame({ width, plotWidth, plotHeight, yScale, yTicks: scale.ticks, yLabel: options.yLabel, xLabel: options.xLabel })}
		${boxes}
		${categoryLabels(usable, xCenter, plotHeight)}`, options.title) + legend(options.legend ?? [
		{ shape: "diamond", label: "Mean" },
		{ shape: "circle", label: "Outlier" },
		{ shape: "box", label: "Middle 50% of matches, line = median" }
	]);
}

/* =================================
   LINE CHART
   series: [{ label, colour, points: [{ x, y }] }]
================================= */
function lineChart(series, options = {}) {
	const usable = series.filter(line => line.points.length);
	if (!usable.length) return emptyChart(options.empty ?? "No data for this chart.");

	const width = options.minWidth ?? 720;
	const plotWidth = width - MARGIN.left - MARGIN.right;
	const plotHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom + 30;
	const xs = usable.flatMap(line => line.points.map(point => point.x));
	const ys = usable.flatMap(line => line.points.map(point => point.y));
	const xScaleInfo = niceTicks(Math.min(...xs), Math.max(...xs), 8);
	const yScaleInfo = niceTicks(Math.min(0, ...ys), Math.max(...ys));
	const xScale = value => MARGIN.left + (value - xScaleInfo.min) / (xScaleInfo.max - xScaleInfo.min) * plotWidth;
	const yScale = value => plotHeight - (value - yScaleInfo.min) / (yScaleInfo.max - yScaleInfo.min) * plotHeight;

	const xTicks = xScaleInfo.ticks.map(tick =>
		`<text class="chart-tick" x="${xScale(tick)}" y="${MARGIN.top + plotHeight + 18}" text-anchor="middle">${formatTick(tick)}</text>`
	).join("");

	const lines = usable.map(line => {
		const points = [...line.points].sort((a, b) => a.x - b.x);
		const path = points.map((point, index) => `${index ? "L" : "M"}${xScale(point.x).toFixed(1)},${(MARGIN.top + yScale(point.y)).toFixed(1)}`).join(" ");
		return `<g><path class="chart-line" d="${path}" stroke="${line.colour}"/>
			${points.map(point => `<circle class="chart-point" cx="${xScale(point.x).toFixed(1)}" cy="${(MARGIN.top + yScale(point.y)).toFixed(1)}" r="3.5" fill="${line.colour}"><title>${chartEscape(`${line.label} – ${options.xName ?? "x"} ${point.x}: ${point.y}`)}</title></circle>`).join("")}</g>`;
	}).join("");

	const body = `
		${frame({ width, plotWidth, plotHeight, yScale, yTicks: yScaleInfo.ticks, yLabel: options.yLabel })}
		${xTicks}
		${options.xLabel ? `<text class="chart-axis-label" x="${MARGIN.left + plotWidth / 2}" y="${MARGIN.top + plotHeight + 40}" text-anchor="middle">${chartEscape(options.xLabel)}</text>` : ""}
		${lines}`;

	return svg(width, body, options.title).replace(`height="${CHART_HEIGHT}" viewBox="0 0 ${width} ${CHART_HEIGHT}"`, `height="${MARGIN.top + plotHeight + 50}" viewBox="0 0 ${width} ${MARGIN.top + plotHeight + 50}"`)
		+ legend(usable.map(line => ({ colour: line.colour, label: line.label })));
}

/* =================================
   SCATTER PLOT
   points: [{ label, x, y, colour, href }] — with a least-squares trend line.
================================= */
function scatterChart(points, options = {}) {
	const usable = points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
	if (usable.length < 2) return emptyChart(options.empty ?? "Not enough teams with both stats.");

	const width = options.minWidth ?? 720;
	const plotWidth = width - MARGIN.left - MARGIN.right;
	const plotHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom + 30;
	const xInfo = niceTicks(Math.min(...usable.map(point => point.x)), Math.max(...usable.map(point => point.x)), 6);
	const yInfo = niceTicks(Math.min(...usable.map(point => point.y)), Math.max(...usable.map(point => point.y)));
	const xScale = value => MARGIN.left + (value - xInfo.min) / (xInfo.max - xInfo.min) * plotWidth;
	const yScale = value => plotHeight - (value - yInfo.min) / (yInfo.max - yInfo.min) * plotHeight;

	// Least-squares trend line and correlation.
	const n = usable.length;
	const meanX = usable.reduce((sum, point) => sum + point.x, 0) / n;
	const meanY = usable.reduce((sum, point) => sum + point.y, 0) / n;
	const sxx = usable.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
	const syy = usable.reduce((sum, point) => sum + (point.y - meanY) ** 2, 0);
	const sxy = usable.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0);
	const slope = sxx ? sxy / sxx : 0;
	const r = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
	const lineY = x => meanY + slope * (x - meanX);
	const clampY = value => Math.min(yInfo.max, Math.max(yInfo.min, value));

	const xTicks = xInfo.ticks.map(tick =>
		`<line class="chart-gridline" x1="${xScale(tick)}" x2="${xScale(tick)}" y1="${MARGIN.top}" y2="${MARGIN.top + plotHeight}"/>
		<text class="chart-tick" x="${xScale(tick)}" y="${MARGIN.top + plotHeight + 18}" text-anchor="middle">${formatTick(tick)}</text>`
	).join("");

	const dots = usable.map(point => {
		const cx = xScale(point.x).toFixed(1);
		const cy = (MARGIN.top + yScale(point.y)).toFixed(1);
		const body = `<g><circle class="chart-point" cx="${cx}" cy="${cy}" r="5" fill="${point.colour ?? BRAND.blue}"><title>${chartEscape(`${point.label}: ${options.xName ?? "x"} ${point.x.toFixed(1)}, ${options.yName ?? "y"} ${point.y.toFixed(1)}`)}</title></circle>
			<text class="chart-point-label" x="${(Number(cx) + 7).toFixed(1)}" y="${(Number(cy) - 6).toFixed(1)}">${chartEscape(point.label)}</text></g>`;
		return point.href ? `<a href="${chartEscape(point.href)}">${body}</a>` : body;
	}).join("");

	const body = `
		${frame({ width, plotWidth, plotHeight, yScale, yTicks: yInfo.ticks, yLabel: options.yLabel })}
		${xTicks}
		<line class="chart-trend" x1="${xScale(xInfo.min)}" x2="${xScale(xInfo.max)}" y1="${(MARGIN.top + yScale(clampY(lineY(xInfo.min)))).toFixed(1)}" y2="${(MARGIN.top + yScale(clampY(lineY(xInfo.max)))).toFixed(1)}"/>
		${options.xLabel ? `<text class="chart-axis-label" x="${MARGIN.left + plotWidth / 2}" y="${MARGIN.top + plotHeight + 40}" text-anchor="middle">${chartEscape(options.xLabel)}</text>` : ""}
		${dots}`;

	const height = MARGIN.top + plotHeight + 50;
	return svg(width, body, options.title).replace(`height="${CHART_HEIGHT}" viewBox="0 0 ${width} ${CHART_HEIGHT}"`, `height="${height}" viewBox="0 0 ${width} ${height}"`)
		+ `<p class="chart-caption">Dashed line = trend. Correlation r = ${r.toFixed(2)} (${Math.abs(r) >= 0.7 ? "strong" : Math.abs(r) >= 0.4 ? "moderate" : "weak"}).</p>`;
}

/* =================================
   PNG EXPORT
   Copies computed styles onto a clone (CSS variables don't survive outside the
   page), draws it on a 2× canvas over the page background, and downloads it.
================================= */
async function downloadChartPng(svgElement, filename, title) {
	const clone = svgElement.cloneNode(true);
	const source = [svgElement, ...svgElement.querySelectorAll("*")];
	const target = [clone, ...clone.querySelectorAll("*")];
	const props = ["fill", "stroke", "stroke-width", "stroke-dasharray", "opacity", "font-size", "font-weight", "font-family"];

	source.forEach((element, index) => {
		const style = getComputedStyle(element);
		target[index].setAttribute("style", props.map(prop => `${prop}:${style.getPropertyValue(prop)}`).join(";"));
	});

	const width = Number(svgElement.getAttribute("width"));
	const height = Number(svgElement.getAttribute("height"));
	const titleHeight = title ? 40 : 0;
	const background = getComputedStyle(document.body).backgroundColor;
	const textColour = getComputedStyle(document.body).color;

	const data = new XMLSerializer().serializeToString(clone);
	const image = new Image();
	image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data)}`;
	await image.decode();

	const canvas = document.createElement("canvas");
	canvas.width = width * 2;
	canvas.height = (height + titleHeight) * 2;
	const context = canvas.getContext("2d");
	context.scale(2, 2);
	context.fillStyle = background;
	context.fillRect(0, 0, width, height + titleHeight);
	if (title) {
		context.fillStyle = textColour;
		context.font = `700 18px ${getComputedStyle(document.body).fontFamily}`;
		context.fillText(title, MARGIN.left, 26);
	}
	context.drawImage(image, 0, titleHeight, width, height);

	const link = document.createElement("a");
	link.href = canvas.toDataURL("image/png");
	link.download = filename;
	link.click();
}
