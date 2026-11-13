// Scouting bets
//
// A play-money game to get everyone scouting and learning the teams:
//   - A new player starts with 15 points.
//   - Every match report you scout earns points (pit reports earn a few too).
//   - Points can be bet on which alliance wins an upcoming match. Odds come from
//     OPR and EPA, so betting on a long shot pays more.
//
// Who is who: the team's own website signs people in with Google and passes the
// person's email to this site in a header (default "x-user-email"), together with
// a shared secret (BETS_PROXY_SECRET) so nobody else can pretend to be someone.
// Without BETS_PROXY_SECRET the header is ignored, and for now each browser is its
// own player (remembered by a cookie, name picked on the Scout Bets page). For
// testing as one fixed person on your own computer, set BETS_DEV_EMAIL instead.

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { WELCOME_POINTS } from "./points-store.js";
import { fakeEventEnabled, FAKE_BETS_CLOSE_BEFORE_MS, FAKE_EVENT_KEY, playFakeMatchNow } from "./fake-event.js";

export const MATCH_REPORT_POINTS = 5;
export const PIT_REPORT_POINTS = 3;
const MAX_OPEN_BETS = 5;
const MAX_STAKE = 1000;
const HOUSE_SHARE = 1;             // pays out the full fair price (lower it, e.g. 0.95, to make points slowly drain)
const BETS_CLOSE_BEFORE_MS = 2 * 60 * 1000;
const UPCOMING_SHOWN = 12;
const SETTLE_EVERY_MS = 3 * 60 * 1000;
const MIN_TEAMS_FOR_MODEL = 10;
const MIN_CALIBRATION_ALLIANCES = 10;
const MIN_SIGMA = 5;
const FALLBACK_SPREAD = 0.25;

const LEVEL_ORDER = { qm: 0, ef: 1, qf: 2, sf: 3, f: 4 };

/* ----- who is signed in ----- */

const digest = value => createHash("sha256").update(String(value)).digest();
const sameSecret = (given, expected) => Boolean(given) && timingSafeEqual(digest(given), digest(expected));

function cleanEmail(value) {
	const email = String(value ?? "").trim().toLowerCase();
	return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function cleanName(value, email) {
	const name = String(value ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40);
	if (name) return name;
	return email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

const PLAYER_COOKIE = "makeshift_player";
const PLAYER_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

function readCookie(req, name) {
	for (const part of String(req.headers.cookie ?? "").split(";")) {
		const index = part.indexOf("=");
		if (index !== -1 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
	}
	return null;
}

/* Who is playing. If the team's website passed a verified Google email (see the top of
   this file) that's who it is. Otherwise each browser is its own player, remembered by
   a cookie, until real sign-in is set up. Pass `res` so a new browser gets its cookie. */
export function betsUser(req, res = null) {
	const secret = process.env.BETS_PROXY_SECRET;
	let email = null;
	let name = null;

	if (secret) {
		if (sameSecret(req.get("x-proxy-secret"), secret)) {
			email = cleanEmail(req.get(process.env.BETS_USER_HEADER ?? "x-user-email"));
			name = req.get(process.env.BETS_USER_NAME_HEADER ?? "x-user-name");
		}
	} else if (process.env.BETS_DEV_EMAIL) {
		email = cleanEmail(process.env.BETS_DEV_EMAIL);
		name = process.env.BETS_DEV_NAME;
	}

	if (email) return { email, name: cleanName(name, email), anonymous: false };

	let id = readCookie(req, PLAYER_COOKIE);
	if (!/^[a-f0-9]{24}$/.test(id ?? "")) {
		if (!res) return null;
		id = randomBytes(12).toString("hex");
		const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
		res.append("Set-Cookie", `${PLAYER_COOKIE}=${id}; Path=/; Max-Age=${PLAYER_COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`);
	}

	return { email: `anon:${id}`, name: `Player ${id.slice(0, 4)}`, anonymous: true };
}

const DEFAULT_PLAYER_NAME = /^Player [a-f0-9]{4}$/;

/* ----- odds ----- */

function erf(x) {
	const sign = x < 0 ? -1 : 1;
	const t = 1 / (1 + 0.3275911 * Math.abs(x));
	const poly = ((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592;
	return sign * (1 - poly * t * Math.exp(-x * x));
}

const normalCdf = x => 0.5 * (1 + erf(x / Math.SQRT2));
const teamNumbers = alliance => (alliance?.team_keys ?? []).map(key => Number(String(key).replace(/^frc/, "")));
const isPlayed = match => Number(match.alliances?.red?.score) >= 0 && Number(match.alliances?.blue?.score) >= 0;
const codeOf = match => match.key.split("_")[1] ?? "";

function matchLabel(match) {
	const code = codeOf(match);
	const parsed = /^(qm|ef|qf|sf|f)(\d+)?(?:m(\d+))?$/.exec(code);
	if (!parsed) return code || "Match";
	const [, level, first, second] = parsed;
	if (level === "qm") return `Qualification ${first}`;
	const names = { ef: "Eighthfinal", qf: "Quarterfinal", sf: "Semifinal", f: "Final" };
	return level === "f" ? `Final ${second ?? first}` : `${names[level]} ${first} • Match ${second ?? 1}`;
}

const median = values => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};

/* Each source (OPR, EPA) is a Map of team -> points per match. */
function allianceScore(source, teams, typical) {
	let total = 0;
	for (const team of teams) {
		const value = source.get(team) ?? typical;
		if (!Number.isFinite(value)) return null;
		total += value;
	}
	return total;
}

/* Chance the red alliance wins, averaged over the sources that have enough teams. */
function redWinChance(sources, matches, red, blue) {
	const chances = [];

	for (const source of sources) {
		if (source.size < MIN_TEAMS_FOR_MODEL) continue;
		const typical = median([...source.values()]);
		const redScore = allianceScore(source, red, typical);
		const blueScore = allianceScore(source, blue, typical);
		if (redScore === null || blueScore === null) continue;

		/* How far off this source was on alliances that already played. */
		const errors = [];
		for (const match of matches) {
			if (!isPlayed(match) || !codeOf(match).startsWith("qm")) continue;
			for (const side of [match.alliances.red, match.alliances.blue]) {
				const predicted = allianceScore(source, teamNumbers(side), typical);
				if (predicted !== null) errors.push(side.score - predicted);
			}
		}
		const fitted = errors.length >= MIN_CALIBRATION_ALLIANCES
			? Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / errors.length)
			: null;
		const sigmaFor = score => Math.max(MIN_SIGMA, fitted ?? score * FALLBACK_SPREAD);
		const sigma = Math.sqrt(sigmaFor(redScore) ** 2 + sigmaFor(blueScore) ** 2);

		chances.push(normalCdf((redScore - blueScore) / sigma));
	}

	return chances.length ? chances.reduce((sum, chance) => sum + chance, 0) / chances.length : 0.5;
}

/* Payout per point staked for backing a side that wins with chance `p`. */
const multiplierFor = p => Math.round(Math.min(12, Math.max(1.05, HOUSE_SHARE / Math.max(p, 0.001))) * 100) / 100;

/* ----- the module ----- */

export function createBets({ store, tba, statbotics }) {
	/* One event's schedule and strengths, kept for a minute (TBA and Statbotics have their own caches). */
	const eventCache = new Map();

	async function loadEvent(eventKey) {
		const cached = eventCache.get(eventKey);
		const keepFor = fakeEventEnabled() && eventKey === FAKE_EVENT_KEY ? 5 * 1000 : 60 * 1000;   // the test event moves fast
		if (cached && Date.now() - cached.time < keepFor) return cached.data;

		const [matches, oprs, epas] = await Promise.all([
			tba(`/event/${eventKey}/matches`),
			tba(`/event/${eventKey}/oprs`).catch(() => null),
			statbotics(`/team_events?${new URLSearchParams({ event: eventKey, limit: "1000" })}`).catch(() => [])
		]);

		const opr = new Map(Object.entries(oprs?.oprs ?? {})
			.map(([key, value]) => [Number(key.replace(/^frc/, "")), Number(value)])
			.filter(([, value]) => Number.isFinite(value)));
		const epa = new Map((Array.isArray(epas) ? epas : [])
			.map(row => [Number(row.team), Number(row.epa?.total_points?.mean ?? row.epa?.total_points)])
			.filter(([team, value]) => team && Number.isFinite(value)));

		const data = { matches: Array.isArray(matches) ? matches : [], sources: [opr, epa] };
		eventCache.set(eventKey, { time: Date.now(), data });
		return data;
	}

	function oddsFor(event, match) {
		const red = redWinChance(event.sources, event.matches, teamNumbers(match.alliances.red), teamNumbers(match.alliances.blue));
		return {
			red: { chance: red, multiplier: multiplierFor(red) },
			blue: { chance: 1 - red, multiplier: multiplierFor(1 - red) }
		};
	}

	const closesAt = match => {
		const seconds = match.predicted_time ?? match.time;
		/* The test event runs a match a minute, so its betting window is short too. */
		const before = fakeEventEnabled() && match.key.startsWith(`${FAKE_EVENT_KEY}_`) ? FAKE_BETS_CLOSE_BEFORE_MS : BETS_CLOSE_BEFORE_MS;
		return seconds ? seconds * 1000 - before : null;
	};

	const isOpen = match => !isPlayed(match) && !match.actual_time && (closesAt(match) === null || Date.now() < closesAt(match));

	/* Pays out any bet whose match has been scored. */
	async function settleEvent(eventKey) {
		try {
			const { matches } = await loadEvent(eventKey);
			const results = new Map();

			for (const match of matches) {
				if (!isPlayed(match)) continue;
				const { red, blue } = match.alliances;
				results.set(match.key, red.score > blue.score ? "red" : blue.score > red.score ? "blue" : "tie");
			}

			return store.settleBets(eventKey, results);
		} catch (error) {
			console.warn(`Bets: couldn't settle ${eventKey}:`, error.message);
			return 0;
		}
	}

	/* Pays points for a submitted report. Returns { earned, balance } or null (not paid). */
	async function awardScouting(req, res, { kind, eventKey, team, match, scouterName }) {
		const user = betsUser(req, res);
		if (!user || !team) return null;

		try {
			const account = store.signIn(user.email, user.name, user.anonymous);

			/* A browser still called "Player 1a2b" takes the name the scout typed on the form. */
			const typed = cleanName(scouterName, "player@x");
			if (user.anonymous && scouterName && DEFAULT_PLAYER_NAME.test(account.name) && typed !== "Player") store.rename(user.email, typed);

			/* A report for a robot that wasn't in that match earns nothing (when the schedule is known). */
			if (kind === "match" && match) {
				const found = await Promise.race([
					loadEvent(eventKey).then(event => event.matches.find(item => codeOf(item) === `qm${match}`) ?? null),
					new Promise(resolve => setTimeout(() => resolve(null), 2500))
				]).catch(() => null);

				if (found && ![...teamNumbers(found.alliances.red), ...teamNumbers(found.alliances.blue)].includes(Number(team))) return null;
			}

			const points = kind === "pit" ? PIT_REPORT_POINTS : MATCH_REPORT_POINTS;
			const ref = kind === "pit"
				? `scout:pit:${eventKey}:${team}:${user.email}`
				: `scout:${eventKey}:${match}:${team}:${user.email}`;
			const reason = kind === "pit" ? `Pit scouted team ${team}` : `Scouted team ${team} in match ${match}`;

			if (!store.award(user.email, points, reason, ref)) return null;
			return { earned: points, balance: store.user(user.email).points };
		} catch (error) {
			console.warn("Bets: couldn't award scouting points:", error.message);
			return null;
		}
	}

	function register(app) {
		const needUser = (req, res) => {
			const user = betsUser(req, res);
			if (!user) {
				res.status(403).json({ error: "Couldn't tell who you are. Allow cookies and try again." });
				return null;
			}
			store.signIn(user.email, user.name, user.anonymous);
			return user;
		};

		const ownsEvent = (req, eventKey) => (fakeEventEnabled() && eventKey === FAKE_EVENT_KEY) || (req.team.events ?? []).some(event => event.key === eventKey);

		app.get("/api/bets/me", (req, res) => {
			const user = needUser(req, res);
			if (!user) return;

			const account = store.user(user.email);
			res.json({
				user: { name: account.name, points: account.points, anonymous: user.anonymous },
				ledger: store.recentLedger(user.email),
				rules: { welcome: WELCOME_POINTS, matchReport: MATCH_REPORT_POINTS, pitReport: PIT_REPORT_POINTS, maxOpenBets: MAX_OPEN_BETS },
				fakeEvent: fakeEventEnabled() ? { key: FAKE_EVENT_KEY, name: "Fake test event" } : null
			});
		});

		/* Test event only: top up with free points so betting can be tried out. */
		app.post("/api/bets/fake/grant", (req, res) => {
			if (!fakeEventEnabled()) return res.status(404).json({ error: "Not available." });
			const user = needUser(req, res);
			if (!user) return;

			store.award(user.email, 20, "Free test points", `testgrant:${user.email}:${Date.now()}`);
			res.json({ ok: true, balance: store.user(user.email).points });
		});

		/* Test event only: play a match right now instead of waiting for its time, and pay out its bets. */
		app.post("/api/bets/fake/play", async (req, res) => {
			if (!fakeEventEnabled()) return res.status(404).json({ error: "Not available." });
			if (!needUser(req, res)) return;

			const number = Number(/^2026fake_qm(\d+)$/.exec(String(req.body?.matchKey ?? ""))?.[1]);
			if (!playFakeMatchNow(number)) return res.status(400).json({ error: "That isn't a test match." });

			eventCache.delete(FAKE_EVENT_KEY);
			const settled = await settleEvent(FAKE_EVENT_KEY);
			res.json({ ok: true, settled });
		});

		/* Test event only: put your points back to the starting amount and clear your bets on the
		   test event. The matches are left exactly as they are. */
		app.post("/api/bets/fake/reset-points", (req, res) => {
			if (!fakeEventEnabled()) return res.status(404).json({ error: "Not available." });
			const user = needUser(req, res);
			if (!user) return;

			const account = store.resetPoints(user.email, FAKE_EVENT_KEY);
			res.json({ ok: true, balance: account.points });
		});

		/* Without real sign-in a player picks their own display name. */
		app.post("/api/bets/name", (req, res) => {
			const user = needUser(req, res);
			if (!user) return;
			if (!user.anonymous) return res.status(400).json({ error: "Your name comes from your team's website sign-in." });

			const name = cleanName(req.body?.name, "player@x");
			if (!String(req.body?.name ?? "").trim() || name === "Player") return res.status(400).json({ error: "Enter a name." });

			store.rename(user.email, name);
			res.json({ ok: true, name });
		});

		/* The next matches to bet on, each with odds and the caller's own bet. */
		app.get("/api/bets/:eventKey/matches", async (req, res) => {
			const user = needUser(req, res);
			if (!user) return;

			try {
				const { eventKey } = req.params;
				await settleEvent(eventKey);
				const event = await loadEvent(eventKey);

				/* Only matches that can still be bet on: once betting closes or the match is played, it leaves the list. */
				const upcoming = event.matches
					.filter(match => isOpen(match))
					.sort((a, b) => (LEVEL_ORDER[a.comp_level] ?? 9) - (LEVEL_ORDER[b.comp_level] ?? 9) || a.set_number - b.set_number || a.match_number - b.match_number)
					.slice(0, UPCOMING_SHOWN);

				res.json({
					matches: upcoming.map(match => ({
						key: match.key,
						label: matchLabel(match),
						code: codeOf(match),
						red: teamNumbers(match.alliances.red),
						blue: teamNumbers(match.alliances.blue),
						time: (match.predicted_time ?? match.time ?? 0) * 1000 || null,
						closesAt: closesAt(match),
						open: isOpen(match),
						/* The odds are deliberately not sent: scouts have to know the teams. The payout is
						   worked out (and shown) when the bet is placed. */
						myBet: store.bet(user.email, match.key)
					}))
				});
			} catch (error) {
				res.status(error.message.includes("404") ? 404 : 502).json({ error: error.message.includes("404") ? "The Blue Alliance has no schedule for this event yet." : "Couldn't load the match schedule. Try again in a moment." });
			}
		});

		app.post("/api/bets/:eventKey/bet", async (req, res) => {
			const user = needUser(req, res);
			if (!user) return;

			const { eventKey } = req.params;
			const { matchKey, pick } = req.body ?? {};
			const stake = Number(req.body?.stake);

			if (!ownsEvent(req, eventKey)) return res.status(404).json({ error: "That event isn't one of your team's events." });
			if (pick !== "red" && pick !== "blue") return res.status(400).json({ error: "Pick the red or the blue alliance." });
			if (!Number.isInteger(stake) || stake < 1 || stake > MAX_STAKE) return res.status(400).json({ error: "Bet a whole number of points, at least 1." });

			try {
				const event = await loadEvent(eventKey);
				const match = event.matches.find(item => item.key === matchKey && item.key.startsWith(`${eventKey}_`));
				if (!match) return res.status(404).json({ error: "That match isn't on the schedule." });
				if (!isOpen(match)) return res.status(409).json({ error: "Betting on this match has closed." });

				/* Odds are recomputed here: the page's numbers are never trusted. */
				const odds = oddsFor(event, match)[pick];
				const account = store.placeBet({
					email: user.email, event: eventKey, matchKey, label: matchLabel(match), pick, stake,
					multiplier: odds.multiplier, maxOpen: MAX_OPEN_BETS
				});

				res.status(201).json({ ok: true, balance: account.points, multiplier: odds.multiplier });
			} catch (error) {
				res.status(400).json({ error: error.message });
			}
		});

		app.get("/api/bets/mine", async (req, res) => {
			const user = needUser(req, res);
			if (!user) return;

			await Promise.all(store.openBetEvents().map(settleEvent));
			res.json({ bets: store.myBets(user.email), balance: store.user(user.email).points });
		});

		app.get("/api/bets/leaderboard", (req, res) => {
			const user = needUser(req, res);
			if (!user) return;
			res.json({ players: store.leaderboard(20).map(({ email, ...player }) => ({ ...player, isYou: email === user.email })) });
		});
	}

	/* Settle in the background too, so balances are right when someone opens the page. */
	function startSettling() {
		setInterval(() => {
			for (const eventKey of store.openBetEvents()) settleEvent(eventKey);
		}, fakeEventEnabled() ? 15 * 1000 : SETTLE_EVERY_MS).unref();
	}

	return { register, awardScouting, startSettling, settleEvent };
}
