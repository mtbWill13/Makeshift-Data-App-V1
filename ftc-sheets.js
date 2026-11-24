// FTC Google Sheet
//
// An FTC event can be linked to a Google Sheet. The reports themselves are saved in the
// database (ftc-store.js, the source of truth), and every saved report is also added to the
// sheet as a row, so the team can read, sort and chart them in Sheets. The sheet never
// feeds back into the site: edit it freely.
//
// Link an event by putting the sheet's ID in .env as FTC_SHEET_<season>_<event code>, e.g.
//   FTC_SHEET_2026_CAONSCQ=1AbC...   (the long piece of the sheet's address)
// and share the sheet with the service account (Editor), the same one the FRC sheets use.
//
// Tabs (made for you by "set up" if they're missing):
//   FTC Match Scouting, FTC Pit Scouting   one row per report
//   Practice                               one row per drive-practice run (added as they're logged; a sync never
//                                          clears this tab, so rows typed in by hand are safe)
//   Teams                                  every team at the event with FTCScout stats
//   Schedule                               the match schedule and scores
//   About                                  what the sheet is
//
// Writing to the sheet is best effort: if Google is slow or the sheet is missing, the report
// is still safely in the database, and "sync" rewrites the whole sheet from it.

import { reportCells, reportHeadings } from "./ftc-game.js";

export const TAB = { match: "FTC Match Scouting", pit: "FTC Pit Scouting", practice: "Practice", teams: "Teams", schedule: "Schedule", about: "About" };

export const PRACTICE_HEADINGS = ["Run", "Date", "Driver", "Operator", "Auto points", "Tele points", "Total points", "Notes"];

/* The sheet for practice runs: FTC_PRACTICE_SHEET in .env, else the first FTC event sheet linked for that season. */
export function practiceSheetIdFor(season) {
	const linked = prefix => Object.entries(process.env).find(([key, value]) => key.startsWith(prefix) && value?.trim())?.[1];
	/* The sheet for that season's event, else any linked FTC sheet: practice isn't tied to one season. */
	const id = process.env.FTC_PRACTICE_SHEET?.trim() || linked(`FTC_SHEET_${season}_`) || linked("FTC_SHEET_");
	return id ? (String(id).match(/\/d\/([\w-]+)/)?.[1] ?? String(id).trim()) : null;
}

/* The sheet's ID for an event, from .env (or null if it isn't linked). */
export function sheetIdFor(season, code) {
	const value = process.env[`FTC_SHEET_${season}_${String(code).toUpperCase()}`];
	if (!value) return null;
	return String(value).match(/\/d\/([\w-]+)/)?.[1] ?? String(value).trim();
}

const columnLetter = index => {
	let result = "";
	for (let current = index + 1; current > 0; current = Math.floor((current - 1) / 26)) result = String.fromCharCode(65 + (current - 1) % 26) + result;
	return result;
};

export function createFtcSheets({ sheets }) {
	/* Makes any missing tab, then writes the heading rows. Safe to run again. */
	async function setup(spreadsheetId, event) {
		const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties(title,sheetId)" });
		const have = new Set(meta.data.sheets.map(sheet => sheet.properties.title));
		const wanted = Object.values(TAB).filter(title => !have.has(title));

		if (wanted.length) {
			await sheets.spreadsheets.batchUpdate({
				spreadsheetId,
				requestBody: { requests: wanted.map(title => ({ addSheet: { properties: { title, gridProperties: { rowCount: 1000, columnCount: Math.max(12, reportHeadings("match").length), frozenRowCount: 1 } } } })) }
			});
		}

		for (const kind of ["match", "pit"]) {
			await sheets.spreadsheets.values.update({ spreadsheetId, range: `'${TAB[kind]}'!A1`, valueInputOption: "RAW", requestBody: { values: [reportHeadings(kind)] } });
		}

		await sheets.spreadsheets.values.update({ spreadsheetId, range: `'${TAB.practice}'!A1`, valueInputOption: "RAW", requestBody: { values: [PRACTICE_HEADINGS] } });

		await sheets.spreadsheets.values.update({
			spreadsheetId, range: `'${TAB.about}'!A1`, valueInputOption: "RAW",
			requestBody: { values: [
				["FTC scouting sheet"],
				[`Event: ${event.name ?? event.code} (${event.season} ${event.code})`],
				["Every match and pit report saved on the MakeShift site is added here as a row."],
				["The site's database is the original copy: this sheet is for reading, sorting and charting, and editing it doesn't change the site."],
				["The Teams and Schedule tabs are refreshed from FTCScout each time the site syncs this sheet. The Practice tab only ever gets new rows added."],
				["Columns follow the questions in ftc-game.js; if the questions change, press Sync on the strategy page to rewrite this sheet."]
			] }
		});
	}

	/* One report as a new row at the bottom of its tab. */
	async function appendReport(spreadsheetId, kind, report) {
		await sheets.spreadsheets.values.append({
			spreadsheetId, range: `'${TAB[kind]}'!A:A`, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
			requestBody: { values: [reportCells(kind, report)] }
		});
	}

	const practiceRow = run => [run.id, run.date, run.driver, run.operator, run.autoPoints ?? "", run.telePoints ?? "", run.totalPoints, run.notes ?? ""];

	/* Adds every logged run the sheet doesn't have yet. The Run column is the run's id, so a run is
	   added once; nothing already on the tab is changed or removed (manual rows are safe). */
	async function syncPractice(spreadsheetId, runs) {
		const existing = (await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB.practice}'!A2:A` })).data.values ?? [];
		const have = new Set(existing.map(row => String(row[0]).trim()));
		const missing = runs.filter(run => !have.has(String(run.id)));
		if (!missing.length) return 0;

		await sheets.spreadsheets.values.append({
			spreadsheetId, range: `'${TAB.practice}'!A:A`, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
			requestBody: { values: missing.map(practiceRow) }
		});
		return missing.length;
	}

	/* Replaces everything below the headings with `rows`. */
	async function replaceRows(spreadsheetId, tab, headings, rows) {
		await sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${tab}'!A:ZZ` });
		await sheets.spreadsheets.values.update({
			spreadsheetId, range: `'${tab}'!A1:${columnLetter(headings.length - 1)}${rows.length + 1}`, valueInputOption: "RAW",
			requestBody: { values: [headings, ...rows] }
		});
	}

	/* Rewrites the reports tabs from the database, and the Teams and Schedule tabs from FTCScout. */
	async function syncAll(spreadsheetId, { event, matchReports, pitReports, teams, schedule }) {
		await setup(spreadsheetId, event);

		await replaceRows(spreadsheetId, TAB.match, reportHeadings("match"), matchReports.map(report => reportCells("match", report)));
		await replaceRows(spreadsheetId, TAB.pit, reportHeadings("pit"), pitReports.map(report => reportCells("pit", report)));

		const num = value => Number.isFinite(value) ? Math.round(value * 100) / 100 : "";
		await replaceRows(spreadsheetId, TAB.teams,
			["Team", "Name", "City", "State", "Rank", "W-L-T", "OPR", "Auto OPR", "Teleop OPR", "Average score", "Match reports", "Pit report"],
			teams.map(team => [
				team.number, team.name ?? "", team.city ?? "", team.state ?? "", team.stats?.rank ?? "",
				team.stats ? `${team.stats.wins}-${team.stats.losses}-${team.stats.ties}` : "",
				num(team.stats?.opr?.total), num(team.stats?.opr?.auto), num(team.stats?.opr?.teleop), num(team.stats?.avg?.total),
				matchReports.filter(report => report.team === team.number).length,
				pitReports.some(report => report.team === team.number) ? "Yes" : ""
			])
		);

		await replaceRows(spreadsheetId, TAB.schedule,
			["Match", "Red 1", "Red 2", "Blue 1", "Blue 2", "Red score", "Blue score", "Played"],
			schedule.map(match => [
				match.label, match.red.teams[0] ?? "", match.red.teams[1] ?? "", match.blue.teams[0] ?? "", match.blue.teams[1] ?? "",
				match.played ? match.red.score : "", match.played ? match.blue.score : "", match.played ? "Yes" : ""
			])
		);

		return { matches: matchReports.length, pits: pitReports.length, teams: teams.length, scheduled: schedule.length };
	}

	return { setup, appendReport, syncPractice, syncAll };
}
