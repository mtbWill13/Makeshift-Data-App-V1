// Live picklist voting and per-team comments
//
// Everyone on a team's account sees the same votes (thumbs up / down on each team) and comments,
// for both the FRC and FTC picklists. A "board" is one picklist event, e.g. "2026oncmp2" or
// "ftc-2026-caonscq", kept separately for each team account. The pages poll /votes every few
// seconds with the version they already have, so an unchanged board costs almost nothing.
//
// There are no per-person accounts: each browser makes up a random voter id and remembers the name
// typed for it, so one device = one vote per team.

import { mkdirSync } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { DatabaseSync } from "node:sqlite";

const MAX_COMMENT = 300;
const MAX_COMMENTS_PER_TEAM = 100;

const cleanText = (value, max) => String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/g, "").trim().slice(0, max);

export function openVoteStore(file) {
	const filePath = file instanceof URL ? fileURLToPath(file) : file;
	mkdirSync(dirname(filePath), { recursive: true });
	const db = new DatabaseSync(filePath);

	db.exec(`
		PRAGMA journal_mode = WAL;
		CREATE TABLE IF NOT EXISTS votes (
			owner TEXT NOT NULL, board TEXT NOT NULL, team TEXT NOT NULL, voter TEXT NOT NULL,
			name TEXT NOT NULL, vote INTEGER NOT NULL, updated_at INTEGER NOT NULL,
			PRIMARY KEY (owner, board, team, voter)
		);
		CREATE TABLE IF NOT EXISTS comments (
			id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, board TEXT NOT NULL, team TEXT NOT NULL,
			voter TEXT NOT NULL, name TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS comments_board ON comments (owner, board, team);
		CREATE TABLE IF NOT EXISTS versions (owner TEXT NOT NULL, board TEXT NOT NULL, version INTEGER NOT NULL, PRIMARY KEY (owner, board));
	`);

	const q = {
		version: db.prepare("SELECT version FROM versions WHERE owner = ? AND board = ?"),
		bump: db.prepare("INSERT INTO versions (owner, board, version) VALUES (?, ?, 1) ON CONFLICT (owner, board) DO UPDATE SET version = version + 1"),
		votes: db.prepare("SELECT team, voter, name, vote FROM votes WHERE owner = ? AND board = ? AND vote != 0 ORDER BY updated_at"),
		comments: db.prepare("SELECT id, team, voter, name, body, created_at FROM comments WHERE owner = ? AND board = ? ORDER BY id"),
		setVote: db.prepare("INSERT INTO votes (owner, board, team, voter, name, vote, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (owner, board, team, voter) DO UPDATE SET name = excluded.name, vote = excluded.vote, updated_at = excluded.updated_at"),
		addComment: db.prepare("INSERT INTO comments (owner, board, team, voter, name, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"),
		commentCount: db.prepare("SELECT COUNT(*) AS n FROM comments WHERE owner = ? AND board = ? AND team = ?"),
		deleteComment: db.prepare("DELETE FROM comments WHERE owner = ? AND board = ? AND id = ? AND voter = ?")
	};

	const version = (owner, board) => q.version.get(owner, board)?.version ?? 0;

	return {
		version,

		/* Everything on the board, grouped by team. */
		snapshot(owner, board) {
			const teams = {};
			const entry = team => (teams[team] ??= { up: [], down: [], comments: [] });

			for (const row of q.votes.all(owner, board)) entry(row.team)[row.vote > 0 ? "up" : "down"].push({ voter: row.voter, name: row.name });
			for (const row of q.comments.all(owner, board)) entry(row.team).comments.push({ id: row.id, voter: row.voter, name: row.name, text: row.body, at: row.created_at });
			return { version: version(owner, board), teams };
		},

		vote(owner, board, { team, voter, name, vote }) {
			q.setVote.run(owner, board, team, voter, name, vote, Date.now());
			q.bump.run(owner, board);
		},

		comment(owner, board, { team, voter, name, text }) {
			if (q.commentCount.get(owner, board, team).n >= MAX_COMMENTS_PER_TEAM) throw new Error("That team has the most comments it can hold.");
			q.addComment.run(owner, board, team, voter, name, text, Date.now());
			q.bump.run(owner, board);
		},

		deleteComment(owner, board, id, voter) {
			const removed = q.deleteComment.run(owner, board, id, voter).changes > 0;
			if (removed) q.bump.run(owner, board);
			return removed;
		}
	};
}

export function registerPicklistVotes(app) {
	let store = null;
	try {
		store = openVoteStore(process.env.VOTES_DB_FILE ?? new URL("./data/votes.db", import.meta.url));
	} catch (error) {
		console.warn(`Picklist voting is off (couldn't open data/votes.db): ${error.message}`);
	}

	const ownerOf = req => String(req.team?.number ?? "");
	const check = (req, res, next) => {
		if (!store) return res.status(503).json({ error: "Voting isn't available on this server." });
		const board = String(req.params.board ?? "").toLowerCase();
		if (!/^[a-z0-9][a-z0-9:_-]{1,59}$/.test(board)) return res.status(400).json({ error: "Invalid picklist." });
		req.board = board;
		next();
	};

	const person = body => {
		const voter = String(body?.voter ?? "");
		if (!/^[A-Za-z0-9-]{8,64}$/.test(voter)) throw new Error("Missing voter id.");
		const name = cleanText(body?.name, 30);
		if (!name) throw new Error("Enter your name first.");
		return { voter, name };
	};

	const teamOf = body => {
		const team = String(body?.team ?? "").trim();
		if (!/^[0-9A-Za-z]{1,8}$/.test(team)) throw new Error("Invalid team.");
		return team;
	};

	app.get("/api/picklist/:board/votes", check, (req, res) => {
		const current = store.version(ownerOf(req), req.board);
		if (String(req.query.since ?? "") === String(current)) return res.json({ version: current, changed: false });
		res.json({ ...store.snapshot(ownerOf(req), req.board), changed: true });
	});

	app.post("/api/picklist/:board/vote", check, (req, res) => {
		try {
			const vote = Number(req.body?.vote);
			if (![-1, 0, 1].includes(vote)) throw new Error("Invalid vote.");
			store.vote(ownerOf(req), req.board, { team: teamOf(req.body), ...person(req.body), vote });
			res.json({ ok: true, ...store.snapshot(ownerOf(req), req.board), changed: true });
		} catch (error) {
			res.status(400).json({ error: error.message });
		}
	});

	app.post("/api/picklist/:board/comment", check, (req, res) => {
		try {
			const text = cleanText(req.body?.text, MAX_COMMENT);
			if (!text) throw new Error("Write a comment first.");
			store.comment(ownerOf(req), req.board, { team: teamOf(req.body), ...person(req.body), text });
			res.status(201).json({ ok: true, ...store.snapshot(ownerOf(req), req.board), changed: true });
		} catch (error) {
			res.status(400).json({ error: error.message });
		}
	});

	app.delete("/api/picklist/:board/comment/:id", check, (req, res) => {
		const voter = String(req.query.voter ?? "");
		if (!store.deleteComment(ownerOf(req), req.board, Number(req.params.id), voter)) return res.status(404).json({ error: "You can only delete your own comments." });
		res.json({ ok: true, ...store.snapshot(ownerOf(req), req.board), changed: true });
	});
}
