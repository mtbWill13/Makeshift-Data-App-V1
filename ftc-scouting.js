// FTC scouting: saving match and pit reports, compiling them into team stats for match
// strategy, and gathering every public FTC data source in one place.
//
//   Questions .......... ftc-game.js (the only file to edit for a new season)
//   Saved reports ...... ftc-store.js (SQLite, data/ftc.db)
//   Schedules/OPR ...... FTCScout (ftc.js), no key needed
//   Official + TOA ..... ftc-sources.js, optional keys in .env

import { createHmac, timingSafeEqual } from "crypto";
import { FTC_GAME, cleanAnswers, cleanMatchNumber, cleanTeam, reportCells, reportHeadings, summarizeTeam } from "./ftc-game.js";
import { openFtcStore } from "./ftc-store.js";
import { createFtcSources, firstConfigured, ftcLinks, toaConfigured } from "./ftc-sources.js";
import { createFtcSheets, sheetIdFor } from "./ftc-sheets.js";

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

const sameKey = (given, expected) => {
	const digest = value => createHmac("sha256", "ftc").update(String(value)).digest();
	return Boolean(given) && timingSafeEqual(digest(given), digest(expected));
};

export function registerFtcScouting(app, ftc) {
	const { ftcscout, teamInfo, eventInfo, eventStats, matchSummary, validSeason, validCode, cachedFetcher, mapLimit, sheets } = ftc;
	const sources = createFtcSources({ cachedFetcher });
	const ftcSheets = sheets ? createFtcSheets({ sheets }) : null;

	let store = null;
	try {
		store = openFtcStore(process.env.FTC_DB_FILE ?? new URL("./data/ftc.db", import.meta.url));
	} catch (error) {
		console.error("FTC scouting database unavailable (the rest of the site still works):", error.message);
	}

	/* Whose reports: the logged-in team's number (every page here is behind the team login). */
	const ownerOf = req => String(req.team?.number ?? "");
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

	/* ----- the event's Google Sheet ----- */

	/* A saved report also goes into the event's sheet, if one is linked. Never holds up the report:
	   it is already safe in the database, and "sync" can rewrite the sheet from it. */
	function mirrorToSheet(req, kind, report) {
		/* The sheet links come from .env, so they belong to the original team (the legacy account). */
		const id = ftcSheets && req.team?.legacy && sheetIdFor(report.season, report.event);
		if (!id) return;
		ftcSheets.appendReport(id, kind, { ...report, createdAt: Date.now() }).catch(error => console.warn(`FTC sheet (${report.event}): couldn't add the report: ${error.message}`));
	}

	app.get("/api/ftc/sheet/:season/:event", checkEvent, (req, res) => {
		const id = req.team?.legacy ? sheetIdFor(req.params.season, req.params.event) : null;
		res.json({ linked: Boolean(id), url: id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : null });
	});

	/* Rewrites the sheet from the database and FTCScout (also makes any missing tabs). */
	const lastSync = new Map();
	app.post("/api/ftc/sheet/:season/:event/sync", checkEvent, needStore, async (req, res) => {
		const { season } = req.params;
		const code = eventCode(req.params.event);
		const id = req.team?.legacy ? sheetIdFor(season, code) : null;

		if (!ftcSheets || !id) return res.status(404).json({ error: `No Google Sheet is linked to ${code} yet. Add FTC_SHEET_${season}_${code} to .env.` });
		if (Date.now() - (lastSync.get(id) ?? 0) < 10 * 1000) return res.status(429).json({ error: "Synced a moment ago. Give it 10 seconds." });
		lastSync.set(id, Date.now());

		try {
			const [event, teamEntries, schedule] = await Promise.all([
				eventInfo(season, code),
				ftcscout(`/events/${season}/${code}/teams`).catch(() => []),
				ftcscout(`/events/${season}/${code}/matches`).catch(() => [])
			]);

			const teams = await mapLimit(teamEntries ?? [], 8, async entry => ({ ...await teamInfo(entry.teamNumber), stats: eventStats(entry.stats) }));
			const summary = await ftcSheets.syncAll(id, {
				event: { ...event, season, code },
				matchReports: store.matchReports(ownerOf(req), season, code),
				pitReports: store.pitReports(ownerOf(req), season, code),
				teams,
				schedule: (schedule ?? []).map(matchSummary).sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1] || a.order[2] - b.order[2])
			});

			res.json({ ok: true, ...summary, url: `https://docs.google.com/spreadsheets/d/${id}/edit` });
		} catch (error) {
			lastSync.delete(id);
			res.status(502).json({ error: `Couldn't write to the sheet: ${error.message}. Is it shared with the service account as an Editor?` });
		}
	});

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
			const already = store.hasMatchSubmission(ownerOf(req), report.submissionId);
			const earlier = !already && req.body?.confirmDuplicate !== true ? store.matchDuplicate(ownerOf(req), report.season, report.event, report.matchNumber, report.team) : null;

			if (earlier) {
				return res.status(409).json({
					error: `Team ${report.team} in match ${report.matchNumber} was already scouted by ${earlier.scout}.`,
					duplicate: { team: report.team, match: report.matchNumber, scout: earlier.scout }
				});
			}

			const saved = store.addMatch(ownerOf(req), report);
			if (!saved.repeat) mirrorToSheet(req, "match", report);
			res.status(saved.repeat ? 200 : 201).json({ ok: true, id: saved.id, repeat: saved.repeat });
		} catch (error) {
			res.status(400).json({ error: error.message });
		}
	});

	app.post("/api/ftc/scouting/pit", needStore, (req, res) => {
		try {
			const report = readReport("pit", req.body);
			const already = store.hasPitSubmission(ownerOf(req), report.submissionId);
			const earlier = !already && req.body?.confirmDuplicate !== true ? store.pitDuplicate(ownerOf(req), report.season, report.event, report.team) : null;

			if (earlier) {
				return res.status(409).json({
					error: `Team ${report.team} was already pit scouted by ${earlier.scout}.`,
					duplicate: { team: report.team, scout: earlier.scout }
				});
			}

			const saved = store.addPit(ownerOf(req), report);
			if (!saved.repeat) mirrorToSheet(req, "pit", report);
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
		const matches = store.matchReports(ownerOf(req), season, event);
		const pits = store.pitReports(ownerOf(req), season, event);

		const teams = new Set([...matches.map(report => report.team), ...pits.map(report => report.team)]);
		const summary = {};
		for (const team of teams) {
			summary[team] = summarizeTeam(
				matches.filter(report => report.team === team),
				pits.find(report => report.team === team) ?? null
			);
		}

		res.json({ counts: store.counts(ownerOf(req), season, event), teams: summary });
	});

	/* Every match report (and each team's latest pit answers), for the overview's graphs. */
	app.get("/api/ftc/scouting/:season/:event/reports", checkEvent, needStore, (req, res) => {
		const { season } = req.params;
		const event = eventCode(req.params.event);

		res.json({
			match: store.matchReports(ownerOf(req), season, event).map(report => ({ team: report.team, matchNumber: report.matchNumber, alliance: report.alliance, noShow: report.noShow, flagged: report.flagged, scout: report.scout, data: report.data })),
			pit: store.pitReports(ownerOf(req), season, event).map(report => ({ team: report.team, scout: report.scout, data: report.data }))
		});
	});

	app.get("/api/ftc/scouting/:season/:event/team/:team", checkEvent, needStore, (req, res) => {
		const { season } = req.params;
		const event = eventCode(req.params.event);
		const team = Number(req.params.team);
		if (!Number.isInteger(team)) return res.status(400).json({ error: "Invalid team number." });

		const matches = store.teamMatchReports(ownerOf(req), season, event, team);
		const pits = store.teamPitReports(ownerOf(req), season, event, team);
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
		const reports = kind === "pit" ? store.pitReports(ownerOf(req), season, event) : store.matchReports(ownerOf(req), season, event);
		const head = reportHeadings(kind);
		const rows = reports.map(report => reportCells(kind, report));

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

		res.json({ ok: store.deleteReport(ownerOf(req), req.params.kind, Number(req.params.id)) });
	});
}
