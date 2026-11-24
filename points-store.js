// Points database
//
// Play-money "points" for the scouting bets game: each person (identified by the
// email their team's website signs them in with) has a balance, a ledger of every
// change to it, and their bets. Everything lives in one SQLite file
// (data/points.db), written in transactions so a balance can never go wrong
// halfway through a bet or a payout.

import { mkdirSync } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { DatabaseSync } from "node:sqlite";

export const WELCOME_POINTS = 15;

export function openPointsStore(file) {
	const filePath = file instanceof URL ? fileURLToPath(file) : file;
	mkdirSync(dirname(filePath), { recursive: true });

	const db = new DatabaseSync(filePath);
	db.exec(`
		PRAGMA journal_mode = WAL;
		CREATE TABLE IF NOT EXISTS users (
			email      TEXT PRIMARY KEY,
			name       TEXT NOT NULL,
			points     INTEGER NOT NULL,
			created_at INTEGER NOT NULL,
			last_seen  INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS ledger (
			id     INTEGER PRIMARY KEY AUTOINCREMENT,
			email  TEXT NOT NULL,
			delta  INTEGER NOT NULL,
			reason TEXT NOT NULL,
			ref    TEXT UNIQUE,            -- a reason like "scouted match 12" can only pay once
			at     INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS ledger_email ON ledger (email, id DESC);
		CREATE TABLE IF NOT EXISTS bets (
			id         INTEGER PRIMARY KEY AUTOINCREMENT,
			email      TEXT NOT NULL,
			event      TEXT NOT NULL,
			match_key  TEXT NOT NULL,
			label      TEXT NOT NULL,
			pick       TEXT NOT NULL,       -- 'red' | 'blue'
			stake      INTEGER NOT NULL,
			multiplier REAL NOT NULL,       -- locked in when the bet is placed
			status     TEXT NOT NULL,       -- 'open' | 'won' | 'lost' | 'refunded'
			payout     INTEGER NOT NULL DEFAULT 0,
			placed_at  INTEGER NOT NULL,
			settled_at INTEGER,
			UNIQUE (email, match_key)       -- one bet per person per match
		);
		CREATE INDEX IF NOT EXISTS bets_status ON bets (status, event);
	`);

	const statements = {
		user: db.prepare("SELECT email, name, points, created_at AS createdAt FROM users WHERE email = ?"),
		addUser: db.prepare("INSERT INTO users (email, name, points, created_at, last_seen) VALUES (?, ?, ?, ?, ?)"),
		touch: db.prepare("UPDATE users SET name = ?, last_seen = ? WHERE email = ?"),
		addPoints: db.prepare("UPDATE users SET points = points + ? WHERE email = ?"),
		ledger: db.prepare("INSERT OR IGNORE INTO ledger (email, delta, reason, ref, at) VALUES (?, ?, ?, ?, ?)"),
		recentLedger: db.prepare("SELECT delta, reason, at FROM ledger WHERE email = ? ORDER BY id DESC LIMIT ?"),
		leaderboard: db.prepare(`
			SELECT u.email, u.name, u.points,
				(SELECT COUNT(*) FROM ledger l WHERE l.email = u.email AND l.ref LIKE 'scout:%') AS reports,
				(SELECT COUNT(*) FROM bets b WHERE b.email = u.email AND b.status = 'won') AS wins,
				(SELECT COUNT(*) FROM bets b WHERE b.email = u.email AND b.status IN ('won', 'lost')) AS decided
			FROM users u ORDER BY u.points DESC, u.created_at ASC LIMIT ?`),
		bet: db.prepare("SELECT * FROM bets WHERE email = ? AND match_key = ?"),
		addBet: db.prepare("INSERT INTO bets (email, event, match_key, label, pick, stake, multiplier, status, placed_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)"),
		openCount: db.prepare("SELECT COUNT(*) AS total FROM bets WHERE email = ? AND status = 'open'"),
		openBets: db.prepare("SELECT * FROM bets WHERE status = 'open' AND event = ?"),
		openEvents: db.prepare("SELECT DISTINCT event FROM bets WHERE status = 'open'"),
		settle: db.prepare("UPDATE bets SET status = ?, payout = ?, settled_at = ? WHERE id = ? AND status = 'open'"),
		myBets: db.prepare("SELECT * FROM bets WHERE email = ? ORDER BY id DESC LIMIT ?"),
		betsOn: db.prepare("SELECT id, match_key FROM bets WHERE email = ? AND event = ?"),
		deleteBets: db.prepare("DELETE FROM bets WHERE email = ? AND event = ?"),
		deleteLedger: db.prepare("DELETE FROM ledger WHERE ref = ?"),
		eventBets: db.prepare("SELECT email, match_key, pick, stake, multiplier FROM bets WHERE event = ? AND status = 'open'")
	};

	/* Runs `work` as one all-or-nothing change. */
	function transaction(work) {
		db.exec("BEGIN IMMEDIATE");
		try {
			const result = work();
			db.exec("COMMIT");
			return result;
		} catch (error) {
			db.exec("ROLLBACK");
			throw error;
		}
	}

	/* The ledger line is written first: if its `ref` has already been paid, nothing changes. */
	function credit(email, delta, reason, ref = null) {
		const written = statements.ledger.run(email, delta, reason, ref, Date.now());
		if (written.changes === 0) return false;
		statements.addPoints.run(delta, email);
		return true;
	}

	return {
		/* Signing in: a new person starts with the welcome points. */
		signIn(email, name, keepName = false) {
			return transaction(() => {
				const now = Date.now();
				if (statements.user.get(email)) {
					statements.touch.run(keepName ? statements.user.get(email).name : name, now, email);
				} else {
					statements.addUser.run(email, name, 0, now, now);
					credit(email, WELCOME_POINTS, "Welcome bonus", `welcome:${email}`);
				}
				return statements.user.get(email);
			});
		},

		user: email => statements.user.get(email) ?? null,

		rename(email, name) {
			statements.touch.run(name, Date.now(), email);
		},

		/* Pays points once per `ref`. Returns true if it paid. */
		award: (email, points, reason, ref) => transaction(() => credit(email, points, reason, ref)),

		/* Takes the stake now; throws a plain-English error if the bet isn't allowed. */
		placeBet({ email, event, matchKey, label, pick, stake, multiplier, maxOpen }) {
			return transaction(() => {
				const user = statements.user.get(email);
				if (!user) throw new Error("Sign in first.");
				if (statements.bet.get(email, matchKey)) throw new Error("You already have a bet on this match.");
				if (statements.openCount.get(email).total >= maxOpen) throw new Error(`You can have ${maxOpen} open bets at once. Wait for some matches to finish.`);
				if (stake > user.points) throw new Error(`You only have ${user.points} point${user.points === 1 ? "" : "s"}.`);

				statements.addBet.run(email, event, matchKey, label, pick, stake, multiplier, Date.now());
				if (!credit(email, -stake, `Bet on ${label}`, `bet:${email}:${matchKey}`)) throw new Error("That bet was already recorded.");
				return statements.user.get(email);
			});
		},

		/* result: "red" | "blue" | "tie". Pays winners, refunds ties. Returns how many bets it settled. */
		settleBets(event, results) {
			return transaction(() => {
				let settled = 0;

				for (const bet of statements.openBets.all(event)) {
					const result = results.get(bet.match_key);
					if (!result) continue;

					if (result === "tie") {
						statements.settle.run("refunded", bet.stake, Date.now(), bet.id);
						credit(bet.email, bet.stake, `Refund: ${bet.label} tied`, `refund:${bet.id}`);
					} else if (result === bet.pick) {
						const payout = Math.round(bet.stake * bet.multiplier);
						statements.settle.run("won", payout, Date.now(), bet.id);
						credit(bet.email, payout, `Won bet on ${bet.label}`, `win:${bet.id}`);
					} else {
						statements.settle.run("lost", 0, Date.now(), bet.id);
					}
					settled += 1;
				}

				return settled;
			});
		},

		/* Test mode: wipe this person's bets on one event and put their balance back to `points`.
		   Their ledger of earned points stays (so scouting can't be paid twice). */
		resetPoints(email, event, points = WELCOME_POINTS) {
			return transaction(() => {
				const user = statements.user.get(email);
				if (!user) return null;

				for (const bet of statements.betsOn.all(email, event)) {
					statements.deleteLedger.run(`bet:${email}:${bet.match_key}`);
					statements.deleteLedger.run(`win:${bet.id}`);
					statements.deleteLedger.run(`refund:${bet.id}`);
				}
				statements.deleteBets.run(email, event);

				const current = statements.user.get(email).points;
				if (current !== points) credit(email, points - current, "Points reset (test)", `reset:${email}:${Date.now()}`);
				return statements.user.get(email);
			});
		},

		openBetEvents: () => statements.openEvents.all().map(row => row.event),
		myBets: (email, limit = 30) => statements.myBets.all(email, limit),
		bet: (email, matchKey) => statements.bet.get(email, matchKey) ?? null,
		recentLedger: (email, limit = 15) => statements.recentLedger.all(email, limit),
		leaderboard: (limit = 20) => statements.leaderboard.all(limit),
		eventOpenBets: event => statements.eventBets.all(event)
	};
}
