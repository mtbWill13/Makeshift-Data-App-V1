/* =================================
   TEAM ACCOUNTS
   Each team has its own login, colours and Google Sheet(s). Accounts live in a
   JSON file (data/teams.json, or TEAMS_FILE) and passwords are stored only as
   scrypt hashes. The original MakeShift 4039 team is configured from .env and
   passed in as `legacy`; it is never written to the file.
================================= */

import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { randomBytes, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

export async function hashSecret(secret) {
	const salt = randomBytes(16);
	const key = await scryptAsync(String(secret), salt, 64);
	return `${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifySecret(secret, stored) {
	const [saltHex, keyHex] = String(stored ?? "").split(":");
	if (!saltHex || !keyHex) return false;

	const key = await scryptAsync(String(secret), Buffer.from(saltHex, "hex"), 64);
	const expected = Buffer.from(keyHex, "hex");
	return expected.length === key.length && timingSafeEqual(key, expected);
}


/* =================================
   COLOURS
   The site is dark, so the main colour has to be bright enough for dark button
   text and the accent bright enough for links on the dark background. The same
   rule is checked in the browser (public/team-colors.js).
================================= */

export const DEFAULT_COLORS = { primary: "#eb4e3f", accent: "#59a8d7" };
const BUTTON_TEXT = "#0a0b0d";
const SURFACE = "#0f1115";

function luminance(hex) {
	const channels = [1, 3, 5].map(index => {
		const value = parseInt(hex.slice(index, index + 2), 16) / 255;
		return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a, b) {
	const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (high + 0.05) / (low + 0.05);
}

/* Returns { colors } with lower-case hex values, or { error }. */
export function checkColors(input) {
	const primary = String(input?.primary ?? "").trim().toLowerCase();
	const accent = String(input?.accent ?? "").trim().toLowerCase();

	if (!/^#[0-9a-f]{6}$/.test(primary) || !/^#[0-9a-f]{6}$/.test(accent)) {
		return { error: "Pick both colours." };
	}
	if (contrast(primary, BUTTON_TEXT) < 4.5) {
		return { error: "The main colour is too dark for buttons. Pick a brighter one." };
	}
	if (contrast(accent, SURFACE) < 4.5) {
		return { error: "The accent colour is too dark to read on the dark background. Pick a brighter one." };
	}
	return { colors: { primary, accent } };
}


/* =================================
   FIELD CHECKS
================================= */

export function cleanName(value) {
	return String(value ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
}

export function parseTeamNumber(value) {
	const text = String(value ?? "").trim();
	return /^\d{1,5}$/.test(text) && Number(text) > 0 ? String(Number(text)) : null;
}

/* Accepts a full Google Sheets link or just the ID. */
export function parseSheetId(value) {
	const text = String(value ?? "").trim();
	const fromUrl = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
	if (fromUrl) return fromUrl[1];
	return /^[a-zA-Z0-9_-]{20,}$/.test(text) ? text : null;
}

export function parseEventKey(value) {
	const text = String(value ?? "").trim().toLowerCase();
	return /^\d{4}[a-z0-9]{2,20}$/.test(text) ? text : null;
}


/* =================================
   STORE
================================= */

export function createTeamStore({ file, legacy = null, maxTeams = 2000 }) {
	const teams = new Map();
	let writing = Promise.resolve();

	async function load() {
		try {
			const saved = JSON.parse(await readFile(file, "utf8"));
			for (const team of saved.teams ?? []) teams.set(String(team.number), team);
		} catch (error) {
			if (error.code !== "ENOENT") console.error("Teams: couldn't read", String(file), "-", error.message);
		}
	}

	/* Saves one write at a time, via a temp file, so a crash never leaves a half-written file. */
	function save() {
		writing = writing.then(async () => {
			const path = file instanceof URL ? fileURLToPath(file) : String(file);
			await mkdir(dirname(path), { recursive: true });
			const temp = `${path}.tmp`;
			await writeFile(temp, JSON.stringify({ teams: [...teams.values()] }, null, 2));
			await rename(temp, path);
		}).catch(error => console.error("Teams: couldn't save:", error.message));
		return writing;
	}

	const get = number => (legacy && String(number) === legacy.number ? legacy : teams.get(String(number)) ?? null);

	/* Every sheet a team uses, for "is this sheet already someone's?" checks. */
	function sheetOwner(sheetId, exceptNumber = null) {
		const all = [...(legacy ? [legacy] : []), ...teams.values()];
		return all.find(team => team.number !== String(exceptNumber) && team.events.some(event => event.sheetId === sheetId)) ?? null;
	}

	/* The object returned to the browser: never any hashes. */
	function publicView(team) {
		return {
			number: team.number,
			name: team.name,
			colors: team.colors,
			legacy: Boolean(team.legacy),
			events: team.legacy ? [] : team.events.map(({ key, name, sheetId }) => ({ key, name, hasSheet: Boolean(sheetId) }))
		};
	}

	return {
		load,
		save,
		get,
		sheetOwner,
		publicView,
		/* Deleting an account frees its team number and sheets for anyone to use again. */
		remove(number) {
			const removed = teams.delete(String(number));
			if (removed) save();
			return removed;
		},
		count: () => teams.size,
		isFull: () => teams.size >= maxTeams,
		add(team) {
			teams.set(team.number, team);
			return save();
		},
		/* Everything about a stored (non-legacy) team can change except its number. */
		update(number, changes) {
			const team = teams.get(String(number));
			if (!team) return null;
			Object.assign(team, changes);
			save();
			return team;
		}
	};
}
