/* =================================
   EVENT OVERVIEW
   Event-wide graphs from the scouting sheet (plus TBA OPR and Statbotics EPA),
   and a chart builder for any stat, team list and chart type.
================================= */

const eventSelect = document.getElementById("eventKey");
const summary = document.getElementById("summary");
const dashboard = document.getElementById("dashboard");
const builder = {
	stat: document.getElementById("builderStat"),
	chart: document.getElementById("builderChart"),
	aggregate: document.getElementById("builderAggregate"),
	x: document.getElementById("builderX"),
	teams: document.getElementById("builderTeams"),
	show: document.getElementById("builderShow"),
	sort: document.getElementById("builderSort"),
	output: document.getElementById("builderOutput"),
	aggregateGroup: document.getElementById("aggregateGroup"),
	xGroup: document.getElementById("xGroup")
};

let data = null;
let stats = [];
let loadId = 0;

const LINE_COLOURS = [BRAND.red, BRAND.orange, BRAND.yellow, BRAND.green, BRAND.blue, "#c08de8", "#ef8fb7", "#9be3d6"];

function escapeHtml(value) {
	return chartEscape(value);
}

function numberOrNull(value) {
	const text = String(value ?? "").trim();
	if (text === "") return null;
	const number = Number(text);
	return Number.isFinite(number) ? number : null;
}

function teamUrl(team) {
	return `/?event=${encodeURIComponent(data.event)}&team=${team}`;
}

/* =================================
   STATS
   Built from the event's sheet columns, so events with different columns
   still work. Kinds: "match" (a number per report), "flag" (TRUE/FALSE per
   report) and "team" (one number per team, e.g. OPR).
================================= */

const IGNORED_COLUMNS = new Set(["event", "scouter name", "match number", "team number", "driver station", "comments", "", "calculated rows -->"]);

function buildStats(rows) {
	const headers = Object.keys(rows[0] ?? {});
	const find = (...names) => headers.find(header => names.some(name => header.trim().toLowerCase() === name.toLowerCase()));
	const startsWith = prefix => headers.find(header => header.trim().toLowerCase().startsWith(prefix.toLowerCase()));
	const used = new Set();
	const use = header => { if (header) used.add(header); return header; };
	const list = [];

	const auto = use(find("Auto Scoring Points"));
	const teleop = use(find("Teleop Scoring Points"));
	const climb = use(find("Climb points"));
	const autoClimb = use(find("Auto Climb"));
	const endClimb = use(find("End Game Climb"));
	const driver = use(startsWith("Driver Skill"));
	const defense = use(startsWith("Defense Rating"));

	const value = header => row => numberOrNull(row[header]);
	const climbValue = row => climb
		? numberOrNull(row[climb])
		: (autoClimb || endClimb) ? (numberOrNull(row[autoClimb]) ?? 0) + (numberOrNull(row[endClimb]) ?? 0) : null;
	const fuelValue = row => {
		const parts = [numberOrNull(row[auto]), numberOrNull(row[teleop])];
		return parts.every(part => part === null) ? null : parts.reduce((sum, part) => sum + (part ?? 0), 0);
	};

	if (auto && teleop) {
		list.push({ id: "total", label: "Total scouted points (fuel + climb)", short: "Total points", kind: "match", value: row => {
			const fuel = fuelValue(row);
			return fuel === null ? null : fuel + (climbValue(row) ?? 0);
		} });
		list.push({ id: "fuel", label: "Fuel points (auto + teleop)", short: "Fuel points", kind: "match", value: fuelValue });
	}
	if (auto) list.push({ id: "auto", label: "Auto scoring points", short: "Auto points", kind: "match", value: value(auto) });
	if (teleop) list.push({ id: "teleop", label: "Teleop scoring points", short: "Teleop points", kind: "match", value: value(teleop) });
	if (climb || autoClimb || endClimb) list.push({ id: "climb", label: "Climb points (auto + endgame)", short: "Climb points", kind: "match", value: climbValue });
	if (autoClimb) list.push({ id: "autoClimb", label: "Auto climb points", short: "Auto climb", kind: "match", value: value(autoClimb) });
	if (endClimb) list.push({ id: "endClimb", label: "Endgame climb points", short: "Endgame climb", kind: "match", value: value(endClimb) });
	if (driver) list.push({ id: "driver", label: "Driver skill (1 = best, 6 = worst)", short: "Driver skill", kind: "match", lowerIsBetter: true, value: row => {
		const rating = numberOrNull(row[driver]);
		return rating >= 1 && rating <= 6 ? rating : null;
	} });
	if (defense) list.push({ id: "defense", label: "Defense rating (1 = incredible, 5 = poor)", short: "Defense rating", kind: "match", lowerIsBetter: true, value: row => {
		const rating = numberOrNull(row[defense]);
		return rating >= 1 && rating <= 5 ? rating : null; // "x" = didn't play defense
	} });

	const flags = [
		["breakdown", "Breakdowns", "Robot died/had breakdown in functionality"],
		["tipped", "Tipped over", "Robot tipped/fell over"],
		["fouls", "Fouls or cards", "Robot received fouls or a yellow/red card"],
		["defended", "Was defended", "Robot was defended"],
		["shuttle", "Shuttled fuel", "Shuttle Fuel"],
		["noShow", "No shows", "No Show"]
	];
	for (const [id, label, column] of flags) {
		const header = use(find(column));
		if (header) list.push({ id, label, short: label, kind: "flag", includeNoShows: id === "noShow", value: row => {
			const text = String(row[header] ?? "").trim().toUpperCase();
			return text === "TRUE" ? 1 : text === "FALSE" ? 0 : null;
		} });
	}

	/* Any other column that's numeric (or 0/1) in this event's sheet. */
	for (const header of headers) {
		if (used.has(header) || IGNORED_COLUMNS.has(header.trim().toLowerCase())) continue;
		const filled = rows.map(row => String(row[header] ?? "").trim()).filter(Boolean);
		if (filled.length < rows.length * 0.5) continue;
		const upper = filled.map(text => text.toUpperCase());
		if (upper.every(text => text === "TRUE" || text === "FALSE")) {
			list.push({ id: `col:${header}`, label: header.trim(), short: header.trim(), kind: "flag", value: row => {
				const text = String(row[header] ?? "").trim().toUpperCase();
				return text === "TRUE" ? 1 : text === "FALSE" ? 0 : null;
			} });
		} else if (filled.every(text => Number.isFinite(Number(text)))) {
			const binary = filled.every(text => text === "0" || text === "1");
			list.push({ id: `col:${header}`, label: header.trim(), short: header.trim(), kind: binary ? "flag" : "match", value: value(header) });
		}
	}

	list.push({ id: "opr", label: "OPR (The Blue Alliance)", short: "OPR", kind: "team", value: team => data.opr.get(team) ?? null });
	list.push({ id: "epa", label: "EPA (Statbotics)", short: "EPA", kind: "team", value: team => data.epa.get(team) ?? null });

	return list;
}

function statById(id) {
	return stats.find(stat => stat.id === id);
}

/* Per-report values for one team (no-shows skipped unless the stat counts them). */
function teamValues(stat, team) {
	const entry = data.byTeam.get(team);
	if (!entry || stat.kind === "team") return [];
	const rows = stat.includeNoShows ? entry.rows : entry.played;
	return rows.map(stat.value).filter(value => value !== null);
}

const AGGREGATES = {
	mean: { label: "Average", apply: values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null },
	median: { label: "Median", apply: values => values.length ? quantile([...values].sort((a, b) => a - b), 0.5) : null },
	max: { label: "Best match (max)", apply: values => values.length ? Math.max(...values) : null },
	min: { label: "Worst match (min)", apply: values => values.length ? Math.min(...values) : null },
	total: { label: "Total", apply: values => values.length ? values.reduce((sum, value) => sum + value, 0) : null },
	count: { label: "Count (times TRUE)", apply: values => values.length ? values.filter(Boolean).length : null },
	rate: { label: "% of matches", apply: values => values.length ? values.filter(Boolean).length / values.length * 100 : null }
};

function aggregatesFor(stat) {
	if (stat.kind === "team") return [];
	return stat.kind === "flag" ? ["count", "rate"] : ["mean", "median", "max", "min", "total"];
}

/* One number per team for a stat: the aggregate for match/flag stats, or the team value. */
function teamValue(stat, team, aggregate) {
	if (stat.kind === "team") return stat.value(team);
	return AGGREGATES[aggregate ?? (stat.kind === "flag" ? "rate" : "mean")].apply(teamValues(stat, team));
}

function allTeams() {
	const teams = new Set([...data.byTeam.keys()]);
	for (const team of data.opr.keys()) teams.add(team);
	return [...teams].sort((a, b) => a - b);
}

/* =================================
   LOAD
================================= */

async function fetchJson(url, fallback) {
	try {
		const response = await fetch(url);
		return response.ok ? await response.json() : fallback;
	} catch {
		return fallback;
	}
}

async function load() {
	const event = eventSelect.value;
	const thisLoad = ++loadId;
	const url = new URL(window.location);
	url.searchParams.set("event", event);
	window.history.replaceState({}, "", url);

	summary.innerHTML = "";
	dashboard.innerHTML = `<div class="loading">Loading event data…</div>`;
	builder.output.innerHTML = "";

	const [rows, oprs, epas] = await Promise.all([
		fetchJson(`/api/scouting/${event}`, []),
		fetchJson(`/api/events/${event}/oprs`, {}),
		fetchJson(`/api/statbotics/event-teams/${event}`, [])
	]);
	if (thisLoad !== loadId) return;

	const byTeam = new Map();
	for (const row of Array.isArray(rows) ? rows : []) {
		const team = numberOrNull(row["Team Number"]);
		if (!team) continue;
		if (!byTeam.has(team)) byTeam.set(team, { rows: [], played: [] });
		const entry = byTeam.get(team);
		entry.rows.push(row);
		if (String(row["No Show"] ?? "").trim().toUpperCase() !== "TRUE") entry.played.push(row);
	}

	data = {
		event,
		rows: Array.isArray(rows) ? rows : [],
		byTeam,
		opr: new Map(Object.entries(oprs?.oprs ?? {}).map(([key, value]) => [Number(key.replace(/^frc/, "")), Number(value)])),
		epa: new Map((Array.isArray(epas) ? epas : [])
			.map(row => [Number(row.team), Number(row.epa?.total_points?.mean ?? row.epa?.total_points)])
			.filter(([team, epa]) => team && Number.isFinite(epa)))
	};
	stats = buildStats(data.rows);

	renderSummary();
	renderDashboard();
	fillBuilder();
	renderBuilder();
}

/* =================================
   SUMMARY + EVENT GRAPHS
================================= */

function renderSummary() {
	const played = data.rows.filter(row => String(row["No Show"] ?? "").trim().toUpperCase() !== "TRUE");
	const scouts = new Set(data.rows.map(row => String(row["Scouter Name"] ?? "").trim()).filter(Boolean));
	const total = statById("total");
	const best = total
		? [...data.byTeam.keys()].map(team => ({ team, value: teamValue(total, team, "mean") })).filter(item => item.value !== null).sort((a, b) => b.value - a.value)[0]
		: null;

	summary.innerHTML = `
      <div class="stat-card"><div class="stat-label">Teams scouted</div><div class="stat-value">${data.byTeam.size}</div><div class="stat-description">${data.opr.size} teams on TBA</div></div>
      <div class="stat-card"><div class="stat-label">Match reports</div><div class="stat-value">${played.length}</div><div class="stat-description">${data.rows.length - played.length} no-shows left out</div></div>
      <div class="stat-card"><div class="stat-label">Scouts</div><div class="stat-value">${scouts.size}</div><div class="stat-description">People who submitted reports</div></div>
      <div class="stat-card"><div class="stat-label">Top scouted average</div><div class="stat-value">${best ? best.team : "—"}</div><div class="stat-description">${best ? `${best.value.toFixed(1)} total points per match` : "No scouting data"}</div></div>`;
}

function chartCard(id, title, description, chartHtml) {
	return `
      <article class="overview-chart" data-chart-id="${id}">
        <div class="overview-chart-heading">
          <div>
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(description)}</p>
          </div>
          <button class="secondary-button download-chart" type="button" data-title="${escapeHtml(title)}">Download PNG</button>
        </div>
        <div class="chart-scroll">${chartHtml}</div>
      </article>`;
}

/* Box plot of a match stat for every team, best average first, rainbow by rank. */
function rankedBoxPlot(stat, yLabel) {
	const groups = [...data.byTeam.keys()]
		.map(team => ({ team, values: teamValues(stat, team) }))
		.filter(group => group.values.length)
		.map(group => ({ ...group, mean: AGGREGATES.mean.apply(group.values) }))
		.sort((a, b) => b.mean - a.mean);

	return boxPlot(groups.map((group, index) => ({
		label: String(group.team),
		values: group.values,
		colour: rankColour(groups.length > 1 ? index / (groups.length - 1) : 0),
		href: teamUrl(group.team)
	})), { yLabel, xLabel: "Team number", title: stat.label });
}

/* Count of TRUE reports per team (teams with at least one), most first, heat colours. */
function countBars(stat, yLabel) {
	const items = [...data.byTeam.keys()]
		.map(team => ({ team, values: teamValues(stat, team) }))
		.map(item => ({ ...item, count: item.values.filter(Boolean).length }))
		.filter(item => item.count > 0)
		.sort((a, b) => b.count - a.count || a.team - b.team);
	const max = Math.max(1, ...items.map(item => item.count));

	return barChart(items.map(item => ({
		label: String(item.team),
		value: item.count,
		colour: heatColour(max > 1 ? (item.count - 1) / (max - 1) : 1),
		title: `${item.team}: ${item.count} of ${item.values.length} matches`,
		href: teamUrl(item.team)
	})), { yLabel, xLabel: "Team number", title: stat.label, empty: `No ${stat.label.toLowerCase()} reported at this event.` });
}

/* Mean defense rating (bars taller = better), coloured by matches rated, like the reference chart. */
function defenseChart(stat) {
	const LEVELS = { 1: "Poor", 2: "Fair", 3: "Good", 4: "Great", 5: "Incredible" };
	const items = [...data.byTeam.keys()]
		.map(team => ({ team, values: teamValues(stat, team) }))
		.filter(item => item.values.length)
		.map(item => ({ ...item, mean: AGGREGATES.mean.apply(item.values) }))
		.sort((a, b) => b.values.length - a.values.length || a.mean - b.mean);
	const counts = [...new Set(items.map(item => item.values.length))].sort((a, b) => a - b);
	const maxCount = Math.max(...counts, 1);
	const colourFor = count => depthColour(maxCount > 1 ? (count - 1) / (maxCount - 1) : 0);

	return barChart(items.map(item => ({
		label: String(item.team),
		value: 6 - item.mean, // 1 (incredible) → 5 high; 5 (poor) → 1
		colour: colourFor(item.values.length),
		title: `${item.team}: average ${item.mean.toFixed(2)} (${LEVELS[Math.round(6 - item.mean)]}) over ${item.values.length} defense match${item.values.length === 1 ? "" : "es"}`,
		href: teamUrl(item.team)
	})), {
		yTicks: [1, 2, 3, 4, 5], yMin: 0, yMax: 5,
		yTickLabel: tick => LEVELS[tick] ?? "",
		yLabel: "Mean defense rating",
		xLabel: "Team number",
		title: stat.label,
		empty: "No defense ratings at this event.",
		legend: counts.map(count => ({ colour: colourFor(count), label: `${count} defense match${count === 1 ? "" : "es"}` }))
	});
}

/* Mean driver skill (1 best … 6 worst), drawn so taller = better. */
function driverChart(stat) {
	const items = [...data.byTeam.keys()]
		.map(team => ({ team, values: teamValues(stat, team) }))
		.filter(item => item.values.length)
		.map(item => ({ ...item, mean: AGGREGATES.mean.apply(item.values) }))
		.sort((a, b) => a.mean - b.mean);

	return barChart(items.map((item, index) => ({
		label: String(item.team),
		value: 7 - item.mean,
		colour: rankColour(items.length > 1 ? index / (items.length - 1) : 0),
		title: `${item.team}: average ${item.mean.toFixed(2)} over ${item.values.length} matches (1 = best)`,
		href: teamUrl(item.team)
	})), {
		yTicks: [1, 2, 3, 4, 5, 6], yMin: 0, yMax: 6,
		yTickLabel: tick => `${7 - tick}${tick === 6 ? " (best)" : tick === 1 ? " (worst)" : ""}`,
		yLabel: "Mean driver skill rank",
		xLabel: "Team number",
		title: stat.label
	});
}

/* Average of a match stat per team as bars, best first. */
function averageBars(stat, yLabel) {
	const items = [...data.byTeam.keys()]
		.map(team => ({ team, values: teamValues(stat, team) }))
		.filter(item => item.values.length)
		.map(item => ({ ...item, mean: AGGREGATES.mean.apply(item.values), hits: item.values.filter(value => value > 0).length }))
		.sort((a, b) => b.mean - a.mean);

	return barChart(items.map((item, index) => ({
		label: String(item.team),
		value: item.mean,
		colour: rankColour(items.length > 1 ? index / (items.length - 1) : 0),
		title: `${item.team}: ${item.mean.toFixed(1)} on average, scored in ${item.hits} of ${item.values.length} matches`,
		href: teamUrl(item.team)
	})), { yLabel, xLabel: "Team number", title: stat.label });
}

function scoutingVsOpr() {
	const total = statById("total");
	return scatterChart([...data.byTeam.keys()].map(team => ({
		label: String(team),
		x: data.opr.get(team),
		y: teamValue(total, team, "mean"),
		colour: BRAND.orange,
		href: teamUrl(team)
	})), { xLabel: "OPR (TBA)", yLabel: "Scouted average total points", xName: "OPR", yName: "scouted avg" });
}

function teamStatBars(stat) {
	const items = allTeams()
		.map(team => ({ team, value: stat.value(team) }))
		.filter(item => Number.isFinite(item.value))
		.sort((a, b) => b.value - a.value);
	return barChart(items.map((item, index) => ({
		label: String(item.team),
		value: item.value,
		colour: rankColour(items.length > 1 ? index / (items.length - 1) : 0),
		title: `${item.team}: ${item.value.toFixed(1)}`,
		href: teamUrl(item.team)
	})), { yLabel: stat.short, xLabel: "Team number", title: stat.label, empty: `No ${stat.short} data for this event.` });
}

function renderDashboard() {
	const cards = [];
	const add = (id, title, description, html) => cards.push(chartCard(id, title, description, html));
	const has = id => statById(id) && data.rows.length;

	if (!data.rows.length) {
		cards.push(`<div class="empty-state">No scouting sheet for this event, so only TBA and Statbotics graphs are shown.</div>`);
	}

	if (has("total")) add("total", "Total Scoring Summary", "Scouted points per match (fuel + climb), best average first.", rankedBoxPlot(statById("total"), "Total points"));
	if (has("fuel")) add("fuel", "Fuel Scoring Summary", "Auto + teleop fuel points per match.", rankedBoxPlot(statById("fuel"), "Total fuel points"));
	if (has("auto")) add("auto", "Auto Scoring Summary", "Auto fuel points per match.", rankedBoxPlot(statById("auto"), "Auto points"));
	if (has("climb")) add("climb", "Climb Points", "Average climb points per match. Hover a bar for how often they climbed.", averageBars(statById("climb"), "Average climb points"));
	if (has("breakdown")) add("breakdown", "Breakdown Counts", "Matches where the robot died or broke down.", countBars(statById("breakdown"), "Robot breakdowns"));
	if (has("defense")) add("defense", "Defense Rating Summary", "Only matches where the team played defense. Colour shows how many.", defenseChart(statById("defense")));
	if (has("driver")) add("driver", "Driver Skill Summary", "Scouts rank each driver 1 (best) to 6 (worst) against the field; taller is better.", driverChart(statById("driver")));
	if (has("fouls")) add("fouls", "Fouls & Cards", "Matches where the robot received fouls or a yellow/red card.", countBars(statById("fouls"), "Matches with fouls"));
	if (has("tipped")) add("tipped", "Tipped Over", "Matches where the robot tipped or fell over.", countBars(statById("tipped"), "Times tipped"));
	if (has("total") && data.opr.size) add("vs-opr", "Scouting vs OPR", "Does our scouting agree with TBA's OPR? Each dot is a team.", scoutingVsOpr());
	if (data.opr.size) add("opr", "OPR", "Offensive Power Rating from The Blue Alliance.", teamStatBars(statById("opr")));
	if (data.epa.size) add("epa", "EPA", "Expected Points Added from Statbotics.", teamStatBars(statById("epa")));
	else if (data.opr.size) cards.push(`<p class="chart-caption">EPA graphs are hidden: Statbotics isn't returning data for this event right now.</p>`);

	dashboard.innerHTML = cards.join("") || `<div class="empty-state">No data for this event yet.</div>`;
}

/* =================================
   CHART BUILDER
================================= */

const CHART_TYPES = {
	box: { label: "Box plot (spread per match)", kinds: ["match"] },
	bar: { label: "Bar chart", kinds: ["match", "flag", "team"] },
	line: { label: "Line over matches", kinds: ["match", "flag"] },
	scatter: { label: "Scatter vs another stat", kinds: ["match", "flag", "team"] }
};

function optionGroups(selected) {
	const groups = [
		["Scouting stats", stats.filter(stat => stat.kind === "match")],
		["Yes / no events", stats.filter(stat => stat.kind === "flag")],
		["TBA & Statbotics", stats.filter(stat => stat.kind === "team")]
	];
	return groups
		.filter(([, list]) => list.length)
		.map(([label, list]) => `<optgroup label="${escapeHtml(label)}">${list
			.map(stat => `<option value="${escapeHtml(stat.id)}"${stat.id === selected ? " selected" : ""}>${escapeHtml(stat.label)}</option>`)
			.join("")}</optgroup>`)
		.join("");
}

/* Fill the builder from the URL (?stat=&chart=&agg=&x=&teams=&show=&sort=) or defaults. */
function fillBuilder() {
	const params = new URL(window.location).searchParams;
	const wanted = id => statById(id) ? id : null;
	const statId = wanted(params.get("stat")) ?? (statById("total") ? "total" : stats[0]?.id);
	const xId = wanted(params.get("x")) ?? (statById("opr") ? "opr" : stats[0]?.id);

	builder.stat.innerHTML = optionGroups(statId);
	builder.x.innerHTML = optionGroups(xId);
	if (params.get("teams")) builder.teams.value = params.get("teams");
	if (params.get("show")) builder.show.value = params.get("show");
	if (params.get("sort")) builder.sort.value = params.get("sort");
	syncBuilderControls(params.get("agg"), params.get("chart"));
}

/* Only offer chart types and aggregates that make sense for the chosen stat. */
function syncBuilderControls(wantedAggregate = builder.aggregate.value, wantedChart = builder.chart.value) {
	const stat = statById(builder.stat.value);
	if (!stat) return;

	const allowed = Object.entries(CHART_TYPES).filter(([, type]) => type.kinds.includes(stat.kind));
	const current = wantedChart;
	builder.chart.innerHTML = allowed.map(([id, type]) => `<option value="${id}">${escapeHtml(type.label)}</option>`).join("");
	builder.chart.value = allowed.some(([id]) => id === current) ? current : allowed[0][0];

	const aggregates = aggregatesFor(stat);
	builder.aggregate.innerHTML = aggregates.map(id => `<option value="${id}">${escapeHtml(AGGREGATES[id].label)}</option>`).join("");
	if (aggregates.includes(wantedAggregate)) builder.aggregate.value = wantedAggregate;

	builder.aggregateGroup.hidden = !aggregates.length || !["bar", "scatter"].includes(builder.chart.value);
	builder.xGroup.hidden = builder.chart.value !== "scatter";
}

function chosenTeams(stat, aggregate) {
	const typed = [...new Set((builder.teams.value.match(/\d{1,5}/g) ?? []).map(Number))];
	const pool = typed.length ? typed : allTeams().filter(team => data.byTeam.has(team) || stat.kind === "team");
	const valued = pool.map(team => ({ team, value: teamValue(stat, team, aggregate) }));
	const sortMode = builder.sort.value;
	const better = (a, b) => stat.lowerIsBetter ? a.value - b.value : b.value - a.value;

	const known = valued.filter(item => Number.isFinite(item.value));
	const ranked = [...known].sort(better);
	const show = builder.show.value;
	let picked = show === "top10" ? ranked.slice(0, 10)
		: show === "top20" ? ranked.slice(0, 20)
			: show === "bottom10" ? ranked.slice(-10)
				: typed.length ? valued : known;

	if (sortMode === "high") picked = [...picked].sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
	else if (sortMode === "low") picked = [...picked].sort((a, b) => (a.value ?? Infinity) - (b.value ?? Infinity));
	else if (sortMode === "team") picked = [...picked].sort((a, b) => a.team - b.team);
	else picked = [...picked].sort((a, b) => (Number.isFinite(a.value) && Number.isFinite(b.value) ? better(a, b) : Number.isFinite(a.value) ? -1 : 1));

	return { picked, typed };
}

function renderBuilder() {
	const stat = statById(builder.stat.value);
	if (!stat || !data) return;

	const chart = builder.chart.value;
	const aggregate = builder.aggregate.value || undefined;
	const unit = stat.kind === "flag" && aggregate === "rate" ? `${stat.short} (% of matches)` : stat.kind === "flag" ? `${stat.short} (count)` : stat.short;
	const { picked, typed } = chosenTeams(stat, aggregate);
	const colourAt = index => rankColour(picked.length > 1 ? index / (picked.length - 1) : 0);

	const url = new URL(window.location);
	Object.entries({ stat: stat.id, chart, agg: aggregate, x: chart === "scatter" ? builder.x.value : null, teams: builder.teams.value.trim() || null, show: builder.show.value, sort: builder.sort.value })
		.forEach(([key, value]) => value ? url.searchParams.set(key, value) : url.searchParams.delete(key));
	window.history.replaceState({}, "", url);

	let html;
	let title;

	if (chart === "box") {
		title = `${stat.short} per match`;
		html = boxPlot(picked.map((item, index) => ({
			label: String(item.team), values: teamValues(stat, item.team), colour: colourAt(index), href: teamUrl(item.team)
		})), { yLabel: stat.short, xLabel: "Team number", title });
	} else if (chart === "bar") {
		title = stat.kind === "team" ? stat.short
			: stat.kind === "flag" ? `${stat.short} (${aggregate === "rate" ? "% of matches" : "count"})`
				: `${AGGREGATES[aggregate].label} ${stat.short.toLowerCase()}`;
		html = barChart(picked.map((item, index) => ({
			label: String(item.team),
			value: item.value,
			colour: colourAt(index),
			title: `${item.team}: ${Number.isFinite(item.value) ? item.value.toFixed(1) : "no data"}${stat.kind === "team" ? "" : ` (${teamValues(stat, item.team).length} matches)`}`,
			href: teamUrl(item.team)
		})), { yLabel: unit, xLabel: "Team number", title, empty: "No values for these teams." });
	} else if (chart === "line") {
		// Too many lines are unreadable: default to the top 6 if no teams were typed.
		const lineTeams = typed.length ? picked.slice(0, 8) : picked.slice(0, 6);
		title = `${stat.short} by match`;
		html = lineChart(lineTeams.map((item, index) => ({
			label: String(item.team),
			colour: LINE_COLOURS[index % LINE_COLOURS.length],
			points: (data.byTeam.get(item.team)?.[stat.includeNoShows ? "rows" : "played"] ?? [])
				.map(row => ({ x: numberOrNull(row["Match Number"]), y: stat.value(row) }))
				.filter(point => point.x !== null && point.y !== null)
		})), { yLabel: stat.short, xLabel: "Qualification match", xName: "match", title })
			+ (!typed.length && picked.length > 6 ? `<p class="chart-caption">Showing the top 6 teams. Type team numbers above to choose which lines to show (up to 8).</p>` : "");
	} else {
		const xStat = statById(builder.x.value);
		const xAggregate = xStat.kind === "flag" ? "rate" : "mean";
		title = `${stat.short} vs ${xStat.short}`;
		html = scatterChart(picked.map(item => ({
			label: String(item.team),
			x: teamValue(xStat, item.team, xAggregate),
			y: item.value,
			colour: BRAND.orange,
			href: teamUrl(item.team)
		})), {
			xLabel: `${xStat.short}${xStat.kind === "match" ? " (average)" : xStat.kind === "flag" ? " (% of matches)" : ""}`,
			yLabel: unit, xName: xStat.short, yName: stat.short, title
		});
	}

	// Typed teams with nothing to plot (e.g. not at this event) get named instead of vanishing.
	const missing = typed.filter(team => stat.kind === "team" ? !Number.isFinite(stat.value(team)) : !teamValues(stat, team).length);
	if (missing.length) {
		html += `<p class="chart-caption">No ${escapeHtml(stat.short.toLowerCase())} data at this event for team ${missing.join(", ")}.</p>`;
	}

	builder.output.innerHTML = chartCard("builder", title, `${eventSelect.selectedOptions[0].text} • ${picked.length - missing.length} team${picked.length - missing.length === 1 ? "" : "s"}`, html);
}

/* =================================
   EVENTS
================================= */

eventSelect.addEventListener("change", load);
builder.stat.addEventListener("change", () => { syncBuilderControls(); renderBuilder(); });
builder.chart.addEventListener("change", () => { syncBuilderControls(); renderBuilder(); });
[builder.aggregate, builder.x, builder.show, builder.sort].forEach(control => control.addEventListener("change", renderBuilder));
builder.teams.addEventListener("input", () => {
	clearTimeout(builder.teams.timer);
	builder.teams.timer = setTimeout(renderBuilder, 300);
});

document.addEventListener("click", event => {
	const button = event.target.closest(".download-chart");
	if (!button) return;
	const svgElement = button.closest(".overview-chart")?.querySelector("svg");
	if (svgElement) {
		const name = button.dataset.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
		downloadChartPng(svgElement, `${data.event}-${name}.png`, `${button.dataset.title} — ${eventSelect.selectedOptions[0].text}`);
	}
});

/* INITIAL LOAD: ?event=2026oncmp2 */
const eventFromUrl = new URL(window.location).searchParams.get("event");
if ([...eventSelect.options].some(option => option.value === eventFromUrl)) eventSelect.value = eventFromUrl;
load();
