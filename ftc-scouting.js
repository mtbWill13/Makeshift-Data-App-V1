// FTC scouting: saving match and pit reports, compiling them into team stats for match
// strategy, and gathering every public FTC data source in one place.
//
//   Questions .......... ftc-game.js (the only file to edit for a new season)
//   Saved reports ...... ftc-store.js (SQLite, data/ftc.db)
//   Schedules/OPR ...... FTCScout (ftc.js), no key needed
//   Official + TOA ..... ftc-sources.js, optional keys in .env

import { createHmac, timingSafeEqual } from "crypto";
import { FTC_GAME, cleanAnswers, cleanMatchNumber, cleanTeam, fieldsOf, summarizeTeam } from "./ftc-game.js";
import { openFtcStore } from "./ftc-store.js";
import { createFtcSources, firstConfigured, ftcLinks, toaConfigured } from "./ftc-sources.js";

const MAX_SCOUT_NAME = 40;

/* Keeps names short and free of markup characters. */
function cleanScout(value) {
	const name = String(value ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, MAX_SCOUT_NAME);
	if (!name) throw new Error("Enter your name.");
	return name;
}

function cleanSubmissionId(value) {
	const id = String(value ?? "");
	return /^[A-Za-z0-9-]{8,64}$/.test(id) ? id : null;
}

const csvCell = value => `"${String(value ?? "").replaceAll('"', '""')}"`;

/* An answer as people read it: option labels instead of stored values. */
function readable(field, value) {
	if (value === undefined || value === null) return "";
	if (field.type === "yesno") return value === "yes" ? "Yes" : value === "no" ? "No" : "";
	const label = item => field.options?.find(option => option.value === item)?.label ?? item;
	if (field.type === "choice") return label(value);
	if (field.type === "multi") return (Array.isArray(value) ? value : [value]).map(label).join("; ");
	return value;
}

const sameKey = (given, expected) => {
	const digest = value => createHmac("sha256", "ftc").update(String(value)).digest();
	return Boolean(given) && timingSafeEqual(digest(given), digest(expected));
};

export function registerFtcScouting(app, ftc) {
	const { ftcscout, teamInfo, matchSummary, validSeason, validCode, cachedFetcher } = ftc;
	const sources = createFtcSources({ cachedFetcher });

	let store = null;
	try {
		store = openFtcStore(process.env.FTC_DB_FILE ?? new URL("./data/ftc.db", import.meta.url));
	} catch (error) {
		console.error("FTC scouting database unavailable (the rest of the site still works):", error.message);
	}

	const needStore = (req, res, next) => store ? next() : res.status(503).json({ error: "The FTC scouting database couldn't be opened on this server." });
	const eventCode = value => String(value ?? "").toUpperCase();
	const checkEvent = (req, res, next) => {
		if (!validSeason(req.params.season) || !validCode(req.params.event ?? req.params.code)) {
			return res.status(400).json({ error: "Invalid season or event code." });
		}
		next();
	};

	/* ----- what the forms ask ----- */

	app.get("/api/ftc/game", (req, res) => res.json(FTC_GAME));

	/* Which data sources this server can use right now. */
	app.get("/api/ftc/sources", (req, res) => res.json({
		ftcscout: { configured: true, note: "Schedules, rankings, OPR and score breakdowns. No key needed." },
		official: { configured: firstConfigured(), note: "FIRST's official FTC Events API. Set FTC_API_USER and FTC_API_KEY in .env." },
		toa: { configured: toaConfigured(), note: "The Orange Alliance. Set TOA_API_KEY in .env." },
		scouting: { configured: Boolean(store), note: "Our own match and pit reports (data/ftc.db)." }
	}));

	/* ----- schedule: FTCScout first, FIRST's official feed when FTCScout has nothing yet ----- */

	app.get("/api/ftc/schedule/:season/:code", checkEvent, async (req, res) => {
		const { season } = req.params;
		const code = eventCode(req.params.code);

		try {
			const matches = await ftcscout(`/events/${season}/${code}/matches`).catch(() => null);
			if (matches?.length) {
				return res.json({ source: "FTCScout", matches: matches.map(matchSummary).sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1] || a.order[2] - b.order[2]) });
			}

			if (firstConfigured()) {
				const official = await sources.schedule(season, code);
				if (official.length) return res.json({ source: "FIRST FTC Events API", matches: official });
			}

			res.json({ source: null, matches: [] });
		} catch (error) {
			res.status(502).json({ error: `Couldn't load the schedule: ${error.message}` });
		}
	});

	app.get("/api/ftc/official/:season/:code/rankings", checkEvent, async (req, res) => {
		if (!firstConfigured()) return res.status(404).json({ error: "FIRST's official API isn't set up on this server (FTC_API_USER / FTC_API_KEY)." });

		try {
			res.json(await sources.rankings(req.params.season, eventCode(req.params.code)));
		} catch (error) {
			res.status(502).json({ error: error.message });
		}
	});

	/* A team's details and where to read more about it, from every source that answers. */
	app.get("/api/ftc/team-links/:season/:number", async (req, res) => {
		const { season, number } = req.params;
		if (!validSeason(season) || !/^\d{1,6}$/.test(number)) return res.status(400).json({ error: "Invalid season or team number." });

		const [ftcscoutTeam, toaTeam] = await Promise.all([
			teamInfo(number).catch(() => null),
			toaConfigured() ? sources.toaTeam(number).catch(() => null) : null
		]);

		res.json({ team: ftcscoutTeam, toa: toaTeam, links: ftcLinks({ season, team: number }) });
	});

	if (!store) return;

	/* ----- saving reports ----- */

	/* The same checks for a match and a pit report; `kind` picks what differs. */
	function readReport(kind, body) {
		const season = String(body?.season ?? "");
		const event = eventCode(body?.event);
		if (!validSeason(season) || !validCode(event)) throw new Error("Pick an event first.");

		const report = {
			season, event,
			team: cleanTeam(body?.team),
			scout: cleanScout(body?.scout),
			flagged: body?.flagged === true,
			submissionId: cleanSubmissionId(body?.submissionId)
		};

		if (kind === "match") {
			report.matchNumber = cleanMatchNumber(body?.matchNumber);
			report.alliance = body?.alliance === "red" || body?.alliance === "blue" ? body.alliance : null;
			report.noShow = body?.noShow === "yes" ? "yes" : "no";
			/* A robot that never showed up has nothing else to report beyond notes. */
			report.data = cleanAnswers("match", report.noShow === "yes" ? { notes: body?.answers?.notes } : body?.answers);
		} else {
			report.data = cleanAnswers("pit", body?.answers);
		}

		return report;
	}

	app.post("/api/ftc/scouting/match", needStore, (req, res) => {
		try {
			const report = readReport("match", req.body);
			const already = store.hasMatchSubmission(report.submissionId);
			const earlier = !already && req.body?.confirmDuplicate !== true ? store.matchDuplicate(report.season, report.event, report.matchNumber, report.team) : null;

			if (earlier) {
				return res.status(409).json({
					error: `Team ${report.team} in match ${report.matchNumber} was already scouted by ${earlier.scout}.`,
					duplicate: { team: report.team, match: report.matchNumber, scout: earlier.scout }
				});
			}

			const saved = store.addMatch(report);
			res.status(saved.repeat ? 200 : 201).json({ ok: true, id: saved.id, repeat: saved.repeat });
		} catch (error) {
			res.status(400).json({ error: error.message });
		}
	});

	app.post("/api/ftc/scouting/pit", needStore, (req, res) => {
		try {
			const report = readReport("pit", req.body);
			const already = store.hasPitSubmission(report.submissionId);
			const earlier = !already && req.body?.confirmDuplicate !== true ? store.pitDuplicate(report.season, report.event, report.team) : null;

			if (earlier) {
				return res.status(409).json({
					error: `Team ${report.team} was already pit scouted by ${earlier.scout}.`,
					duplicate: { team: report.team, scout: earlier.scout }
				});
			}

			const saved = store.addPit(report);
			res.status(saved.repeat ? 200 : 201).json({ ok: true, id: saved.id, repeat: saved.repeat });
		} catch (error) {
			res.status(400).json({ error: error.message });
		}
	});

	/* ----- reading them back ----- */

	/* Every scouted team's stats at an event, in one go (the strategy board). */
	app.get("/api/ftc/scouting/:season/:event/summary", checkEvent, needStore, (req, res) => {
		const { season } = req.params;
		const event = eventCode(req.params.event);
		const matches = store.matchReports(season, event);
		const pits = store.pitReports(season, event);

		const teams = new Set([...matches.map(report => report.team), ...pits.map(report => report.team)]);
		const summary = {};
		for (const team of teams) {
			summary[team] = summarizeTeam(
				matches.filter(report => report.team === team),
				pits.find(report => report.team === team) ?? null
			);
		}

		res.json({ counts: store.counts(season, event), teams: summary });
	});

	app.get("/api/ftc/scouting/:season/:event/team/:team", checkEvent, needStore, (req, res) => {
		const { season } = req.params;
		const event = eventCode(req.params.event);
		const team = Number(req.params.team);
		if (!Number.isInteger(team)) return res.status(400).json({ error: "Invalid team number." });

		const matches = store.teamMatchReports(season, event, team);
		const pits = store.teamPitReports(season, event, team);
		const open = report => ({ id: report.id, scout: report.scout, flagged: report.flagged, createdAt: report.createdAt, matchNumber: report.matchNumber, alliance: report.alliance, noShow: report.noShow, data: report.data });

		res.json({
			summary: summarizeTeam(matches, pits[0] ?? null),
			matchReports: matches.map(open),
			pitReports: pits.map(open)
		});
	});

	/* A spreadsheet of every report, with the questions as column headings. */
	app.get("/api/ftc/scouting/:season/:event/export.csv", checkEvent, needStore, (req, res) => {
		const { season } = req.params;
		const event = eventCode(req.params.event);
		const kind = req.query.kind === "pit" ? "pit" : "match";
		const fields = fieldsOf(kind);
		/* "Autonomous: Pollen scored in the hive": auto and teleop share question wording. */
		const headings = new Map(FTC_GAME[kind].sections.flatMap(section => section.fields.map(field => [field.id, `${section.title}: ${field.label}`])));
		const reports = kind === "pit" ? store.pitReports(season, event) : store.matchReports(season, event);

		const head = [...(kind === "match" ? ["Match", "Alliance", "No show"] : []), "Team", "Scout", "Flagged", "Saved", ...fields.map(field => headings.get(field.id))];
		const rows = reports.map(report => [
			...(kind === "match" ? [report.matchNumber, report.alliance ?? "", report.noShow === "yes" ? "Yes" : "No"] : []),
			report.team, report.scout, report.flagged ? "Yes" : "", new Date(report.createdAt).toISOString(),
			...fields.map(field => readable(field, report.data[field.id]))
		]);

		res.set("Content-Type", "text/csv; charset=utf-8");
		res.set("Content-Disposition", `attachment; filename="ftc-${kind}-${season}-${event}.csv"`);
		res.send([head, ...rows].map(row => row.map(csvCell).join(",")).join("\n"));
	});

	/* Removing a mistaken report needs FTC_ADMIN_KEY (and is off until that is set in .env). */
	app.delete("/api/ftc/scouting/:kind/:id", needStore, (req, res) => {
		const key = process.env.FTC_ADMIN_KEY;
		if (!key) return res.status(403).json({ error: "Deleting reports is off: set FTC_ADMIN_KEY in .env." });
		if (!sameKey(req.get("x-admin-key"), key)) return res.status(403).json({ error: "Admin key needed." });
		if (req.params.kind !== "match" && req.params.kind !== "pit") return res.status(400).json({ error: "Unknown report type." });

		res.json({ ok: store.deleteReport(req.params.kind, Number(req.params.id)) });
	});
}
