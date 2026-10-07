/* =================================
   FTC ALLIANCE COMPARISON (2 v 2)
   OPR estimates each team's contribution to its alliance's score, so an
   alliance's projected score is the sum of its two teams' OPRs.
================================= */

const seasonSelect = document.getElementById("seasonSelect");
const eventSelect = document.getElementById("eventSelect");
const redInputs = ["red1", "red2"].map(id => document.getElementById(id));
const blueInputs = ["blue1", "blue2"].map(id => document.getElementById(id));
const compareButton = document.getElementById("compareButton");
const results = document.getElementById("results");

let loadId = 0;

const sum = values => values.every(Number.isFinite) ? values.reduce((total, value) => total + value, 0) : null;

function row(label, red, blue, { digits = 1, lower = false } = {}) {
	const both = Number.isFinite(red) && Number.isFinite(blue) && red !== blue;
	const redWins = both && (lower ? red < blue : red > blue);
	const blueWins = both && !redWins;
	return `<tr><td>${ftcEscape(label)}</td><td class="${redWins ? "winner" : ""}">${ftcFormat(red, digits)}</td><td class="${blueWins ? "winner" : ""}">${ftcFormat(blue, digits)}</td></tr>`;
}

function teamTable(title, colour, teams, metrics) {
	return `
      <article class="individual-table-card ${colour}">
        <h4>${ftcEscape(title)}</h4>
        <table class="comparison-table">
          <thead><tr><th>Stat</th>${teams.map(team => `<th><a href="${ftcTeamUrl(team.number, seasonSelect.value)}">${team.number}</a></th>`).join("")}</tr></thead>
          <tbody>${metrics.map(([label, key, digits = 1]) => `<tr><td>${ftcEscape(label)}</td>${teams.map(team => `<td>${ftcFormat(team[key], digits)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </article>`;
}

function chart(title, red, blue, key) {
	const entries = [...red.map(team => ({ ...team, colour: "red" })), ...blue.map(team => ({ ...team, colour: "blue" }))];
	const max = Math.max(1, ...entries.map(team => team[key]).filter(Number.isFinite));
	return `
      <article class="chart-card">
        <h4>${ftcEscape(title)}</h4>
        <div class="chart-key"><span><i class="red-key"></i>Red alliance</span><span><i class="blue-key"></i>Blue alliance</span></div>
        <div class="team-bars">${entries.map(team => `
          <div class="team-bar ${team.colour}">
            <span class="team-bar-value">${ftcFormat(team[key])}</span>
            ${Number.isFinite(team[key]) ? `<div class="team-bar-fill" style="height:${Math.max(3, team[key] / max * 100).toFixed(1)}%"></div>` : "<div></div>"}
            <span class="team-bar-label">${team.number}</span>
          </div>`).join("")}
        </div>
      </article>`;
}

function render(red, blue, scope, isSeason) {
	const total = (teams, key) => sum(teams.map(team => team[key]));
	const redScore = total(red, "opr");
	const blueScore = total(blue, "opr");
	const verdict = !Number.isFinite(redScore) || !Number.isFinite(blueScore)
		? "Not enough data for all four teams."
		: redScore === blueScore
			? "Dead even on OPR."
			: `${redScore > blueScore ? "Red" : "Blue"} by ${Math.abs(redScore - blueScore).toFixed(1)} points.`;

	const metrics = isSeason
		? [["OPR", "opr"], ["Auto OPR", "auto"], ["Teleop OPR", "teleop"], ["Endgame OPR", "endgame"], ["World rank", "worldRank", 0]]
		: [["OPR", "opr"], ["Auto OPR", "auto"], ["Teleop OPR", "teleop"], ["Event rank", "eventRank", 0], ["Average RP", "rp", 2]];

	results.innerHTML = `
      <div class="heading">
        <div><h2 class="alliance-name">Red Alliance</h2><p class="team-list">${red.map(team => `${team.number} ${ftcEscape(team.name ?? "")}`).join(" • ")}</p></div>
        <div class="vs">VS</div>
        <div><h2 class="alliance-name blue">Blue Alliance</h2><p class="team-list blue">${blue.map(team => `${team.number} ${ftcEscape(team.name ?? "")}`).join(" • ")}</p></div>
      </div>

      <h3 class="section-title">Projected match (${ftcEscape(scope)})</h3>
      <table class="comparison-table">
        <thead><tr><th>Stat</th><th>Red Alliance</th><th>Blue Alliance</th></tr></thead>
        <tbody>
          ${row("Projected score (no penalties)", redScore, blueScore)}
          ${row("Projected auto", total(red, "auto"), total(blue, "auto"))}
          ${row("Projected teleop", total(red, "teleop"), total(blue, "teleop"))}
          ${isSeason ? row("Projected endgame", total(red, "endgame"), total(blue, "endgame")) : ""}
        </tbody>
      </table>
      <p class="note">${verdict} Projection = sum of each alliance's OPR.</p>

      <h3 class="section-title">Individual teams</h3>
      <section class="individual-tables">
        ${teamTable("Red alliance", "red", red, metrics)}
        ${teamTable("Blue alliance", "blue", blue, metrics)}
      </section>

      <h3 class="section-title">Team charts</h3>
      <section class="charts-grid">
        ${chart("OPR", red, blue, "opr")}
        ${chart("Auto OPR", red, blue, "auto")}
        ${chart("Teleop OPR", red, blue, "teleop")}
      </section>

      <p class="ftc-source-note">Data from FTCScout.</p>`;
}

async function compare() {
	const season = seasonSelect.value;
	const event = eventSelect.value;
	const red = redInputs.map(input => Number(input.value.trim()));
	const blue = blueInputs.map(input => Number(input.value.trim()));
	const all = [...red, ...blue];
	const option = eventSelect.selectedOptions[0];

	ftcSetParams({
		season, event,
		name: option?.dataset.temporary ? option.text : null,
		red: red.filter(Boolean).join(",") || null,
		blue: blue.filter(Boolean).join(",") || null
	});

	if (all.some(number => !number)) {
		results.innerHTML = `<div class="empty-state">Enter all four team numbers.</div>`;
		return;
	}
	if (new Set(all).size !== 4) {
		results.innerHTML = `<div class="empty-state">Use four different teams.</div>`;
		return;
	}

	const thisLoad = ++loadId;
	results.innerHTML = `<div class="loading">Loading alliance comparison…</div>`;

	try {
		if (event === FTC_SEASON_KEY) {
			const seasons = await Promise.all(all.map(number => ftcFetch(`/api/ftc/team/${number}/${season}`)));
			if (thisLoad !== loadId) return;
			const profile = data => ({
				number: data.team.number,
				name: data.team.name,
				opr: data.quickStats?.total?.value ?? null,
				auto: data.quickStats?.auto?.value ?? null,
				teleop: data.quickStats?.teleop?.value ?? null,
				endgame: data.quickStats?.endgame?.value ?? null,
				worldRank: data.quickStats?.total?.rank ?? null
			});
			const teams = seasons.map(profile);
			render(teams.slice(0, 2), teams.slice(2), FTC_SEASONS.find(item => item.year === season)?.label ?? season, true);
		} else {
			const data = await ftcFetch(`/api/ftc/event/${season}/${encodeURIComponent(event)}`);
			if (thisLoad !== loadId) return;
			const missing = all.filter(number => !data.teams.some(team => team.number === number));
			if (missing.length) {
				results.innerHTML = `<div class="empty-state">Not at ${ftcEscape(data.event.name)}: team ${missing.join(", ")}.</div>`;
				return;
			}
			const profile = number => {
				const team = data.teams.find(entry => entry.number === number);
				return {
					number,
					name: team.name,
					opr: team.stats?.opr?.total ?? null,
					auto: team.stats?.opr?.auto ?? null,
					teleop: team.stats?.opr?.teleop ?? null,
					eventRank: team.stats?.rank ?? null,
					rp: team.stats?.rp ?? null
				};
			};
			render(red.map(profile), blue.map(profile), data.event.name, false);
		}
	} catch (error) {
		if (thisLoad === loadId) results.innerHTML = `<div class="empty-state">${ftcEscape(error.message)}</div>`;
	}
}

compareButton.addEventListener("click", compare);
[...redInputs, ...blueInputs].forEach(input => input.addEventListener("keydown", event => {
	if (event.key === "Enter") compare();
}));
seasonSelect.addEventListener("change", async () => {
	await ftcFillEvents(eventSelect, seasonSelect.value, { includeSeason: true, keep: FTC_SEASON_KEY });
	compare();
});
eventSelect.addEventListener("change", compare);

/* ?season=2025&event=season&red=19498,9999&blue=16417,19532 */
(async () => {
	const params = ftcParams();
	ftcFillSeasons(seasonSelect);
	await ftcFillEvents(eventSelect, seasonSelect.value, {
		includeSeason: true,
		keep: params.get("event") ?? FTC_SEASON_KEY,
		keepName: params.get("name")
	});
	const red = (params.get("red") ?? "").split(",");
	const blue = (params.get("blue") ?? "").split(",");
	redInputs.forEach((input, index) => { input.value = red[index] ?? ""; });
	blueInputs.forEach((input, index) => { input.value = blue[index] ?? ""; });
	if ([...redInputs, ...blueInputs].every(input => input.value)) compare();
})();
