/* =================================
   FTC DATA HUB — team dashboard
   Season view: FTCScout season OPR + every event. Event view: the team's
   stats, awards and matches at one event.
================================= */

const seasonSelect = document.getElementById("seasonSelect");
const eventSelect = document.getElementById("eventSelect");
const teamInput = document.getElementById("teamInput");
const viewButton = document.getElementById("viewButton");
const results = document.getElementById("results");

let loadId = 0;

function seasonLabel(year) {
	return FTC_SEASONS.find(season => season.year === year)?.label ?? year;
}

function dataItem(label, value, description = "") {
	return `
      <div class="data-item">
        <div class="data-item-label">${ftcEscape(label)}</div>
        <div class="data-item-value">${value}</div>
        ${description ? `<div class="data-item-description">${description}</div>` : ""}
      </div>`;
}

function rankText(stat, teamCount) {
	return stat?.rank && teamCount ? `#${stat.rank.toLocaleString()} of ${teamCount.toLocaleString()} worldwide` : "";
}

function heading(team, subtitle, actions = "") {
	const place = [team.city, team.state, team.country].filter(Boolean).join(", ");
	return `
      <div class="team-hero">
        <div class="team-heading">
          <h2>Team ${ftcEscape(team.number)}${team.name ? `: ${ftcEscape(team.name)}` : ""}</h2>
          <span class="team-subtitle">${[place, team.rookieYear ? `Rookie year ${team.rookieYear}` : "", subtitle].filter(Boolean).map(ftcEscape).join(" • ")}</span>
          ${actions ? `<div class="team-actions">${actions}</div>` : ""}
        </div>
      </div>`;
}

function awardChips(awards) {
	return awards?.length
		? `<div class="award-list">${awards.map(award => `<span class="award-chip">🏆 ${ftcEscape(award)}</span>`).join("")}</div>`
		: "";
}

/* =================================
   SEASON VIEW
================================= */

function renderSeason(data, season) {
	const { team, quickStats, events } = data;
	const official = events.filter(event => event.official && event.stats);
	const record = official.reduce((sum, event) => ({
		wins: sum.wins + event.stats.wins,
		losses: sum.losses + event.stats.losses,
		ties: sum.ties + event.stats.ties
	}), { wins: 0, losses: 0, ties: 0 });
	const played = record.wins + record.losses + record.ties;
	const ranks = official.map(event => event.stats.rank).filter(Number.isFinite);
	const awards = events.flatMap(event => event.awards);
	const count = quickStats?.teamCount;

	if (!quickStats && !events.length) {
		results.innerHTML = `${heading(team, seasonLabel(season))}<div class="empty-state">No ${ftcEscape(seasonLabel(season))} results for team ${ftcEscape(team.number)} yet.</div>`;
		return;
	}

	const eventCards = events.map(event => {
		const stats = event.stats;
		return `
          <article class="data-item season-event${event.official ? "" : " unofficial"}">
            <div class="season-event-header">
              <div>
                <h4>${ftcEscape(event.name)}<span class="event-type">${ftcEscape(event.type ?? "")}</span></h4>
                <div class="data-item-description">${ftcEscape([event.start, [event.city, event.state].filter(Boolean).join(", ")].filter(Boolean).join(" • "))}</div>
              </div>
              <div class="season-event-actions">
                <a class="back-link" href="${ftcEventUrl(season, event.code, team.number, event.name)}">Rankings →</a>
                <button class="secondary-button season-event-button" type="button" data-event-code="${ftcEscape(event.code)}" data-event-name="${ftcEscape(event.name)}">Event details →</button>
              </div>
            </div>
            <div class="season-event-stats">
              <div><span>Rank</span><strong>${stats?.rank ?? "—"}</strong></div>
              <div><span>Record</span><strong>${ftcRecord(stats)}</strong></div>
              <div><span>OPR</span><strong>${ftcFormat(stats?.opr?.total)}</strong></div>
              <div><span>Auto OPR</span><strong>${ftcFormat(stats?.opr?.auto)}</strong></div>
              <div><span>Teleop OPR</span><strong>${ftcFormat(stats?.opr?.teleop)}</strong></div>
              <div><span>Avg RP</span><strong>${ftcFormat(stats?.rp, 2)}</strong></div>
            </div>
            ${awardChips(event.awards)}
          </article>`;
	}).join("");

	results.innerHTML = `
      ${heading(team, seasonLabel(season))}

      <section class="top-stats">
        <div class="stat-card">
          <div class="stat-label">Season OPR</div>
          <div class="stat-value">${ftcFormat(quickStats?.total?.value)}</div>
          <div class="stat-description">${[
		data.regionStats?.rank ? `#${data.regionStats.rank} of ${data.regionStats.teamCount} in Ontario` : "",
		rankText(quickStats?.total, count)
	].filter(Boolean).join(" • ") || "Total points, no penalties"}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Record</div>
          <div class="stat-value">${played ? ftcRecord(record) : "—"}</div>
          <div class="stat-description">${played ? `${Math.round(record.wins / played * 100)}% win rate across ${official.length} official event${official.length === 1 ? "" : "s"}` : "No official matches yet"}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Awards</div>
          <div class="stat-value">${awards.length}</div>
          <div class="stat-description">${ftcEscape(awards.slice(0, 2).join(" • ") || "None this season")}</div>
        </div>
      </section>

      <h3 class="section-title">Season OPR breakdown</h3>
      <section class="data-grid">
        ${dataItem("Auto OPR", ftcFormat(quickStats?.auto?.value), rankText(quickStats?.auto, count))}
        ${dataItem("Teleop OPR", ftcFormat(quickStats?.teleop?.value), rankText(quickStats?.teleop, count))}
        ${dataItem("Endgame OPR", ftcFormat(quickStats?.endgame?.value), rankText(quickStats?.endgame, count))}
        ${dataItem("Best event rank", ranks.length ? Math.min(...ranks) : "—", `${official.length} official event${official.length === 1 ? "" : "s"}`)}
      </section>

      <h3 class="section-title">Event by event</h3>
      <section class="season-events">${eventCards || `<div class="empty-state">No events yet this season.</div>`}</section>

      <p class="ftc-source-note">Data from FTCScout. OPR excludes penalty points. Scrimmages are shown faded and left out of the record.</p>`;
}

/* =================================
   EVENT VIEW
================================= */

function renderEvent(data, eventData, season) {
	const { team } = data;
	const { event, teams, matches } = eventData;
	const entry = teams.find(other => other.number === team.number);
	const stats = entry?.stats;
	const seasonEvent = data.events.find(other => other.code === event.code);
	const teamMatches = matches.filter(match => [...match.red.teams, ...match.blue.teams].includes(team.number));
	const rankings = `<a class="back-link" href="${ftcEventUrl(season, event.code, team.number, event.name)}">View in event rankings →</a>`;
	const stream = event.liveStreamURL ? `<a class="back-link" href="${ftcEscape(event.liveStreamURL)}" target="_blank" rel="noopener noreferrer">▶ Event livestream</a>` : "";

	if (!entry) {
		results.innerHTML = `${heading(team, event.name, rankings)}<div class="empty-state">Team ${ftcEscape(team.number)} isn't registered for ${ftcEscape(event.name)}.</div>`;
		return;
	}

	results.innerHTML = `
      ${heading(team, `${event.name}${event.start ? ` • ${event.start}` : ""}`, rankings + stream)}

      <section class="top-stats">
        <div class="stat-card">
          <div class="stat-label">Event Rank</div>
          <div class="stat-value">${stats?.rank ?? "—"}</div>
          <div class="stat-description">of ${teams.length} teams${stats ? ` • ${ftcFormat(stats.rp, 2)} avg RP` : ""}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Event OPR</div>
          <div class="stat-value">${ftcFormat(stats?.opr?.total)}</div>
          <div class="stat-description">Auto ${ftcFormat(stats?.opr?.auto)} • Teleop ${ftcFormat(stats?.opr?.teleop)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Record</div>
          <div class="stat-value">${ftcRecord(stats)}</div>
          <div class="stat-description">${stats?.played ?? 0} qualification matches</div>
        </div>
      </section>

      ${awardChips(seasonEvent?.awards)}

      <h3 class="section-title">Averages at this event</h3>
      <section class="data-grid">
        ${dataItem("Average score", ftcFormat(stats?.avg?.total), "Alliance points, no penalties")}
        ${dataItem("Average auto", ftcFormat(stats?.avg?.auto))}
        ${dataItem("Average teleop", ftcFormat(stats?.avg?.teleop))}
        ${dataItem("Tiebreaker 1", ftcFormat(stats?.tb1))}
      </section>

      <h3 class="section-title">Matches</h3>
      ${teamMatches.length
		? `<section class="match-list">${teamMatches.map(match => ftcMatchCard(match, event, team.number, season)).join("")}</section>`
		: `<div class="empty-state">No matches published for this team yet.</div>`}

      <p class="ftc-source-note">Data from FTCScout. FTC doesn't publish per-match videos; livestream links open the event's stream for that day.</p>`;
}

/* =================================
   LOAD
================================= */

async function load() {
	const number = teamInput.value.trim();
	const season = seasonSelect.value;
	const event = eventSelect.value;
	const option = eventSelect.selectedOptions[0];

	ftcSetParams({
		team: number,
		season,
		event,
		name: option?.dataset.temporary ? option.text : null
	});

	if (!number) {
		results.innerHTML = `<div class="empty-state">Enter an FTC team number, then press "View Team".</div>`;
		return;
	}

	const thisLoad = ++loadId;
	results.innerHTML = `<div class="loading">Loading team ${ftcEscape(number)}…</div>`;

	try {
		const isSeason = !event || event === FTC_SEASON_KEY;
		const [data, eventData] = await Promise.all([
			ftcFetch(`/api/ftc/team/${encodeURIComponent(number)}/${season}`),
			isSeason ? null : ftcFetch(`/api/ftc/event/${season}/${encodeURIComponent(event)}`)
		]);

		if (thisLoad !== loadId) return;
		if (isSeason) renderSeason(data, season);
		else renderEvent(data, eventData, season);
	} catch (error) {
		if (thisLoad !== loadId) return;
		results.innerHTML = `<div class="empty-state">${ftcEscape(error.message)}</div>`;
	}
}

/* "Event details" on a season card switches to that event. */
results.addEventListener("click", async clickEvent => {
	const button = clickEvent.target.closest("[data-event-code]");
	if (!button) return;

	await ftcFillEvents(eventSelect, seasonSelect.value, {
		includeSeason: true,
		keep: button.dataset.eventCode,
		keepName: button.dataset.eventName
	});
	load();
	window.scrollTo({ top: 0, behavior: "smooth" });
});

seasonSelect.addEventListener("change", async () => {
	await ftcFillEvents(eventSelect, seasonSelect.value, { includeSeason: true, keep: FTC_SEASON_KEY });
	load();
});
eventSelect.addEventListener("change", load);
viewButton.addEventListener("click", load);
teamInput.addEventListener("keydown", event => {
	if (event.key === "Enter") load();
});

/* INITIAL LOAD: ?team=19502&season=2025&event=CAONCMP */
(async () => {
	const params = ftcParams();
	ftcFillSeasons(seasonSelect);
	await ftcFillEvents(eventSelect, seasonSelect.value, {
		includeSeason: true,
		keep: params.get("event") ?? FTC_SEASON_KEY,
		keepName: params.get("name")
	});
	teamInput.value = params.get("team") ?? "";
	if (teamInput.value) load();
})();
