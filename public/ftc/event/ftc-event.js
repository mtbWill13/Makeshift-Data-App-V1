/* =================================
   FTC EVENT RANKINGS
================================= */

const seasonSelect = document.getElementById("seasonSelect");
const eventSelect = document.getElementById("eventSelect");
const sortBy = document.getElementById("sortBy");
const loadButton = document.getElementById("loadButton");
const status = document.getElementById("status");
const teamList = document.getElementById("teamList");

const OTHER_EVENT = "__other";

let eventData = null;
let loadId = 0;
const highlightTeam = Number(ftcParams().get("team")) || null;

const SORTS = {
	rank: { value: team => team.stats?.rank, ascending: true },
	opr: { value: team => team.stats?.opr?.total },
	auto: { value: team => team.stats?.opr?.auto },
	teleop: { value: team => team.stats?.opr?.teleop },
	rp: { value: team => team.stats?.rp },
	avg: { value: team => team.stats?.avg?.total }
};

function sortedTeams() {
	const { value, ascending } = SORTS[sortBy.value];
	return [...eventData.teams].sort((a, b) => {
		const left = value(a);
		const right = value(b);
		if (!Number.isFinite(left) && !Number.isFinite(right)) return a.number - b.number;
		if (!Number.isFinite(left)) return 1;
		if (!Number.isFinite(right)) return -1;
		return (ascending ? left - right : right - left) || a.number - b.number;
	});
}

function render() {
	if (!eventData) return;

	const { event, teams, matches } = eventData;
	const season = seasonSelect.value;
	const temporaryName = eventSelect.selectedOptions[0]?.dataset.temporary ? event.name : null;
	const played = matches.filter(match => match.played).length;

	teamList.innerHTML = sortedTeams().map((team, index) => `
		<a class="team-row${team.number === highlightTeam ? " highlighted" : ""}" href="${ftcTeamUrl(team.number, season, event.code, temporaryName)}">
			<span class="rank">${index + 1}</span>
			<span class="metric"><strong class="team-number">${team.number}</strong><span class="metric-label">${ftcEscape(team.name ?? "")}</span></span>
			<span class="metric"><span class="metric-label">Event rank</span><span class="metric-value">${team.stats?.rank ?? "—"}</span></span>
			<span class="metric"><span class="metric-label">OPR</span><span class="metric-value">${ftcFormat(team.stats?.opr?.total)}</span></span>
			<span class="metric"><span class="metric-label">Auto / Teleop</span><span class="metric-value">${ftcFormat(team.stats?.opr?.auto)} / ${ftcFormat(team.stats?.opr?.teleop)}</span></span>
			<span class="metric"><span class="metric-label">Record</span><span class="metric-value">${ftcRecord(team.stats)}</span></span>
			<span class="arrow">›</span>
		</a>`).join("");

	const where = [event.city, event.state].filter(Boolean).join(", ");
	status.innerHTML = `${ftcEscape(event.name)}${where ? ` • ${ftcEscape(where)}` : ""}${event.start ? ` • ${ftcEscape(event.start)}` : ""} — ${teams.length} teams, ${played} matches played.${event.liveStreamURL ? ` <a href="${ftcEscape(event.liveStreamURL)}" target="_blank" rel="noopener noreferrer">▶ Livestream</a>` : ""}`;

	if (!teams.length) {
		teamList.innerHTML = `<div class="empty-state">No teams published for this event yet.</div>`;
	}

	teamList.querySelector(".highlighted")?.scrollIntoView({ block: "center", behavior: "smooth" });
}

async function loadEvent() {
	const season = seasonSelect.value;
	const code = eventSelect.value;
	if (!code || code === OTHER_EVENT) return;

	const option = eventSelect.selectedOptions[0];
	ftcSetParams({ season, event: code, name: option?.dataset.temporary ? option.text : null });

	const thisLoad = ++loadId;
	loadButton.disabled = true;
	status.textContent = "Loading event…";
	teamList.innerHTML = "";

	try {
		const data = await ftcFetch(`/api/ftc/event/${season}/${encodeURIComponent(code)}`);
		if (thisLoad !== loadId) return;
		eventData = data;
		render();
	} catch (error) {
		if (thisLoad !== loadId) return;
		eventData = null;
		status.textContent = error.message;
	} finally {
		if (thisLoad === loadId) loadButton.disabled = false;
	}
}

/* Ontario events, plus "Other event code…" for anything else (e.g. Worlds). */
async function fillEvents(keep, keepName) {
	const events = await ftcFillEvents(eventSelect, seasonSelect.value, { keep, keepName });
	eventSelect.insertAdjacentHTML("beforeend", `<option value="${OTHER_EVENT}">Other event code…</option>`);

	/* Default to the most recent event that has started (or the first upcoming one). */
	const today = new Date().toISOString().slice(0, 10);
	const started = events.filter(event => event.start && event.start <= today);
	const fallback = (started.at(-1) ?? events[0])?.code;
	const wanted = keep ?? fallback;
	if (wanted && [...eventSelect.options].some(option => option.value === wanted)) eventSelect.value = wanted;
}

eventSelect.addEventListener("change", async () => {
	if (eventSelect.value !== OTHER_EVENT) return loadEvent();

	const code = (window.prompt("FTC event code (from FTCScout or the FIRST event page), e.g. FTCCMP1JACK") ?? "").trim().toUpperCase();
	if (!/^[A-Z0-9]{2,20}$/.test(code)) {
		eventSelect.selectedIndex = 0;
		return loadEvent();
	}
	await fillEvents(code, code);
	loadEvent();
});
seasonSelect.addEventListener("change", async () => {
	await fillEvents(null);
	loadEvent();
});
sortBy.addEventListener("change", render);
loadButton.addEventListener("click", loadEvent);

/* ?season=2025&event=CAONCMP&team=19498 */
(async () => {
	const params = ftcParams();
	ftcFillSeasons(seasonSelect);
	await fillEvents(params.get("event"), params.get("name"));
	loadEvent();
})();
