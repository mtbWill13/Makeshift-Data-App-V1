const eventKey = document.getElementById("eventKey");
const sortBy = document.getElementById("sortBy");
const loadButton = document.getElementById("loadButton");
const status = document.getElementById("status");
const teamList = document.getElementById("teamList");
let eventTeams = [];

function format(value) {
	return Number.isFinite(value) ? value.toFixed(1) : "—";
}

function wholeNumber(value) {
	return value !== null && value !== undefined && String(value).trim() !== "" && Number.isFinite(Number(value))
		? Number(value)
		: null;
}

async function fetchJson(url) {
	const response = await fetch(url);
	const data = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(data.error || "Could not load event data.");
	return data;
}

function scoreFromRow(row) {
	if (String(row["No Show"] ?? "").trim().toUpperCase() === "TRUE") return null;
	const number = value => Number.isFinite(Number(value)) ? Number(value) : null;
	const find = names => {
		const entry = Object.entries(row).find(([header]) => names.includes(String(header).trim().toLowerCase()));
		return entry ? number(entry[1]) : null;
	};
	const values = [
		find(["auto scoring points"]),
		find(["teleop scoring points"]),
		find(["endgame scoring points", "end game scoring points", "endgame points", "end game points", "endgame climb points", "end game climb points"])
	].filter(Number.isFinite);
	return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function epaFromTeamEvent(row) {
	const value = row?.epa?.total_points?.mean ?? row?.epa?.total_points;
	return Number.isFinite(Number(value)) ? Number(value) : null;
}

function numberFromTeamEvent(row) {
	const value = row?.team ?? row?.team_number ?? row?.team_key;
	const match = String(value ?? "").match(/\d+/);
	return match ? match[0] : null;
}

function statboticsRank(row) {
	const candidates = [
		row?.rank,
		row?.record?.rank,
		row?.record?.qual?.rank,
		row?.rankings?.rank
	];
	return candidates.map(wholeNumber).find(Number.isFinite) ?? null;
}

function teamLink(team) {
	return `/?team=${encodeURIComponent(team)}&event=${encodeURIComponent(eventKey.value)}`;
}

function sortedTeams() {
	const metric = sortBy.value;
	const direction = metric === "rank" ? 1 : -1;

	return [...eventTeams].sort((left, right) => {
		const number = value => value !== null && value !== undefined && String(value).trim() !== "" && Number.isFinite(Number(value))
			? Number(value)
			: null;
		const leftValue = number(left[metric]);
		const rightValue = number(right[metric]);
		const leftAvailable = Number.isFinite(leftValue);
		const rightAvailable = Number.isFinite(rightValue);

		if (!leftAvailable || !rightAvailable) {
			return leftAvailable === rightAvailable ? Number(left.team) - Number(right.team) : leftAvailable ? -1 : 1;
		}

		return direction * (leftValue - rightValue) || Number(left.team) - Number(right.team);
	});
}

function renderTeams() {
	const ranked = sortedTeams();
	const label = sortBy.selectedOptions[0].text;

	teamList.innerHTML = ranked.map((team, index) => `
		<a class="team-row" href="${teamLink(team.team)}">
			<span class="rank">${index + 1}</span><strong class="team-number">${team.team}</strong>
			<span class="metric"><span class="metric-label">Event rank</span><span class="metric-value">${team.rank ?? "—"}</span></span>
			<span class="metric"><span class="metric-label">OPR</span><span class="metric-value">${format(team.opr)}</span></span>
			<span class="metric"><span class="metric-label">Scouting avg</span><span class="metric-value">${format(team.scouting)}</span></span>
			<span class="metric"><span class="metric-label">EPA</span><span class="metric-value">${format(team.epa)}</span></span><span class="arrow">›</span>
		</a>`).join("");
	status.textContent = `${ranked.length} teams loaded. Sorted by ${label}. Select a team to open its dashboard.`;
}

async function loadEvent() {
	loadButton.disabled = true;
	status.textContent = "Loading event rankings…";
	teamList.innerHTML = "";

	try {
		const [oprData, scouting, epaResult, rankings] = await Promise.all([
			fetchJson(`/api/events/${eventKey.value}/oprs`),
			fetchJson(`/api/scouting/${eventKey.value}`),
			fetchJson(`/api/statbotics/event-teams/${eventKey.value}`).catch(() => []),
			fetchJson(`/api/events/${eventKey.value}/rankings`).catch(() => [])
		]);
		const teams = new Map();
		const tbaRanks = new Map((Array.isArray(rankings) ? rankings : []).map(row => [
			String(row.team_key ?? "").replace(/^frc/i, ""),
			wholeNumber(row.rank)
		]));
		for (const [key, opr] of Object.entries(oprData.oprs || {})) {
			const team = String(key).replace(/^frc/i, "");
			teams.set(team, { team, opr: Number(opr), scoutingScores: [], epa: null, rank: tbaRanks.get(team) ?? null });
		}
		for (const [team, rank] of tbaRanks) {
			if (!team || teams.has(team)) continue;
			teams.set(team, { team, opr: null, scoutingScores: [], epa: null, rank });
		}
		for (const row of scouting) {
			const team = String(row["Team Number"] ?? "").trim();
			const score = scoreFromRow(row);
			if (!team || score === null) continue;
			const entry = teams.get(team) || { team, opr: null, scoutingScores: [], epa: null, rank: tbaRanks.get(team) ?? null };
			entry.scoutingScores.push(score);
			teams.set(team, entry);
		}
		for (const row of epaResult) {
			const team = numberFromTeamEvent(row);
			if (!team) continue;
			const entry = teams.get(team) || { team, opr: null, scoutingScores: [], epa: null, rank: tbaRanks.get(team) ?? null };
			entry.epa = epaFromTeamEvent(row);
			entry.rank ??= statboticsRank(row);
			teams.set(team, entry);
		}
		eventTeams = [...teams.values()]
			.map(team => ({ ...team, scouting: team.scoutingScores.length ? team.scoutingScores.reduce((sum, score) => sum + score, 0) / team.scoutingScores.length : null }))
			;
		renderTeams();
	} catch (error) {
		status.textContent = error.message;
	} finally {
		loadButton.disabled = false;
	}
}

const eventFromUrl = new URL(window.location).searchParams.get("event");
if ([...eventKey.options].some(option => option.value === eventFromUrl)) eventKey.value = eventFromUrl;
loadButton.addEventListener("click", loadEvent);
eventKey.addEventListener("change", loadEvent);
sortBy.addEventListener("change", renderTeams);
loadEvent();
