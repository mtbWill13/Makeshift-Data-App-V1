// FTC scouting database
//
// Every FTC match and pit report lives in one SQLite file (data/ftc.db). The questions
// themselves are not columns: each report keeps its answers as JSON, so changing the
// game definition (ftc-game.js) never needs a database change.

import { mkdirSync } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { DatabaseSync } from "node:sqlite";

export function openFtcStore(file) {
	const filePath = file instanceof URL ? fileURLToPath(file) : file;
	mkdirSync(dirname(filePath), { recursive: true });

	const db = new DatabaseSync(filePath);
	db.exec(`
		PRAGMA journal_mode = WAL;
		CREATE TABLE IF NOT EXISTS match_reports (
			id            INTEGER PRIMARY KEY AUTOINCREMENT,
			submission_id TEXT UNIQUE,          -- a retried upload never saves twice
			owner         TEXT NOT NULL DEFAULT '',   -- the team account the report belongs to
			season        TEXT NOT NULL,
			event         TEXT NOT NULL,
			match_number  INTEGER NOT NULL,
			team          INTEGER NOT NULL,
			alliance      TEXT,                 -- 'red' | 'blue'
			scout         TEXT NOT NULL,
			no_show       TEXT NOT NULL DEFAULT 'no',
			flagged       INTEGER NOT NULL DEFAULT 0,
			data          TEXT NOT NULL,
			created_at    INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS match_event ON match_reports (season, event, team);
		CREATE TABLE IF NOT EXISTS pit_reports (
			id            INTEGER PRIMARY KEY AUTOINCREMENT,
			submission_id TEXT UNIQUE,
			owner         TEXT NOT NULL DEFAULT '',
			season        TEXT NOT NULL,
			event         TEXT NOT NULL,
			team          INTEGER NOT NULL,
			scout         TEXT NOT NULL,
			flagged       INTEGER NOT NULL DEFAULT 0,
			data          TEXT NOT NULL,
			created_at    INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS pit_event ON pit_reports (season, event, team);
	`);

	/* A database made before team accounts has no owner column: add it, and give those reports to
	   the original team (MakeShift 4039), which is who was using the site then. */
	for (const table of ["match_reports", "pit_reports"]) {
		if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === "owner")) {
			db.exec(`ALTER TABLE ${table} ADD COLUMN owner TEXT NOT NULL DEFAULT ''`);
			db.exec(`UPDATE ${table} SET owner = '4039'`);
		}
	}
	/* Reports made while the form asked "shot" and "scored" are changed to "scored" and "missed"
	   (missed = shot - scored), once. */
	if (db.prepare("PRAGMA user_version").get().user_version < 1) {
		const update = db.prepare("UPDATE match_reports SET data = ? WHERE id = ?");
		for (const row of db.prepare("SELECT id, data FROM match_reports").all()) {
			const data = JSON.parse(row.data);
			let changed = false;
			for (const key of Object.keys(data)) {
				if (!key.endsWith("Shot")) continue;
				const base = key.slice(0, -4);
				data[`${base}Missed`] = Math.max(0, Number(data[key]) - (Number(data[`${base}Scored`]) || 0));
				delete data[key];
				changed = true;
			}
			if (changed) update.run(JSON.stringify(data), row.id);
		}
		db.exec("PRAGMA user_version = 1");
	}
	db.exec("CREATE INDEX IF NOT EXISTS match_owner ON match_reports (owner, season, event); CREATE INDEX IF NOT EXISTS pit_owner ON pit_reports (owner, season, event);");

	const statements = {
		addMatch: db.prepare("INSERT INTO match_reports (submission_id, owner, season, event, match_number, team, alliance, scout, no_show, flagged, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
		addPit: db.prepare("INSERT INTO pit_reports (submission_id, owner, season, event, team, scout, flagged, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"),
		matchBySubmission: db.prepare("SELECT id FROM match_reports WHERE owner = ? AND submission_id = ?"),
		pitBySubmission: db.prepare("SELECT id FROM pit_reports WHERE owner = ? AND submission_id = ?"),
		matchDuplicate: db.prepare("SELECT id, scout FROM match_reports WHERE owner = ? AND season = ? AND event = ? AND match_number = ? AND team = ? LIMIT 1"),
		pitDuplicate: db.prepare("SELECT id, scout FROM pit_reports WHERE owner = ? AND season = ? AND event = ? AND team = ? LIMIT 1"),
		matches: db.prepare("SELECT * FROM match_reports WHERE owner = ? AND season = ? AND event = ? ORDER BY match_number, id"),
		pits: db.prepare("SELECT * FROM pit_reports WHERE owner = ? AND season = ? AND event = ? ORDER BY id DESC"),
		teamMatches: db.prepare("SELECT * FROM match_reports WHERE owner = ? AND season = ? AND event = ? AND team = ? ORDER BY match_number, id"),
		teamPits: db.prepare("SELECT * FROM pit_reports WHERE owner = ? AND season = ? AND event = ? AND team = ? ORDER BY id DESC"),
		deleteMatch: db.prepare("DELETE FROM match_reports WHERE owner = ? AND id = ?"),
		deletePit: db.prepare("DELETE FROM pit_reports WHERE owner = ? AND id = ?"),
		counts: db.prepare("SELECT (SELECT COUNT(*) FROM match_reports WHERE owner = ? AND season = ? AND event = ?) AS matches, (SELECT COUNT(*) FROM pit_reports WHERE owner = ? AND season = ? AND event = ?) AS pits")
	};

	const openMatch = row => row && { ...row, flagged: Boolean(row.flagged), noShow: row.no_show, matchNumber: row.match_number, createdAt: row.created_at, data: JSON.parse(row.data) };
	const openPit = row => row && { ...row, flagged: Boolean(row.flagged), createdAt: row.created_at, data: JSON.parse(row.data) };

	/* Every method takes the owner (the logged-in team's number) first: one team never sees another's reports. */
	return {
		/* Each add returns { id, repeat }. repeat means this exact upload was already saved. */
		addMatch(owner, report) {
			const earlier = report.submissionId && statements.matchBySubmission.get(owner, report.submissionId);
			if (earlier) return { id: earlier.id, repeat: true };
			const saved = statements.addMatch.run(report.submissionId ?? null, owner, report.season, report.event, report.matchNumber, report.team, report.alliance ?? null, report.scout, report.noShow ?? "no", report.flagged ? 1 : 0, JSON.stringify(report.data), Date.now());
			return { id: Number(saved.lastInsertRowid), repeat: false };
		},

		addPit(owner, report) {
			const earlier = report.submissionId && statements.pitBySubmission.get(owner, report.submissionId);
			if (earlier) return { id: earlier.id, repeat: true };
			const saved = statements.addPit.run(report.submissionId ?? null, owner, report.season, report.event, report.team, report.scout, report.flagged ? 1 : 0, JSON.stringify(report.data), Date.now());
			return { id: Number(saved.lastInsertRowid), repeat: false };
		},

		hasMatchSubmission: (owner, id) => Boolean(id && statements.matchBySubmission.get(owner, id)),
		hasPitSubmission: (owner, id) => Boolean(id && statements.pitBySubmission.get(owner, id)),

		matchDuplicate: (owner, season, event, matchNumber, team) => statements.matchDuplicate.get(owner, season, event, matchNumber, team) ?? null,
		pitDuplicate: (owner, season, event, team) => statements.pitDuplicate.get(owner, season, event, team) ?? null,

		matchReports: (owner, season, event) => statements.matches.all(owner, season, event).map(openMatch),
		pitReports: (owner, season, event) => statements.pits.all(owner, season, event).map(openPit),
		teamMatchReports: (owner, season, event, team) => statements.teamMatches.all(owner, season, event, team).map(openMatch),
		teamPitReports: (owner, season, event, team) => statements.teamPits.all(owner, season, event, team).map(openPit),

		deleteReport: (owner, kind, id) => (kind === "pit" ? statements.deletePit : statements.deleteMatch).run(owner, id).changes > 0,
		counts: (owner, season, event) => statements.counts.get(owner, season, event, owner, season, event)
	};
}
