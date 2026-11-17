// Extra public FTC data sources, beyond FTCScout (see ftc.js)
//
//   FIRST's official FTC Events API   https://ftc-events.firstinspires.org/services/API
//     The source the other sites copy from: schedules, rankings and teams the moment the
//     event publishes them. Free, but needs credentials: request them from FIRST, then set
//     FTC_API_USER (your username) and FTC_API_KEY (your authorization key) in .env.
//
//   The Orange Alliance               https://theorangealliance.org/apidocs
//     Team details and history. Free, needs an API key: set TOA_API_KEY in .env.
//
// Both are OPTIONAL. Without keys they simply report "not set up", and everything else on
// the site works from FTCScout, which needs no key.

const FIRST_BASE = "https://ftc-api.firstinspires.org/v2.0";
const TOA_BASE = "https://theorangealliance.org/api";
const APP_NAME = "MakeShift Scouting";

export const firstConfigured = () => Boolean(process.env.FTC_API_USER && process.env.FTC_API_KEY);
export const toaConfigured = () => Boolean(process.env.TOA_API_KEY);

const finite = value => {
	const number = Number(value);
	return value !== null && value !== undefined && Number.isFinite(number) ? number : null;
};

/* "Red1" / "Blue2" -> 'red' | 'blue'. */
const allianceOf = station => String(station ?? "").toLowerCase().startsWith("red") ? "red" : "blue";

export function createFtcSources({ cachedFetcher }) {
	const first = cachedFetcher(60 * 1000, async path => {
		const login = Buffer.from(`${process.env.FTC_API_USER}:${process.env.FTC_API_KEY}`).toString("base64");
		const response = await fetch(`${FIRST_BASE}${path}`, {
			headers: { Authorization: `Basic ${login}`, Accept: "application/json" },
			signal: AbortSignal.timeout(15000)
		});

		if (response.status === 404) return null;
		if (response.status === 401 || response.status === 403) throw new Error("FIRST rejected the FTC_API_USER / FTC_API_KEY.");
		if (!response.ok) throw new Error(`FIRST FTC Events API failed: ${response.status}`);
		return response.json();
	});

	const toa = cachedFetcher(10 * 60 * 1000, async path => {
		const response = await fetch(`${TOA_BASE}${path}`, {
			headers: { "X-TOA-Key": process.env.TOA_API_KEY, "X-Application-Origin": APP_NAME, "Content-Type": "application/json" },
			signal: AbortSignal.timeout(15000)
		});

		if (response.status === 404) return null;
		if (response.status === 401 || response.status === 403) throw new Error("The Orange Alliance rejected TOA_API_KEY.");
		if (!response.ok) throw new Error(`The Orange Alliance failed: ${response.status}`);
		return response.json();
	});

	return {
		/* Qualification (and playoff) schedule, in the same shape the pages use. */
		async schedule(season, code) {
			const [quals, playoffs] = await Promise.all([
				first(`/${season}/schedule/${code}?tournamentLevel=qual`),
				first(`/${season}/schedule/${code}?tournamentLevel=playoff`).catch(() => null)
			]);

			const rows = [...(quals?.schedule ?? []), ...(playoffs?.schedule ?? [])];
			return rows.map(row => {
				const teams = alliance => (row.teams ?? []).filter(team => allianceOf(team.station) === alliance).map(team => team.teamNumber);
				const playoff = String(row.tournamentLevel ?? "").toLowerCase().startsWith("playoff");
				return {
					id: finite(row.matchNumber),
					label: row.description || `${playoff ? "Playoff" : "Qualification"} ${row.matchNumber}`,
					level: playoff ? "DoubleElim" : "Quals",
					time: row.startTime ?? null,
					red: { teams: teams("red"), score: null },
					blue: { teams: teams("blue"), score: null },
					played: false,
					winner: null
				};
			});
		},

		/* Official rankings. */
		async rankings(season, code) {
			const data = await first(`/${season}/rankings/${code}`);
			return (data?.rankings ?? []).map(row => ({
				rank: finite(row.rank),
				team: finite(row.teamNumber),
				name: row.teamName ?? null,
				wins: finite(row.wins) ?? 0,
				losses: finite(row.losses) ?? 0,
				ties: finite(row.ties) ?? 0,
				played: finite(row.matchesPlayed) ?? 0,
				rankingPoints: finite(row.sortOrder1),
				tiebreaker: finite(row.sortOrder2)
			}));
		},

		/* The Orange Alliance's own record of a team. */
		async toaTeam(number) {
			const data = await toa(`/team/${number}`);
			const team = Array.isArray(data) ? data[0] : data;
			return team
				? {
					name: team.team_name_short ?? team.team_name_long ?? null,
					fullName: team.team_name_long ?? null,
					city: team.city ?? null,
					state: team.state_prov ?? null,
					country: team.country ?? null,
					rookieYear: finite(team.rookie_year),
					website: team.website ?? null
				}
				: null;
		}
	};
}

/* Where to read more about a team or event. These are plain links, no key needed. */
export function ftcLinks({ season, code, team }) {
	const links = [];
	if (team) {
		links.push({ label: "FTCScout team page", url: `https://ftcscout.org/teams/${team}?season=${season}` });
		links.push({ label: "The Orange Alliance", url: `https://theorangealliance.org/teams/${team}` });
	}
	if (code) {
		links.push({ label: "FTCScout event page", url: `https://ftcscout.org/events/${season}/${code}` });
		links.push({ label: "FIRST event page", url: `https://ftc-events.firstinspires.org/${season}/${code}` });
	}
	return links;
}
