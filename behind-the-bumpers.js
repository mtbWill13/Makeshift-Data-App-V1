// Behind the Bumpers index
//
// FUN Robotics Network publishes Behind the Bumpers robot walkthroughs on
// YouTube. TBA only links a few of them, so we read the channel's full uploads
// list with the YouTube Data API, keep the Behind the Bumpers episodes, and
// index them by team number and season. The index is saved to disk so it
// survives restarts and works offline at events, and is refreshed once a day.
//
// Cost: playlistItems.list is 1 quota unit per 50 videos. The first full
// download of ~6,700 videos is ~134 units; daily refreshes stop at the first
// already-known video, so they're usually 1 unit (free quota is 10,000/day).

import { mkdir, readFile, writeFile } from "fs/promises";

const UPLOADS_PLAYLIST = "UUuJUknE5JjilAfNnmbvr22Q"; // FUN Robotics Network uploads
const INDEX_FILE = new URL("./data/behind-the-bumpers.json", import.meta.url);
const REFRESH_MS = 24 * 60 * 60 * 1000;

// Titles name the game rather than the year.
const GAME_SEASONS = [
	["rebuilt", 2026],
	["reefscape", 2025],
	["crescendo", 2024],
	["charged up", 2023],
	["rapid react", 2022],
	["infinite recharge", 2020], // also played in 2021; see seasonFor()
	["deep space", 2019],
	["power up", 2018],
	["steamworks", 2017],
	["stronghold", 2016]
];

// Words that can follow a number that is NOT a team number,
// e.g. "2025 FRC REEFSCAPE Robot", "2019 Competition Season", "10 Consecutive Seasons".
const NOT_A_TEAM_NAME = /^(frc|first|competition|consecutive|season|seasons|world|einstein|reveal|championship|reefscape|crescendo|rebuilt|charged|rapid|infinite|deep|power|steamworks|stronghold)\b/i;

// A team number: after "FRC"/"Team" (with or without a space, e.g. "FRC4561TerrorBytes"),
// or standalone. A digit stuck to other letters ("ALT-F4", "Sisters 1st") isn't one.
const TEAM_NUMBER = /(?:\bfrc\s*|\bteams?\s+|\btem\s+|(?<![\w-]))(\d{1,5})(?!\d)/gi;

/* The team number is the first number in the title that is followed by the
   team's name (or ends its segment). Segments are split on the "|" separators
   and on the series name. Numbers equal to the upload year ("2019 IRI Charity
   Auction") and joke alumni teams ("9999* Team Koops Alumni") are skipped. */
export function teamNumberFrom(title, published = "") {
	const publishedYear = Number(String(published).slice(0, 4));
	const segments = title
		.split(/[|｜]|behind the bumpers!?/i)
		.map(segment => segment.trim())
		.filter(Boolean);

	for (const segment of segments) {
		for (const match of segment.matchAll(TEAM_NUMBER)) {
			const number = Number(match[1]);
			const rest = segment.slice(match.index + match[0].length).trim();

			if (number === 0 || number === publishedYear) continue;
			if (rest.startsWith("*") || /^(st|nd|rd|th)\b/i.test(rest)) continue;
			if (NOT_A_TEAM_NAME.test(rest)) continue;

			return number;
		}
	}

	return null;
}

/* Season from the game name, else from the upload date. FRC seasons run with
   the calendar year (kickoff is in January). */
export function seasonFor(title, published) {
	const lower = title.toLowerCase();
	const publishedYear = Number(String(published).slice(0, 4));
	const game = GAME_SEASONS.find(([name]) => lower.includes(name));

	if (game) {
		return game[1] === 2020 && publishedYear === 2021 ? 2021 : game[1];
	}

	return Number.isFinite(publishedYear) ? publishedYear : null;
}

export function parseVideo({ id, title, published }) {
	if (!/behind the bumpers/i.test(title)) return null;

	const team = teamNumberFrom(title, published);
	const season = seasonFor(title, published);

	return team && season ? { id, title, published, team, season } : null;
}

/* =================================
   INDEX STORAGE + REFRESH
================================= */

let index = { updated: 0, seen: [], episodes: [] };
let byTeam = new Map();
let refreshing = null;

function rebuildLookup() {
	byTeam = new Map();

	for (const episode of index.episodes) {
		if (!byTeam.has(episode.team)) byTeam.set(episode.team, []);
		byTeam.get(episode.team).push(episode);
	}

	// Oldest first within a team, so a season's first episode is its robot overview.
	for (const episodes of byTeam.values()) {
		episodes.sort((a, b) => String(a.published).localeCompare(String(b.published)));
	}
}

async function loadIndex() {
	try {
		index = JSON.parse(await readFile(INDEX_FILE, "utf8"));
		rebuildLookup();
	} catch {
		/* No saved index yet; the first refresh creates it. */
	}
}

async function fetchUploads(apiKey, knownIds) {
	const videos = [];
	let pageToken = "";

	do {
		const params = new URLSearchParams({
			part: "snippet,contentDetails",
			maxResults: "50",
			playlistId: UPLOADS_PLAYLIST,
			fields: "nextPageToken,items(snippet/title,contentDetails/videoId,contentDetails/videoPublishedAt)",
			key: apiKey
		});

		if (pageToken) params.set("pageToken", pageToken);

		const response = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${params}`, {
			signal: AbortSignal.timeout(15000)
		});
		const data = await response.json().catch(() => ({}));

		if (!response.ok) {
			throw new Error(`YouTube API error ${response.status}: ${data.error?.message ?? "unknown"}`);
		}

		let reachedKnown = false;

		for (const item of data.items ?? []) {
			const id = item.contentDetails?.videoId;

			if (knownIds.has(id)) {
				reachedKnown = true;
				continue;
			}

			videos.push({
				id,
				title: item.snippet?.title ?? "",
				published: item.contentDetails?.videoPublishedAt ?? ""
			});
		}

		// Uploads are newest first, so once we reach videos we've already seen, stop.
		pageToken = reachedKnown ? "" : data.nextPageToken;
	} while (pageToken);

	return videos;
}

/* Downloads new uploads (or everything, the first time) and saves the index. */
export async function refreshIndex(apiKey) {
	if (!apiKey) return;
	if (refreshing) return refreshing;

	refreshing = (async () => {
		const knownIds = new Set(index.seen);
		const newVideos = await fetchUploads(apiKey, knownIds);
		const newEpisodes = newVideos.map(parseVideo).filter(Boolean);

		index = {
			updated: Date.now(),
			seen: [...knownIds, ...newVideos.map(video => video.id)],
			episodes: [...index.episodes, ...newEpisodes]
		};
		rebuildLookup();

		await mkdir(new URL("./data/", import.meta.url), { recursive: true });
		await writeFile(INDEX_FILE, JSON.stringify(index));

		console.log(`Behind the Bumpers: ${newVideos.length} new uploads, ${newEpisodes.length} new episodes, ${index.episodes.length} total.`);
	})()
		.catch(error => console.error("Behind the Bumpers refresh failed:", error.message))
		.finally(() => { refreshing = null; });

	return refreshing;
}

/* Loads the saved index, refreshes it if it's more than a day old, and keeps
   refreshing daily. Without an API key this does nothing and lookups return []. */
export async function startBehindTheBumpers(apiKey) {
	await loadIndex();

	if (!apiKey) {
		console.log("Behind the Bumpers: no YOUTUBE_API_KEY set; using TBA links only.");
		return;
	}

	if (Date.now() - index.updated > REFRESH_MS) {
		refreshIndex(apiKey);
	}

	setInterval(() => refreshIndex(apiKey), REFRESH_MS).unref();
}

/* Every indexed episode for a team, oldest first. */
export function episodesForTeam(teamNumber) {
	return byTeam.get(Number(teamNumber)) ?? [];
}
