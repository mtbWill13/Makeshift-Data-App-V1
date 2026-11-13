// Fake event for trying out the Scout Bets page
//
// Turn on with BETS_FAKE_EVENT=1 in .env. It adds an event called "2026fake" that
// looks like a real one to the rest of the site: 90 qualification matches between
// real Ontario teams, played one every minute (the first dozen are already
// done when the server starts). Betting closes 10 seconds before a match, and a
// button on the Scout Bets page can run any match straight away. Scores come from
// each team's real season EPA plus some luck, so the favourite doesn't always win.
//
// It answers the few The Blue Alliance requests the site makes for an event, so
// nothing is ever sent to The Blue Alliance or Statbotics for it. Restarting the
// server starts the schedule over.

import { readFileSync } from "fs";

export const FAKE_EVENT_KEY = "2026fake";
export const fakeEventEnabled = () => process.env.BETS_FAKE_EVENT === "1";
export const FAKE_BETS_CLOSE_BEFORE_MS = 10 * 1000;

const MATCH_COUNT = 90;
const MATCH_MINUTES = 1;
const ALREADY_PLAYED = 12;
const STARTED_AT = Date.now() - ALREADY_PLAYED * MATCH_MINUTES * 60 * 1000;

/* Matches the tester has run early with the "Run this match now" button. */
const playedEarly = new Set();

export function playFakeMatchNow(number) {
	if (!Number.isInteger(number) || number < 1 || number > MATCH_COUNT) return false;
	playedEarly.add(number);
	return true;
}

/* Real Ontario teams. Each team's strength (points per match) is its real season EPA
   from the saved Statbotics download (data/statbotics-team-years-<year>.json, the one
   Prescouting uses); a team missing from it keeps the made-up number below. */
const TEAMS = {
	2056: 96, 1114: 92, 610: 88, 1241: 84, 865: 81, 4039: 78, 1325: 76, 2702: 73, 771: 70, 5406: 68,
	1310: 65, 4678: 62, 2200: 60, 7520: 57, 188: 55, 4688: 52, 4069: 50, 4907: 47, 5031: 45, 3161: 43,
	1360: 40, 9562: 37, 5024: 35, 8081: 32, 7558: 30, 2935: 27, 8349: 24, 6632: 21, 9785: 18, 11270: 15
};

export let strengthSource = "made-up numbers (no saved Statbotics season download found)";
let seasonLoaded = false;

/* Switches the teams to their real season EPA. It only ever happens once: after that the numbers
   are frozen, so a match's score can't change after bets were settled on it. Returns how many
   teams got a real number. */
export function applySeasonRows(rows) {
	if (seasonLoaded) return 0;
	let found = 0;

	for (const row of rows ?? []) {
		const epa = Number(row.epa?.total_points?.mean ?? row.epa?.total_points);
		if (row.team in TEAMS && Number.isFinite(epa) && epa > 0) {
			TEAMS[row.team] = Math.round(epa * 10) / 10;
			found += 1;
		}
	}

	if (found) {
		seasonLoaded = true;
		strengthSource = `season EPA for ${found} of ${Object.keys(TEAMS).length} teams`;
	}
	return found;
}

/* Has the real season EPA been loaded (rather than the made-up fallback)? */
export const usingSeasonStrengths = () => seasonLoaded;

/* The newest saved Statbotics season download if this server has one (Prescouting makes it);
   otherwise the snapshot kept with the code, so a fresh deployment still gets real numbers. */
for (const [file, read] of [
	[`./data/statbotics-team-years-${new Date().getFullYear()}.json`, saved => saved.rows],
	["./fake-event-strengths.json", saved => Object.entries(saved.epa ?? {}).map(([team, epa]) => ({ team: Number(team), epa: { total_points: epa } }))]
]) {
	try {
		if (applySeasonRows(read(JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"))))) break;
	} catch {
		/* Not there: try the next one. */
	}
}

const TEAM_NUMBERS = Object.keys(TEAMS).map(Number);
const averageStrength = () => TEAM_NUMBERS.reduce((sum, team) => sum + TEAMS[team], 0) / TEAM_NUMBERS.length;

/* Small repeatable random numbers, so a match always has the same teams and score. */
function random(seed) {
	let t = (seed + 0x6D2B79F5) >>> 0;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function teamsFor(number) {
	const order = [...TEAM_NUMBERS]
		.map((team, index) => ({ team, key: random(number * 1000 + index) }))
		.sort((a, b) => a.key - b.key)
		.map(item => item.team);
	return { red: order.slice(0, 3), blue: order.slice(3, 6) };
}

function scoreFor(number, side, teams) {
	const strength = teams.reduce((sum, team) => sum + TEAMS[team], 0);
	const luck = 0.75 + random(number * 77 + (side === "red" ? 1 : 2)) * 0.5;
	return Math.round(strength * luck);
}

function matches() {
	const now = Date.now();

	return Array.from({ length: MATCH_COUNT }, (_, index) => {
		const number = index + 1;
		const scheduled = STARTED_AT + index * MATCH_MINUTES * 60 * 1000;
		const played = playedEarly.has(number) || scheduled + MATCH_MINUTES * 60 * 1000 <= now;
		const teams = teamsFor(number);
		const red = scoreFor(number, "red", teams.red);
		const blue = scoreFor(number, "blue", teams.blue);

		return {
			key: `${FAKE_EVENT_KEY}_qm${number}`,
			comp_level: "qm",
			set_number: 1,
			match_number: number,
			predicted_time: Math.floor(scheduled / 1000),
			time: Math.floor(scheduled / 1000),
			actual_time: played ? Math.floor(Math.min(scheduled, now) / 1000) : null,
			winning_alliance: !played || red === blue ? "" : red > blue ? "red" : "blue",
			alliances: {
				red: { team_keys: teams.red.map(team => `frc${team}`), score: played ? red : -1 },
				blue: { team_keys: teams.blue.map(team => `frc${team}`), score: played ? blue : -1 }
			},
			videos: []
		};
	});
}

function rankings() {
	const record = new Map(TEAM_NUMBERS.map(team => [team, { wins: 0, losses: 0, ties: 0, played: 0 }]));

	for (const match of matches()) {
		if (match.alliances.red.score < 0) continue;
		const { red, blue } = match.alliances;
		for (const [side, other] of [[red, blue], [blue, red]]) {
			for (const key of side.team_keys) {
				const entry = record.get(Number(key.slice(3)));
				entry.played += 1;
				if (side.score > other.score) entry.wins += 1;
				else if (side.score < other.score) entry.losses += 1;
				else entry.ties += 1;
			}
		}
	}

	return [...record.entries()]
		.sort(([, a], [, b]) => (b.wins * 2 + b.ties) - (a.wins * 2 + a.ties))
		.map(([team, entry], index) => ({
			rank: index + 1,
			team_key: `frc${team}`,
			record: { wins: entry.wins, losses: entry.losses, ties: entry.ties },
			matches_played: entry.played
		}));
}

/* Does this The Blue Alliance path belong to the fake event? */
export const isFakeEventPath = path => fakeEventEnabled() && new RegExp(`^/event/${FAKE_EVENT_KEY}(/|$)`).test(path);

/* The answer The Blue Alliance would give for a fake-event path. */
export function fakeEventResponse(path) {
	const rest = path.slice(`/event/${FAKE_EVENT_KEY}`.length);
	const today = new Date().toISOString().slice(0, 10);

	if (rest === "") return { key: FAKE_EVENT_KEY, name: "Fake Test Event", start_date: today, end_date: today, year: 2026 };
	if (rest === "/matches") return matches();
	if (rest === "/oprs") {
		return {
			oprs: Object.fromEntries(TEAM_NUMBERS.map(team => [`frc${team}`, TEAMS[team]])),
			dprs: Object.fromEntries(TEAM_NUMBERS.map(team => [`frc${team}`, 0])),
			ccwms: Object.fromEntries(TEAM_NUMBERS.map(team => [`frc${team}`, TEAMS[team] - averageStrength()]))
		};
	}
	if (rest === "/rankings") return { rankings: rankings() };
	if (rest === "/teams/keys") return TEAM_NUMBERS.map(team => `frc${team}`);

	const error = new Error("TBA request failed: 404");
	error.status = 404;
	throw error;
}
