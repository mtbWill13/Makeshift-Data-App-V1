// FTC (FIRST Tech Challenge) data, from FTCScout's public REST API
// (https://ftcscout.org/api/rest, no key needed). TBA and Statbotics are FRC-only.
//
// Seasons are named by their starting year: 2025 = 2025–26 DECODE.
// Responses are trimmed to what the FTC pages use and cached briefly
// (FTCScout itself caches for 2 minutes), so pages stay fast and we stay polite.

const FTCSCOUT = "https://api.ftcscout.org/rest/v1";

// Event types that aren't official competition results.
const UNOFFICIAL_EVENT_TYPES = new Set([
	"Scrimmage", "OffSeason", "Kickoff", "Workshop", "DemoExhibition", "VolunteerSignup", "PracticeDay"
]);

function finite(value) {
	const number = Number(value);
	return value !== null && value !== undefined && Number.isFinite(number) ? number : null;
}

/* The comparable parts of FTCScout's per-event score breakdowns. Field names for
   total (no penalties), auto and teleop are the same every season; endgame only
   exists as its own field in some games. */
function breakdown(scores) {
	if (!scores) return null;
	return {
		total: finite(scores.totalPointsNp),
		auto: finite(scores.autoPoints),
		teleop: finite(scores.dcPoints),
		endgame: finite(scores.egPoints)
	};
}

function eventStats(stats) {
	if (!stats) return null;
	return {
		rank: finite(stats.rank),
		rp: finite(stats.rp),
		tb1: finite(stats.tb1),
		wins: finite(stats.wins) ?? 0,
		losses: finite(stats.losses) ?? 0,
		ties: finite(stats.ties) ?? 0,
		played: finite(stats.qualMatchesPlayed) ?? 0,
		opr: breakdown(stats.opr),
		avg: breakdown(stats.avg)
	};
}

function eventSummary(event) {
	return {
		code: event.code,
		name: event.name,
		type: event.type,
		official: !UNOFFICIAL_EVENT_TYPES.has(event.type),
		start: event.start ?? null,
		end: event.end ?? null,
		city: event.city ?? null,
		state: event.state ?? null,
		country: event.country ?? null,
		remote: Boolean(event.remote),
		liveStreamURL: event.liveStreamURL ?? null,
		livestreamsByDay: (event.livestreamsByDay ?? [])
			.filter(day => day.liveStreamURL)
			.map(day => ({ day: String(day.day).slice(0, 10), url: day.liveStreamURL }))
	};
}

/* "Quals 12" → "Qualification 12", double-elimination series 3 → "Playoff 3". */
function matchLabel(match) {
	const level = match.tournamentLevel;
	if (level === "Quals") return `Qualification ${match.id}`;
	if (level === "DoubleElim") return `Playoff ${match.series}`;
	if (level === "Finals") return `Final ${match.id % 1000 || match.series}`;
	if (level === "Semis") return `Semifinal ${match.series}-${match.id % 1000}`;
	return `${level} ${match.series || match.id}`;
}

const LEVEL_ORDER = { Quals: 0, Semis: 1, DoubleElim: 2, Finals: 3 };

function matchSummary(match) {
	const side = colour => {
		const scores = match.scores?.[colour.toLowerCase()];
		return {
			teams: (match.teams ?? [])
				.filter(team => team.alliance === colour)
				.sort((a, b) => String(a.station).localeCompare(String(b.station)))
				.map(team => team.teamNumber),
			score: finite(scores?.totalPoints),
			auto: finite(scores?.autoPoints),
			teleop: finite(scores?.dcPoints),
			penalties: finite(scores?.penaltyPointsByOpp)
		};
	};
	const red = side("Red");
	const blue = side("Blue");
	const played = Boolean(match.hasBeenPlayed) && red.score !== null && blue.score !== null;

	return {
		id: match.id,
		label: matchLabel(match),
		level: match.tournamentLevel,
		order: [LEVEL_ORDER[match.tournamentLevel] ?? 9, match.series ?? 0, match.id],
		played,
		time: match.actualStartTime ?? match.scheduledStartTime ?? null,
		red,
		blue,
		winner: !played ? null : red.score > blue.score ? "red" : blue.score > red.score ? "blue" : "tie"
	};
}

/* "JudgesChoice" → "Judges Choice"; placement 1 is just the award, 2/3 say so. */
function awardLabel(award) {
	if (award.type === "Winner") return award.placement === 1 ? "Winning alliance captain" : "Winning alliance";
	if (award.type === "Finalist") return "Finalist alliance";
	const name = String(award.type).replace(/([a-z])([A-Z])/g, "$1 $2");
	const place = { 2: " (2nd)", 3: " (3rd)" }[award.placement] ?? "";
	return `${name} Award${place}`;
}

export function registerFtcRoutes(app, { cachedFetcher, mapLimit }) {
	// Returns null for 404 (e.g. a team with no stats this season) instead of throwing.
	// Retries once on a dropped connection or 5xx, which FTCScout occasionally returns.
	const ftcscout = cachedFetcher(2 * 60 * 1000, async path => {
		for (let attempt = 1; ; attempt++) {
			try {
				const response = await fetch(`${FTCSCOUT}${path}`, {
					headers: { Accept: "application/json" },
					signal: AbortSignal.timeout(15000)
				});
				if (response.status === 404) return null;
				if (response.ok) return response.json();
				if (response.status < 500 || attempt >= 2) throw new Error(`FTCScout request failed: ${response.status}`);
			} catch (error) {
				if (attempt >= 2 || /request failed: [1-4]/.test(error.message)) throw error;
			}
			await new Promise(resolve => setTimeout(resolve, 500));
		}
	});

	const validSeason = season => /^\d{4}$/.test(season);
	const validCode = code => /^[A-Za-z0-9]{2,20}$/.test(code);

	const teamInfo = async number => {
		const team = await ftcscout(`/teams/${number}`).catch(() => null);
		return team
			? { number: team.number, name: team.name, school: team.schoolName, city: team.city, state: team.state, country: team.country, rookieYear: team.rookieYear }
			: { number: Number(number), name: null };
	};

	const eventInfo = async (season, code) => {
		const event = await ftcscout(`/events/${season}/${code}`).catch(() => null);
		return event ? eventSummary(event) : { code, name: code, type: null, official: true, start: null, livestreamsByDay: [] };
	};

	/* A team's season: FTCScout's season OPR (with world ranks), every event with
	   its stats, and awards. */
	const teamSeason = async (number, season, region = "CAON") => {
		const [info, quick, regional, events, awards] = await Promise.all([
			teamInfo(number),
			ftcscout(`/teams/${number}/quick-stats?season=${season}`).catch(() => null),
			ftcscout(`/teams/${number}/quick-stats?season=${season}&region=${region}`).catch(() => null),
			ftcscout(`/teams/${number}/events/${season}`).catch(() => null),
			ftcscout(`/teams/${number}/awards?season=${season}`).catch(() => null)
		]);

		const teamEvents = await mapLimit(events ?? [], 6, async entry => ({
			...await eventInfo(season, entry.eventCode),
			remoteEntry: Boolean(entry.isRemote),
			stats: eventStats(entry.stats),
			awards: (awards ?? []).filter(award => award.eventCode === entry.eventCode).map(awardLabel)
		}));

		const stat = key => quick?.[key] ? { value: finite(quick[key].value), rank: finite(quick[key].rank) } : null;

		return {
			team: info,
			season: Number(season),
			quickStats: quick ? { total: stat("tot"), auto: stat("auto"), teleop: stat("dc"), endgame: stat("eg"), teamCount: finite(quick.count) } : null,
			// Same OPR ranked within the region (Ontario by default); only for teams in it.
			regionStats: regional && info.state === "ON" && region === "CAON"
				? { region, rank: finite(regional.tot?.rank), teamCount: finite(regional.count) }
				: null,
			events: teamEvents.sort((a, b) => String(a.start).localeCompare(String(b.start)))
		};
	};

	// Events in a region for a season, e.g. Ontario = CAON.
	app.get("/api/ftc/events/:season", async (req, res) => {
		const { season } = req.params;
		const region = String(req.query.region ?? "CAON").toUpperCase();

		if (!validSeason(season) || !/^[A-Z0-9]{2,10}$/.test(region)) {
			return res.status(400).json({ error: "Invalid season or region." });
		}

		try {
			const events = await ftcscout(`/events/search/${season}?region=${region}&limit=200`);
			res.json((events ?? []).map(eventSummary).sort((a, b) => String(a.start).localeCompare(String(b.start))));
		} catch (error) {
			res.status(502).json({ error: `Couldn't load FTC events: ${error.message}` });
		}
	});

	// One event: details, every team with name and stats, and all matches.
	app.get("/api/ftc/event/:season/:code", async (req, res) => {
		const { season, code } = req.params;

		if (!validSeason(season) || !validCode(code)) {
			return res.status(400).json({ error: "Invalid season or event code." });
		}

		try {
			const [event, teams, matches] = await Promise.all([
				ftcscout(`/events/${season}/${code}`),
				ftcscout(`/events/${season}/${code}/teams`),
				ftcscout(`/events/${season}/${code}/matches`)
			]);

			if (!event) {
				return res.status(404).json({ error: `FTC event ${code} wasn't found for the ${season} season.` });
			}

			const named = await mapLimit(teams ?? [], 8, async entry => ({
				...await teamInfo(entry.teamNumber),
				stats: eventStats(entry.stats)
			}));

			res.json({
				event: eventSummary(event),
				teams: named,
				matches: (matches ?? [])
					.map(matchSummary)
					.sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1] || a.order[2] - b.order[2])
			});
		} catch (error) {
			res.status(502).json({ error: `Couldn't load this FTC event: ${error.message}` });
		}
	});

	// One team's season.
	app.get("/api/ftc/team/:number/:season", async (req, res) => {
		const { number, season } = req.params;

		if (!/^\d{1,6}$/.test(number) || !validSeason(season)) {
			return res.status(400).json({ error: "Invalid team number or season." });
		}

		try {
			const data = await teamSeason(number, season);
			if (!data.team.name && !data.events.length) {
				return res.status(404).json({ error: `FTC team ${number} wasn't found on FTCScout.` });
			}
			res.json(data);
		} catch (error) {
			res.status(502).json({ error: `Couldn't load FTC team ${number}: ${error.message}` });
		}
	});

	// Several teams' seasons at once, for prescouting.
	app.get("/api/ftc/prescout", async (req, res) => {
		const season = String(req.query.season ?? "");
		const teams = [...new Set(String(req.query.teams ?? "").match(/\d{1,6}/g) ?? [])].slice(0, 80);

		if (!validSeason(season) || !teams.length) {
			return res.status(400).json({ error: "Provide a season and a list of team numbers." });
		}

		try {
			res.json(await mapLimit(teams, 8, number => teamSeason(number, season).catch(() => ({
				team: { number: Number(number), name: null },
				season: Number(season),
				quickStats: null,
				events: []
			}))));
		} catch (error) {
			res.status(502).json({ error: error.message });
		}
	});

	// Team numbers registered for an event (published before it starts).
	app.get("/api/ftc/event-teams/:season/:code", async (req, res) => {
		const { season, code } = req.params;

		if (!validSeason(season) || !validCode(code)) {
			return res.status(400).json({ error: "Invalid season or event code." });
		}

		try {
			const teams = await ftcscout(`/events/${season}/${code}/teams`);
			if (teams === null) return res.status(404).json({ error: `FTC event ${code} wasn't found for ${season}.` });
			res.json(teams.map(entry => entry.teamNumber).sort((a, b) => a - b));
		} catch (error) {
			res.status(502).json({ error: error.message });
		}
	});
}
