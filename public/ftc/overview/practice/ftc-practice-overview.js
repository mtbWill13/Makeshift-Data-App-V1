/* =================================
   FTC PRACTICE TRACKER
   Shows the drive-practice runs logged on the Drive Practice page: summary cards, graphs
   (points per run, average per driver, auto vs tele) and the full log.
================================= */

const $ = id => document.getElementById(id);
const els = {
	season: $("seasonSelect"), driver: $("driverFilter"), operator: $("operatorFilter"), last: $("lastFilter"),
	summary: $("summary"), graphs: $("graphs"), table: $("table"), exportCsv: $("exportCsv"), openSheet: $("openSheet")
};

const PALETTE = [BRAND.blue, BRAND.orange, BRAND.green, BRAND.red, "#c08de8", "#ef8fb7", "#9be3d6", BRAND.yellow];
let runs = [];            // every run this season, oldest first
let loadId = 0;

const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const number = (value, digits = 0) => Number.isFinite(value) ? value.toFixed(digits) : "—";
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

const niceDate = date => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/* The runs left after the driver and "last N" choices. */
function visibleRuns() {
	let list = runs.filter(run => (!els.driver.value || run.driver === els.driver.value) && (!els.operator.value || run.operator === els.operator.value));
	if (els.last.value !== "all") list = list.slice(-Number(els.last.value));
	return list;
}

function renderSummary(list) {
	if (!list.length) {
		els.summary.innerHTML = "";
		return;
	}

	const totals = list.map(run => run.totalPoints);
	const best = list.reduce((top, run) => run.totalPoints > top.totalPoints ? run : top, list[0]);
	const recent = totals.slice(-5);
	const before = totals.slice(0, -5);
	const trend = before.length ? mean(recent) - mean(before) : null;
	const autos = list.map(run => run.autoPoints).filter(Number.isFinite);
	const teles = list.map(run => run.telePoints).filter(Number.isFinite);

	els.summary.innerHTML = `
      <div class="stat-card"><div class="stat-label">Runs logged</div><div class="stat-value">${list.length}</div><div class="stat-description">${new Set(list.map(run => run.date)).size} practice days</div></div>
      <div class="stat-card"><div class="stat-label">Best run</div><div class="stat-value">${best.totalPoints}</div><div class="stat-description">${ftcEscape(best.drivers)} · ${niceDate(best.date)}</div></div>
      <div class="stat-card"><div class="stat-label">Average run</div><div class="stat-value">${number(mean(totals), 1)}</div><div class="stat-description">${autos.length && teles.length ? `auto ${number(mean(autos), 1)} · tele ${number(mean(teles), 1)}` : "points per run"}</div></div>
      <div class="stat-card"><div class="stat-label">Last 5 runs</div><div class="stat-value">${number(mean(recent), 1)}</div><div class="stat-description">${trend === null ? "need more runs for a trend" : `<span class="${trend >= 0 ? "trend-up" : "trend-down"}">${trend >= 0 ? "▲" : "▼"} ${Math.abs(trend).toFixed(1)}</span> vs the runs before`}</div></div>`;
}

const chartCard = (id, title, description, html) => `
      <article class="overview-chart" data-chart-id="${id}">
        <div class="overview-chart-heading">
          <div><h3>${ftcEscape(title)}</h3><p>${ftcEscape(description)}</p></div>
          <button class="secondary-button download-chart" type="button" data-title="${ftcEscape(title)}">Download PNG</button>
        </div>
        <div class="chart-scroll">${html}</div>
      </article>`;

function renderGraphs(list) {
	if (!list.length) {
		els.graphs.innerHTML = `<div class="empty-state">No practice runs yet. Log one on the Drive Practice page and it appears here.</div>`;
		return;
	}

	const drivers = [...new Set(list.map(run => run.drivers))]; // each driver / operator pairing
	const cards = [];

	/* Points over time: one line for everyone, or one per driver when there are several. */
	const number_of = new Map(list.map((run, index) => [run, index + 1]));
	const series = drivers.length > 1 && drivers.length <= 8
		? drivers.map((driver, index) => ({ label: driver, colour: PALETTE[index % PALETTE.length], points: list.filter(run => run.drivers === driver).map(run => ({ x: number_of.get(run), y: run.totalPoints })) }))
		: [{ label: "All runs", colour: BRAND.blue, points: list.map(run => ({ x: number_of.get(run), y: run.totalPoints })) }];
	cards.push(chartCard("trend", "Points per run", "Total points in each run, in the order they were logged (one line per driver / operator pair).", lineChart(series, { yLabel: "Total points", xLabel: "Run", xName: "run", title: "Points per run" })));

	/* Who scores best (average of their runs): by driver, and by operator. */
	const byPerson = (role, label) => {
		const people = [...new Set(list.map(run => run[role]).filter(Boolean))];
		if (people.length < 2) return;
		const items = people.map(person => ({ person, values: list.filter(run => run[role] === person).map(run => run.totalPoints) }))
			.map(item => ({ ...item, mean: mean(item.values) }))
			.sort((a, b) => b.mean - a.mean);
		cards.push(chartCard(`avg-${role}`, `Average by ${role}`, `Average total points over each ${role}'s runs. Hover a bar for how many runs it's based on.`, barChart(items.map((item, index) => ({
			label: item.person, value: item.mean, colour: rankColour(items.length > 1 ? index / (items.length - 1) : 0),
			title: `${item.person}: ${item.mean.toFixed(1)} on average over ${plural(item.values.length, "run")} (best ${Math.max(...item.values)})`
		})), { yLabel: "Average points", xLabel: label, title: `Average by ${role}` })));
		return items;
	};

	const driverItems = byPerson("driver", "Driver");
	byPerson("operator", "Operator");

	if (driverItems) {
		cards.push(chartCard("spread", "Run-to-run spread by driver", "How steady each driver is: the box covers the middle half of their runs.", boxPlot(driverItems.map((item, index) => ({
			label: item.person, values: item.values, colour: rankColour(driverItems.length > 1 ? index / (driverItems.length - 1) : 0)
		})), { yLabel: "Total points", xLabel: "Driver", title: "Run-to-run spread by driver" })));
	}

	/* Auto vs tele, for the runs where both were recorded. */
	const split = list.filter(run => Number.isFinite(run.autoPoints) && Number.isFinite(run.telePoints));
	if (split.length) {
		cards.push(chartCard("split", "Auto vs tele", "Auto and teleop points in each run that recorded both.", lineChart([
			{ label: "Auto points", colour: BRAND.orange, points: split.map(run => ({ x: number_of.get(run), y: run.autoPoints })) },
			{ label: "Tele points", colour: BRAND.green, points: split.map(run => ({ x: number_of.get(run), y: run.telePoints })) }
		], { yLabel: "Points", xLabel: "Run", xName: "run", title: "Auto vs tele" })));
	}

	els.graphs.innerHTML = cards.join("");
}

function renderTable(list) {
	if (!list.length) {
		els.table.innerHTML = "";
		return;
	}

	const best = Math.max(...list.map(run => run.totalPoints));
	els.table.innerHTML = `
      <table class="practice-table">
        <thead><tr><th>Run</th><th>Date</th><th>Driver</th><th>Operator</th><th>Auto</th><th>Tele</th><th>Total</th><th class="notes">Notes</th></tr></thead>
        <tbody>${[...list].reverse().map(run => `
          <tr class="${run.totalPoints === best ? "best" : ""}">
            <td>${runs.indexOf(run) + 1}</td><td>${niceDate(run.date)}</td><td>${ftcEscape(run.driver)}</td><td>${ftcEscape(run.operator)}</td>
            <td>${number(run.autoPoints)}</td><td>${number(run.telePoints)}</td><td class="total">${run.totalPoints}</td>
            <td class="notes">${ftcEscape(run.notes)}</td>
          </tr>`).join("")}
        </tbody>
      </table>`;
}

function render() {
	const list = visibleRuns();
	renderSummary(list);
	renderGraphs(list);
	renderTable(list);
}

async function load() {
	const thisLoad = ++loadId;
	els.graphs.innerHTML = `<div class="loading">Loading practice runs…</div>`;

	try {
		const data = await ftcFetch(`/api/ftc/practice/${els.season.value}`);
		if (thisLoad !== loadId) return;

		runs = data.runs;
		for (const [select, role] of [[els.driver, "driver"], [els.operator, "operator"]]) {
			const chosen = select.value;
			select.innerHTML = `<option value="">Everyone</option>` + [...new Set(runs.map(run => run[role]).filter(Boolean))].map(name => `<option value="${ftcEscape(name)}">${ftcEscape(name)}</option>`).join("");
			if ([...select.options].some(option => option.value === chosen)) select.value = chosen;
		}

		els.exportCsv.href = `/api/ftc/practice/${els.season.value}/export.csv`;
		els.openSheet.hidden = !data.sheetUrl;
		if (data.sheetUrl) els.openSheet.href = data.sheetUrl;
		render();
	} catch (error) {
		if (thisLoad === loadId) els.graphs.innerHTML = `<div class="empty-state">${ftcEscape(error.message)}</div>`;
	}
}

els.season.addEventListener("change", load);
els.driver.addEventListener("change", render);
els.operator.addEventListener("change", render);
els.last.addEventListener("change", render);

document.addEventListener("click", event => {
	const button = event.target.closest(".download-chart");
	const svgElement = button?.closest(".overview-chart")?.querySelector("svg");
	if (!svgElement) return;
	const name = button.dataset.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
	downloadChartPng(svgElement, `practice-${name}.png`, `${button.dataset.title}: practice`);
});

ftcFillSeasons(els.season, "2026");
load();
