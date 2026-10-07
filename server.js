import "dotenv/config";
import express from "express";
import { google } from "googleapis";
import { startBehindTheBumpers, episodesForTeam } from "./behind-the-bumpers.js";
const app = express();

app.use(express.json({ limit: "100kb" }));

app.use((req, res, next) => {
	console.log("REQUEST:", req.method, req.url);
	next();
});
const TBA_BASE = "https://www.thebluealliance.com/api/v3";
const googleAuth = new google.auth.GoogleAuth({
	credentials: process.env.GOOGLE_SERVICE_ACCOUNT_JSON
		? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
		: undefined,
	keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_JSON
		? undefined
		: "./google-service-account.json",
	scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});



if (!process.env.TBA_AUTH_KEY) {
	throw new Error("Missing TBA_AUTH_KEY in .env");
}

if (!process.env.SCOUTING_SHEET_2026ONCMP2) {
	console.warn("Missing SCOUTING_SHEET_2026ONCMP2 in .env");
}
const sheets = google.sheets({
	version: "v4",
	auth: googleAuth
});

const scoutingSheetIds = {
	"2026oncmp2": process.env.SCOUTING_SHEET_2026ONCMP2,
	"2026ontor": process.env.SCOUTING_SHEET_2026ONTOR,
	"2026onwin": process.env.SCOUTING_SHEET_2026ONWIN,
	"2026test": process.env.SCOUTING_SHEET_2026TEST
};

function spreadsheetIdForEvent(eventKey) {
	return scoutingSheetIds[eventKey];
}

function columnIndexToLetter(index) {
	let result = "";
	let current = index + 1;

	while (current > 0) {
		const remainder = (current - 1) % 26;
		result = String.fromCharCode(65 + remainder) + result;
		current = Math.floor((current - 1) / 26);
	}

	return result;
}

async function tba(path) {
	const response = await fetch(`${TBA_BASE}${path}`, {
		headers: {
			"X-TBA-Auth-Key": process.env.TBA_AUTH_KEY,
		},
	});

	if (!response.ok) {
		throw new Error(`TBA request failed: ${response.status}`);
	}

	return response.json();
}

const statboticsCache = new Map();
const STATBOTICS_CACHE_MS = 2 * 60 * 1000;

async function statbotics(path) {
	const cached = statboticsCache.get(path);
	if (cached && Date.now() - cached.time < STATBOTICS_CACHE_MS) {
		return cached.data;
	}

	// Statbotics often has brief 5xx errors or dropped connections, so retry a
	// few times before giving up. 4xx errors (e.g. unknown team) fail straight away.
	const maxAttempts = 4;

	for (let attempt = 1; ; attempt++) {
		let response;

		try {
			response = await fetch(`https://api.statbotics.io/v3${path}`, {
				headers: { Accept: "application/json" },
				signal: AbortSignal.timeout(10000)
			});
		} catch (error) {
			if (attempt >= maxAttempts) throw error;
		}

		if (response?.ok) {
			const data = await response.json();
			statboticsCache.set(path, { time: Date.now(), data });
			return data;
		}

		if (response && (response.status < 500 || attempt >= maxAttempts)) {
			throw new Error(`Statbotics request failed: ${response.status}`);
		}

		await new Promise(resolve => setTimeout(resolve, 500 * attempt));
	}
}

function stripHtml(value) {
	return String(value ?? "").replace(/<[^>]*>/g, "");
}

// All results for an event, such as "2026onott"
app.get("/api/events/:eventKey/matches", async (req, res) => {
	try {
		const matches = await tba(`/event/${req.params.eventKey}/matches`);

		// Return a simpler shape for a basic UI
		res.json(matches.map(match => ({
			key: match.key,
			level: match.comp_level,       // qm, sf, f, etc.
			number: match.match_number,
			red: match.alliances.red,
			blue: match.alliances.blue,
			winner: match.winning_alliance,
			time: match.actual_time,
		})));
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
});

// TBA team data
app.get(`/api/teamName/:teamNumber`, async (req, res) => {
	try {
		const team = await tba(`/team/frc${req.params.teamNumber}`);

		res.json({ name: team.nickname });
	} catch (error) {
		res.status(404).json({ error: error.message });
	}
});

// A team's robot photo for a year, if one is posted on TBA (preferred photo first)
const ROBOT_PHOTO_TYPES = new Set(["imgur", "cdphotothread", "instagram-image"]);

// Video titles from YouTube's public oEmbed endpoint (no API key). Titles don't
// change, so successful lookups are kept for the life of the server.
const youtubeInfoCache = new Map();

async function youtubeInfo(videoId) {
	if (youtubeInfoCache.has(videoId)) return youtubeInfoCache.get(videoId);

	const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
	const info = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`, {
		signal: AbortSignal.timeout(5000)
	})
		.then(response => response.ok ? response.json() : null)
		.catch(() => null);

	if (info) youtubeInfoCache.set(videoId, info);
	return info;
}

// TBA's YouTube media mixes Behind the Bumpers episodes (FUN Robotics Network,
// titled "2056 OP Robotics | Behind the Bumpers | ...") with teams' own reveal
// videos, so only accept a title that names the series and this team.
async function behindTheBumpers(media, teamNumber) {
	const videoIds = media
		.filter(item => item.type === "youtube" && /^[\w-]{11}$/.test(item.foreign_key ?? ""))
		.map(item => item.foreign_key);
	const infos = await Promise.all(videoIds.map(youtubeInfo));
	const teamPattern = new RegExp(`(^|\\D)${teamNumber}(\\D|$)`);
	const index = infos.findIndex(info =>
		/behind the bumpers/i.test(info?.title ?? "") && teamPattern.test(info.title)
	);

	return index === -1
		? null
		: { url: `https://www.youtube.com/watch?v=${videoIds[index]}`, title: infos[index].title };
}

// A team's robot photo and Behind the Bumpers video for a year, if TBA has them
app.get("/api/teams/:teamNumber/media/:year", async (req, res) => {
	const { teamNumber, year } = req.params;

	if (!/^\d+$/.test(teamNumber)) {
		return res.status(400).json({ error: "Invalid team number." });
	}

	try {
		const media = await tba(`/team/frc${teamNumber}/media/${year}`);
		const items = Array.isArray(media) ? media : [];
		const photos = items.filter(item => ROBOT_PHOTO_TYPES.has(item.type) && item.direct_url);
		const photo = photos.find(item => item.preferred) ?? photos[0];

		// Behind the Bumpers from the YouTube index (one episode per season, the
		// first being the robot overview), falling back to TBA's links this season.
		const episodes = new Map();
		for (const episode of episodesForTeam(teamNumber)) {
			if (!episodes.has(episode.season)) episodes.set(episode.season, episode);
		}
		const link = episode => ({
			season: episode.season,
			url: `https://www.youtube.com/watch?v=${episode.id}`,
			title: episode.title
		});
		const thisSeason = episodes.get(Number(year));

		res.json({
			url: photo?.direct_url ?? null,
			viewUrl: photo?.view_url ?? null,
			behindTheBumpers: thisSeason ? link(thisSeason) : await behindTheBumpers(items, teamNumber),
			pastBehindTheBumpers: [...episodes.values()]
				.filter(episode => episode.season < Number(year))
				.sort((a, b) => b.season - a.season)
				.map(link)
		});
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
});

// Event rankings
app.get("/api/events/:eventKey/rankings", async (req, res) => {
	try {
		// TBA wraps the list as { rankings: [...] }; pages expect the array itself.
		const data = await tba(`/event/${req.params.eventKey}/rankings`);
		res.json(data?.rankings ?? []);
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
});

// Event OPR statistics
app.get("/api/events/:eventKey/oprs", async (req, res) => {
	try {
		res.json(await tba(`/event/${req.params.eventKey}/oprs`));
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
});

// A team's events in a given year
app.get("/api/teams/:teamKey/events/:year", async (req, res) => {
	try {
		res.json(await tba(`/team/${req.params.teamKey}/events/${req.params.year}`));
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
});

// A team's whole season: every event they attended with rank, OPR and EPA
app.get("/api/teams/:teamNumber/season/:year", async (req, res) => {
	const { teamNumber, year } = req.params;
	const teamKey = `frc${teamNumber}`;

	let team;
	let events;

	try {
		[team, events] = await Promise.all([
			tba(`/team/${teamKey}`),
			tba(`/team/${teamKey}/events/${year}`)
		]);
	} catch (error) {
		return res.status(404).json({ error: `Team ${teamNumber} was not found on The Blue Alliance.` });
	}

	try {
		const [statuses, teamYear, teamEvents, eventOprs] = await Promise.all([
			tba(`/team/${teamKey}/events/${year}/statuses`).catch(() => ({})),
			statbotics(`/team_year/${teamNumber}/${year}`).catch(() => null),
			statbotics(`/team_events?team=${teamNumber}&year=${year}`).catch(() => []),
			Promise.all(events.map(event =>
				tba(`/event/${event.key}/oprs`).catch(() => null)
			))
		]);

		const epaByEvent = new Map(
			(Array.isArray(teamEvents) ? teamEvents : []).map(row => [row.event, row])
		);

		const seasonEvents = events
			.map((event, index) => {
				const status = statuses?.[event.key];
				const ranking = status?.qual?.ranking;
				const oprs = eventOprs[index];
				const teamEvent = epaByEvent.get(event.key);
				const breakdown = teamEvent?.epa?.breakdown;

				return {
					key: event.key,
					name: event.short_name || event.name,
					startDate: event.start_date,
					rank: ranking?.rank ?? teamEvent?.record?.qual?.rank ?? null,
					numTeams: status?.qual?.num_teams ?? teamEvent?.record?.qual?.num_teams ?? null,
					qualRecord: ranking?.record ?? null,
					playoffRecord: status?.playoff?.record ?? null,
					allianceStatus: stripHtml(status?.alliance_status_str) || null,
					playoffStatus: stripHtml(status?.playoff_status_str) || null,
					opr: oprs?.oprs?.[teamKey] ?? null,
					dpr: oprs?.dprs?.[teamKey] ?? null,
					ccwm: oprs?.ccwms?.[teamKey] ?? null,
					epa: teamEvent?.epa?.total_points?.mean ?? teamEvent?.epa?.total_points ?? null,
					autoEpa: breakdown?.auto_points ?? null,
					teleopEpa: breakdown?.teleop_points ?? null,
					endgameEpa: breakdown?.endgame_points ?? null
				};
			})
			.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));

		res.json({
			team: Number(teamNumber),
			year: Number(year),
			name: teamYear?.name ?? team.nickname,
			epa: teamYear?.epa ?? null,
			record: teamYear?.record ?? null,
			events: seasonEvents
		});
	} catch (error) {
		console.error("SEASON ERROR:", error);
		res.status(500).json({ error: error.message });
	}
});

app.get("/api/scouting/:eventKey", async (req, res) => {
	console.log("SCOUTING ROUTE HIT");
	console.log("Event key:", req.params.eventKey);

	try {
		const { eventKey } = req.params;

		const spreadsheetId = spreadsheetIdForEvent(eventKey);

		console.log("Spreadsheet ID:", spreadsheetId);

		if (!spreadsheetId) {
			console.log("No spreadsheet configured");
			return res.json([]);
		}

		const response = await sheets.spreadsheets.values.get({
			spreadsheetId,
			range: "'Scouting Raw Data'!A:AF"
		});

		console.log("Google Sheets request succeeded");

		const [headers, ...rows] = response.data.values || [];

		if (!headers) {
			return res.json([]);
		}

		const scoutingData = rows.map(row =>
			Object.fromEntries(
				headers.map((header, index) => [
					header,
					row[index] ?? ""
				])
			)
		);

		res.json(scoutingData);

	} catch (error) {
		console.error("SCOUTING ERROR:", error);

		res.status(500).json({
			error: error.message
		});
	}
});

app.get("/api/scouting/:eventKey/schema", async (req, res) => {
	try {
		const spreadsheetId = spreadsheetIdForEvent(req.params.eventKey);

		if (!spreadsheetId) {
			return res.status(404).json({ error: "No scouting sheet is configured for this event." });
		}

		const response = await sheets.spreadsheets.values.get({
			spreadsheetId,
			range: "'Scouting Raw Data'!A:ZZ"
		});

		/* Keep blank cells: array index 0 must always remain column A.
		   Filtering blank headers shifts later columns (for example Y becomes B). */
		const rows = response.data.values ?? [];
		const headers = (rows[0] ?? [])
			.map(header => String(header).trim());

		if (!headers.some(Boolean)) {
			return res.status(500).json({ error: "The scouting sheet has no header row." });
		}

		const booleanColumnIndexes = headers
			.map((header, index) => {
				const values = rows
					.slice(1)
					.map(row => String(row[index] ?? "").trim().toUpperCase())
					.filter(Boolean);

				return values.length && values.every(value =>
					value === "TRUE" || value === "FALSE"
				)
					? index
					: null;
			})
			.filter(Number.isInteger);

		res.json({ headers, booleanColumnIndexes });
	} catch (error) {
		console.error("SCOUTING SCHEMA ERROR:", error);
		res.status(500).json({ error: error.message });
	}
});

app.post("/api/scouting/:eventKey", async (req, res) => {
	try {
		const submissionToken =
			process.env.SCOUTING_SUBMISSION_TOKEN ??
			process.env.PIT_SCOUTING_SUBMISSION_TOKEN;

		if (!submissionToken) {
			return res.status(503).json({
				error: "Scouting submissions are not configured. Set SCOUTING_SUBMISSION_TOKEN on the server first."
			});
		}

		if (req.body?.submissionToken !== submissionToken) {
			return res.status(401).json({ error: "Incorrect scout passcode." });
		}

		const spreadsheetId = spreadsheetIdForEvent(req.params.eventKey);

		if (!spreadsheetId) {
			return res.status(404).json({ error: "No scouting sheet is configured for this event." });
		}

		const answers = req.body?.answers;

		if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
			return res.status(400).json({ error: "A scouting response is required." });
		}

		const headerResponse = await sheets.spreadsheets.values.get({
			spreadsheetId,
			range: "'Scouting Raw Data'!1:1"
		});

		const headers = (headerResponse.data.values?.[0] ?? [])
			.map(header => String(header).trim());

		if (!headers.length) {
			return res.status(500).json({ error: "The scouting sheet has no header row." });
		}

		/*
			Do not use values.append here. Google Sheets can detect the existing
			table starting in a later column when the earlier columns are blank,
			which shifts a scouting response into the wrong fields. Find the next
			row and explicitly write A through AF instead.
		*/
		const lastColumn = columnIndexToLetter(headers.length - 1);

		const existingRowsResponse = await sheets.spreadsheets.values.get({
			spreadsheetId,
			range: `'Scouting Raw Data'!A:${lastColumn}`
		});

		const existingRows = existingRowsResponse.data.values ?? [];
		const lastUsedRowIndex = existingRows.reduce(
			(lastIndex, row, index) =>
				row.some(value => String(value ?? "").trim() !== "")
					? index
					: lastIndex,
			0
		);

		const nextRow = lastUsedRowIndex + 2;

		await sheets.spreadsheets.values.update({
			spreadsheetId,
			range: `'Scouting Raw Data'!A${nextRow}:${lastColumn}${nextRow}`,
			valueInputOption: "USER_ENTERED",
			requestBody: {
				values: [headers.map((header, index) =>
					String(answers[`column-${index}`] ?? answers[`${index}`] ?? "")
				)]
			}
		});

		res.status(201).json({ ok: true });
	} catch (error) {
		console.error("SCOUTING WRITE ERROR:", error);
		res.status(500).json({ error: error.message });
	}
});

app.get("/api/pitscouting/:eventKey", async (req, res) => {
	console.log("SCOUTING ROUTE HIT");
	console.log("Event key:", req.params.eventKey);

	try {
		const { eventKey } = req.params;

		const spreadsheetId = spreadsheetIdForEvent(eventKey);

		console.log("Spreadsheet ID:", spreadsheetId);

		if (!spreadsheetId) {
			console.log("No spreadsheet configured");
			return res.json([]);
		}

		const response = await sheets.spreadsheets.values.get({
			spreadsheetId,
			range: "'Pit Scouting Raw Data'!A:AL"
		});

		console.log("Google Sheets request succeeded");

		const [headers, ...rows] = response.data.values || [];

		if (!headers) {
			return res.json([]);
		}

		const scoutingData = rows.map(row =>
			Object.fromEntries(
				headers.map((header, index) => [
					header,
					row[index] ?? ""
				])
			)
		);

		res.json(scoutingData);

	} catch (error) {
		console.error("SCOUTING ERROR:", error);

		res.status(500).json({
			error: error.message
		});
	}
});

app.get("/api/pitscouting/:eventKey/schema", async (req, res) => {
	try {
		const spreadsheetId = spreadsheetIdForEvent(req.params.eventKey);

		if (!spreadsheetId) {
			return res.status(404).json({ error: "No pit-scouting sheet is configured for this event." });
		}

		const response = await sheets.spreadsheets.values.get({
			spreadsheetId,
			range: "'Pit Scouting Raw Data'!1:1"
		});

		/* Keep blank cells so array index 0 always remains column A,
		   otherwise PIT_SCOUTING_COLUMNS letters point at the wrong questions. */
		const headers = (response.data.values?.[0] ?? [])
			.map(header => String(header).trim());

		if (!headers.some(Boolean)) {
			return res.status(500).json({ error: "The pit-scouting sheet has no header row." });
		}

		res.json({ headers });
	} catch (error) {
		console.error("PIT SCOUTING SCHEMA ERROR:", error);
		res.status(500).json({ error: error.message });
	}
});

app.post("/api/pitscouting/:eventKey", async (req, res) => {
	try {
		const submissionToken = process.env.PIT_SCOUTING_SUBMISSION_TOKEN;

		if (!submissionToken) {
			return res.status(503).json({
				error: "Pit scouting submissions are not configured. Set PIT_SCOUTING_SUBMISSION_TOKEN on the server first."
			});
		}

		if (req.body?.submissionToken !== submissionToken) {
			return res.status(401).json({ error: "Incorrect scout passcode." });
		}

		const spreadsheetId = spreadsheetIdForEvent(req.params.eventKey);

		if (!spreadsheetId) {
			return res.status(404).json({ error: "No pit-scouting sheet is configured for this event." });
		}

		const answers = req.body?.answers;

		if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
			return res.status(400).json({ error: "A pit-scouting response is required." });
		}

		const headerResponse = await sheets.spreadsheets.values.get({
			spreadsheetId,
			range: "'Pit Scouting Raw Data'!1:1"
		});

		const headers = (headerResponse.data.values?.[0] ?? [])
			.map(header => String(header).trim());

		if (!headers.length) {
			return res.status(500).json({ error: "The pit-scouting sheet has no header row." });
		}

		await sheets.spreadsheets.values.append({
			spreadsheetId,
			range: "'Pit Scouting Raw Data'!A:AL",
			valueInputOption: "USER_ENTERED",
			insertDataOption: "INSERT_ROWS",
			requestBody: {
				/* Pit forms key answers by header; QR transfers key them by column. */
				values: [headers.map((header, index) =>
					String(answers[`column-${index}`] ?? answers[header] ?? "")
				)]
			}
		});

		res.status(201).json({ ok: true });
	} catch (error) {
		console.error("PIT SCOUTING WRITE ERROR:", error);
		res.status(500).json({ error: error.message });
	}
});

app.get("/api/statbotics/team-event/:team/:event", async (req, res) => {
	const { team, event } = req.params;
	const url = `https://api.statbotics.io/v3/team_event/${team}/${event}`;

	try {
		const response = await fetch(url, {
			headers: { Accept: "application/json" }
		});

		const text = await response.text();

		let data;
		try {
			data = JSON.parse(text);
		} catch {
			data = { rawResponse: text };
		}

		if (!response.ok) {
			console.error("Statbotics response:", response.status, data);

			return res.status(response.status).json({
				error: `Statbotics returned ${response.status}`,
				details: data
			});
		}

		res.json(data);
	} catch (error) {
		console.error("Statbotics connection error:", error.message);

		res.status(502).json({
			error: "Could not contact Statbotics",
			details: error.message
		});
	}
});

app.get("/api/statbotics/event-teams/:event", async (req, res) => {
	const query = new URLSearchParams({
		event: req.params.event,
		limit: "1000"
	});

	try {
		const response = await fetch(`https://api.statbotics.io/v3/team_events?${query}`, {
			headers: { Accept: "application/json" }
		});
		const data = await response.json().catch(() => ({}));

		if (!response.ok) {
			return res.status(response.status).json({
				error: `Statbotics returned ${response.status}`,
				details: data
			});
		}

		res.json(Array.isArray(data) ? data : []);
	} catch (error) {
		console.error("Statbotics event-teams connection error:", error.message);
		res.status(502).json({ error: "Could not contact Statbotics" });
	}
});

app.get("/api/statbotics/team-matches/:team/:event", async (req, res) => {
	const { team, event } = req.params;
	const query = new URLSearchParams({
		team,
		event,
		limit: "100"
	});
	const url = `https://api.statbotics.io/v3/matches?${query}`;

	try {
		const response = await fetch(url, {
			headers: { Accept: "application/json" }
		});
		const text = await response.text();

		let data;
		try {
			data = JSON.parse(text);
		} catch {
			data = { rawResponse: text };
		}

		if (!response.ok) {
			console.error("Statbotics match-history response:", response.status, data);

			return res.status(response.status).json({
				error: `Statbotics returned ${response.status}`,
				details: data
			});
		}

		res.json(data);
	} catch (error) {
		console.error("Statbotics match-history connection error:", error.message);

		res.status(502).json({
			error: "Could not contact Statbotics",
			details: error.message
		});
	}
});

app.use("/", express.static("public/index"));
app.use(express.static("public"));
const PORT = process.env.PORT || 3000;

app.get("/health", (req, res) => {
	res.json({ ok: true });
});

app.listen(PORT, "0.0.0.0", () => {
	console.log(`Open http://localhost:${PORT}`);
});

startBehindTheBumpers(process.env.YOUTUBE_API_KEY);
