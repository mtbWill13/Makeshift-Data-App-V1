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

	const statements = {
		addMatch: db.prepare("INSERT INTO match_reports (submission_id, season, event, match_number, team, alliance, scout, no_show, flagged, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
		addPit: db.prepare("INSERT INTO pit_reports (submission_id, season, event, team, scout, flagged, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
		matchBySubmission: db.prepare("SELECT id FROM match_reports WHERE submission_id = ?"),
		pitBySubmission: db.prepare("SELECT id FROM pit_reports WHERE submission_id = ?"),
		matchDuplicate: db.prepare("SELECT id, scout FROM match_reports WHERE season = ? AND event = ? AND match_number = ? AND team = ? LIMIT 1"),
		pitDuplicate: db.prepare("SELECT id, scout FROM pit_reports WHERE season = ? AND event = ? AND team = ? LIMIT 1"),
		matches: db.prepare("SELECT * FROM match_reports WHERE season = ? AND event = ? ORDER BY match_number, id"),
		pits: db.prepare("SELECT * FROM pit_reports WHERE season = ? AND event = ? ORDER BY id DESC"),
		teamMatches: db.prepare("SELECT * FROM match_reports WHERE season = ? AND event = ? AND team = ? ORDER BY match_number, id"),
		teamPits: db.prepare("SELECT * FROM pit_reports WHERE season = ? AND event = ? AND team = ? ORDER BY id DESC"),
		deleteMatch: db.prepare("DELETE FROM match_reports WHERE id = ?"),
		deletePit: db.prepare("DELETE FROM pit_reports WHERE id = ?"),
		counts: db.prepare("SELECT (SELECT COUNT(*) FROM match_reports WHERE season = ? AND event = ?) AS matches, (SELECT COUNT(*) FROM pit_reports WHERE season = ? AND event = ?) AS pits")
	};

	const openMatch = row => row && { ...row, flagged: Boolean(row.flagged), noShow: row.no_show, matchNumber: row.match_number, createdAt: row.created_at, data: JSON.parse(row.data) };
	const openPit = row => row && { ...row, flagged: Boolean(row.flagged), createdAt: row.created_at, data: JSON.parse(row.data) };

	return {
		/* Each add returns { id, repeat }. repeat means this exact upload was already saved. */
		addMatch(report) {
			const earlier = report.submissionId && statements.matchBySubmission.get(report.submissionId);
			if (earlier) return { id: earlier.id, repeat: true };
			const saved = statements.addMatch.run(report.submissionId ?? null, report.season, report.event, report.matchNumber, report.team, report.alliance ?? null, report.scout, report.noShow ?? "no", report.flagged ? 1 : 0, JSON.stringify(report.data), Date.now());
			return { id: Number(saved.lastInsertRowid), repeat: false };
		},

		addPit(report) {
			const earlier = report.submissionId && statements.pitBySubmission.get(report.submissionId);
			if (earlier) return { id: earlier.id, repeat: true };
			const saved = statements.addPit.run(report.submissionId ?? null, report.season, report.event, report.team, report.scout, report.flagged ? 1 : 0, JSON.stringify(report.data), Date.now());
			return { id: Number(saved.lastInsertRowid), repeat: false };
		},

		hasMatchSubmission: id => Boolean(id && statements.matchBySubmission.get(id)),
		hasPitSubmission: id => Boolean(id && statements.pitBySubmission.get(id)),

		matchDuplicate: (season, event, matchNumber, team) => statements.matchDuplicate.get(season, event, matchNumber, team) ?? null,
		pitDuplicate: (season, event, team) => statements.pitDuplicate.get(season, event, team) ?? null,

		matchReports: (season, event) => statements.matches.all(season, event).map(openMatch),
		pitReports: (season, event) => statements.pits.all(season, event).map(openPit),
		teamMatchReports: (season, event, team) => statements.teamMatches.all(season, event, team).map(openMatch),
		teamPitReports: (season, event, team) => statements.teamPits.all(season, event, team).map(openPit),

		deleteReport: (kind, id) => (kind === "pit" ? statements.deletePit : statements.deleteMatch).run(id).changes > 0,
		counts: (season, event) => statements.counts.get(season, event, season, event)
	};
}
