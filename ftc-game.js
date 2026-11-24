// FTC game definition: every question the match and pit scouting forms ask.
//
// The forms, the saved-report checks, the stats and the CSV export are all built from
// this one list, so a new season (or a rules change) is a change to THIS FILE ONLY.
// Nothing else needs to know what "pollen" or "nectar" is.
//
// Field types
//   count    whole number with + / − buttons (shot, scored...). max is optional.
//   yesno    Yes / No. Left unanswered is stored as "".
//   choice   pick one option.
//   multi    pick any number of options.
//   scale    a 1 to 5 rating (5 is best).
//   number   a number typed in (optional unit).
//   text / longtext   typed answers.
// `showIf: { field, value }` only shows a question once another one has that answer.
//
// `groups` pair "shot" and "scored" counts so the stats can show accuracy (a scored element
// is also a shot, so scored can never be more than shot).
// `points` says how many points each "scored" count is worth. It is empty on purpose:
// fill it in from the game manual (field id -> points) and the pages start showing
// scouted points per match and a scouted-points prediction. Until then nothing is guessed.

export const FTC_GAME = {
	season: "2026",
	name: "BIOBUZZ presented by RTX",
	/* Everything below follows the 2026-27 Competition Manual (version TU09): section 10 for the
	   scoring, and G304, G407, G408, G410, G417, G418 and G421 for the rules scouts watch for.
	   Re-check it when a Team Update comes out. */
	reference: { label: "BIOBUZZ Competition Manual", url: "https://ftc-resources.firstinspires.org/ftc/game/manual" },

	match: {
		sections: [
			{
				id: "auto",
				title: "Autonomous (30 seconds)",
				help: "LEAVE (3 pts): the robot is no longer touching the perimeter wall. PARK (5 pts): it ends auto at least partly in its loading zone. A hive tip that finishes before teleop starts counts as auto (20 pts each).",
				fields: [
					{ id: "autoLeave", label: "Leaves in auto", type: "yesno" },
					{ id: "autoPark", label: "Parks in auto", type: "yesno" },
					{
						id: "autoStart", label: "Where auto starts", type: "choice",
						hint: "each hive starts tilted: one cell up, one cell down",
						options: [
							{ value: "first", label: "First side" },
							{ value: "second", label: "Second side", hint: "cell begins facing down" },
							{ value: "unsure", label: "Not sure" }
						]
					},
					{ id: "autoTips", label: "Hive tips it caused in auto", type: "count", max: 10, wide: true },
					{ id: "autoPollenHiveShot", label: "Pollen shot at the hive", type: "count", max: 99 },
					{ id: "autoPollenHiveScored", label: "Pollen scored in the hive", type: "count", max: 99 },
					{ id: "autoNectarHiveShot", label: "Nectar shot at the hive", type: "count", max: 99 },
					{ id: "autoNectarHiveScored", label: "Nectar scored in the hive", type: "count", max: 99 }
				]
			},
			{
				id: "tele",
				title: "Teleop: pollen",
				help: "Teleop is 2 minutes. Pollen can go in the hive, a flower or the garden. Flowers only score in the last 60 seconds, 2 pts per element for the alliance that owns the flower. A garden element is 1 pt.",
				fields: [
					{ id: "telePollenHiveShot", label: "Pollen shot at the hive", type: "count", max: 99 },
					{ id: "telePollenHiveScored", label: "Pollen scored in the hive", type: "count", max: 99 },
					{ id: "telePollenFlowerShot", label: "Pollen shot at a flower", type: "count", max: 99 },
					{ id: "telePollenFlowerScored", label: "Pollen scored in a flower", type: "count", max: 99 },
					{ id: "telePollenGardenShot", label: "Pollen shot at the garden", type: "count", max: 99 },
					{ id: "telePollenGardenScored", label: "Pollen scored in the garden", type: "count", max: 99 }
				]
			},
			{
				id: "teleNectar",
				title: "Teleop: nectar",
				help: "Each alliance has its own nectar colour, and a robot may not control the other alliance's nectar. Nectar can only be entered into a flower in the last 60 seconds. The alliance with the top-most nectar owns the flower; the bottom-most nectar earns 5 pts.",
				fields: [
					{ id: "teleNectarFlowerShot", label: "Nectar shot at a flower", type: "count", max: 99 },
					{ id: "teleNectarFlowerScored", label: "Nectar scored in a flower", type: "count", max: 99 },
					{ id: "teleNectarHiveShot", label: "Nectar shot at the hive", type: "count", max: 99 },
					{ id: "teleNectarHiveScored", label: "Nectar scored in the hive", type: "count", max: 99 },
					{ id: "teleNectarGardenShot", label: "Nectar shot at the garden", type: "count", max: 99 },
					{ id: "teleNectarGardenScored", label: "Nectar scored in the garden", type: "count", max: 99 }
				]
			},
			{
				id: "driving",
				title: "Teleop: robot",
				help: "Parking (5 pts) means ending the match at least partly in the loading zone. Each hive tip is 20 pts, and the alliance earns a ranking point at 4 tips and another at 7. Only pollen may be removed from a flower, and only from the bottom.",
				fields: [
					{ id: "teleTips", label: "Hive tips it caused in teleop", type: "count", max: 15, wide: true },
					{ id: "teleParks", label: "Parks at the end of teleop", type: "yesno" },
					{ id: "removesPollen", label: "Removed pollen from the bottom of a flower", type: "yesno" },
					{ id: "clearsGarden", label: "Cleared elements out of a garden", type: "yesno" },
					{
						id: "shootsFrom", label: "Where it shoots from", type: "multi",
						options: [
							{ value: "wall", label: "Up against the perimeter wall" },
							{ value: "hive", label: "Up close to the hive" },
							{ value: "mid", label: "Mid-field / somewhere else" }
						]
					},
					{ id: "blocker", label: "Played blocker", type: "yesno", hint: "blocking or pinning opponents" },
					{ id: "minorFouls", label: "Minor fouls (5 pts to the other side)", type: "count", max: 20 },
					{ id: "majorFouls", label: "Major fouls (20 pts to the other side)", type: "count", max: 20 },
					{ id: "breakdown", label: "Breakdown", type: "yesno" },
					{ id: "breakdownNote", label: "What broke?", type: "text", max: 120, showIf: { field: "breakdown", value: "yes" } },
					{ id: "driver", label: "Driver skill", type: "scale", hint: "1 = poor, 5 = excellent" }
				]
			},
			{
				id: "notes",
				title: "Notes",
				fields: [
					{ id: "notes", label: "Anything else worth telling the alliance?", type: "longtext", max: 500 }
				]
			}
		],

		/* Accuracy = scored / shot. */
		groups: [
			{ id: "autoPollen", label: "Auto pollen", scored: ["autoPollenHiveScored"], shot: ["autoPollenHiveShot"] },
			{ id: "autoNectar", label: "Auto nectar", scored: ["autoNectarHiveScored"], shot: ["autoNectarHiveShot"] },
			{ id: "telePollen", label: "Teleop pollen", scored: ["telePollenHiveScored", "telePollenFlowerScored", "telePollenGardenScored"], shot: ["telePollenHiveShot", "telePollenFlowerShot", "telePollenGardenShot"] },
			{ id: "teleNectar", label: "Teleop nectar", scored: ["teleNectarFlowerScored", "teleNectarHiveScored", "teleNectarGardenScored"], shot: ["teleNectarFlowerShot", "teleNectarHiveShot", "teleNectarGardenShot"] }
		],

		/* Points per count (or per "Yes"), from Table 10-2. Elements launched into the hive earn
		   nothing on their own: the hive pays for tips. Flower points assume the alliance owns the
		   flower, so this is an upper estimate of what one robot contributes. */
		points: {
			autoLeave: 3, autoPark: 5, teleParks: 5,
			autoTips: 20, teleTips: 20,
			telePollenFlowerScored: 2, teleNectarFlowerScored: 2,
			telePollenGardenScored: 1, teleNectarGardenScored: 1
		},

		/* Ranking points (non-Championship events): SWARM is an alliance's LEAVE + PARK points,
		   POLLINATOR 1 and 2 are alliance hive-tip counts. WIN is 3 RP and a TIE 1 RP. */
		rankingPoints: {
			swarm: { threshold: 16, fields: { autoLeave: 3, autoPark: 5, teleParks: 5 } },
			tipFields: ["autoTips", "teleTips"],
			pollinator: [4, 7]
		}
	},

	pit: {
		sections: [
			{
				id: "robot",
				title: "Robot",
				fields: [
					{
						id: "drivetrain", label: "Drivetrain", type: "choice",
						options: [
							{ value: "mecanum", label: "Mecanum" },
							{ value: "tank", label: "Tank / differential" },
							{ value: "swerve", label: "Swerve" },
							{ value: "other", label: "Other" }
						]
					},
					{
						id: "language", label: "Programming", type: "choice",
						options: [
							{ value: "java", label: "Java" },
							{ value: "blocks", label: "Blocks" },
							{ value: "kotlin", label: "Kotlin" },
							{ value: "other", label: "Other" }
						]
					},
					{ id: "cycleSeconds", label: "Typical cycle time", type: "number", unit: "seconds", min: 1, max: 120 },
					{ id: "reliability", label: "How reliable is it? (their word)", type: "scale", hint: "1 = breaks a lot, 5 = never breaks" }
				]
			},
			{
				id: "scoring",
				title: "What it can do",
				fields: [
					{
						id: "pollenScores", label: "Can score pollen in", type: "multi",
						options: [{ value: "hive", label: "Hive" }, { value: "flower", label: "Flower" }, { value: "garden", label: "Garden" }]
					},
					{
						id: "nectarScores", label: "Can score nectar in", type: "multi",
						options: [{ value: "hive", label: "Hive" }, { value: "flower", label: "Flower" }, { value: "garden", label: "Garden" }]
					},
					{ id: "canTipHive", label: "Can tip the hive", type: "yesno", hint: "launch into the upward-facing cell" },
					{ id: "tipsPerMatch", label: "Hive tips it aims for in a match", type: "number", min: 0, max: 15 },
					{ id: "claimsFlowers", label: "Can place nectar to claim flowers", type: "yesno" },
					{ id: "removesPollen", label: "Can remove pollen from the bottom of a flower", type: "yesno" },
					{ id: "clearsGarden", label: "Can clear elements out of a garden", type: "yesno" },
					{
						id: "shootsFrom", label: "Where it shoots from", type: "multi",
						options: [
							{ value: "wall", label: "Up against the perimeter wall" },
							{ value: "hive", label: "Up close to the hive" },
							{ value: "mid", label: "Mid-field / somewhere else" }
						]
					},
					{ id: "teleParks", label: "Can park at the end of teleop", type: "yesno" },
					{ id: "blocker", label: "Can play blocker", type: "yesno" }
				]
			},
			{
				id: "auto",
				title: "Autonomous",
				help: "A robot starts touching the perimeter wall on its own side, holding 4 pollen. Each hive starts with one cell tilted down; the second side starts with the cell it needs facing down.",
				fields: [
					{
						id: "autoRoutines", label: "What its auto does", type: "multi",
						options: [
							{ value: "leave", label: "Leaves" },
							{ value: "park", label: "Parks" },
							{ value: "tip", label: "Tips the hive" },
							{ value: "pollen", label: "Scores pollen" },
							{ value: "nectar", label: "Scores nectar" }
						]
					},
					{
						id: "autoStarts", label: "Where auto can start", type: "multi",
						options: [{ value: "first", label: "First side" }, { value: "second", label: "Second side", hint: "cell begins facing down" }]
					},
					{ id: "autoShootAfterTip", label: "Can shoot after a tip in auto", type: "yesno" }
				]
			},
			{
				id: "team",
				title: "Team",
				fields: [
					{
						id: "experience", label: "Driver experience", type: "choice",
						options: [{ value: "rookie", label: "Rookie" }, { value: "some", label: "1–2 seasons" }, { value: "veteran", label: "3+ seasons" }]
					},
					{ id: "notes", label: "Anything else worth knowing?", type: "longtext", max: 500 }
				]
			}
		]
	}
};

/* ----- helpers shared by the saving and the stats code ----- */

export const fieldsOf = kind => FTC_GAME[kind].sections.flatMap(section => section.fields);
const fieldMap = kind => new Map(fieldsOf(kind).map(field => [field.id, field]));

const MATCH_MAX = 999;
const TEAM_MAX = 99999;

/* Cleans what the form sent into what is stored, or throws a plain-English error.
   Unknown fields are dropped; every value is checked against its field's type. */
export function cleanAnswers(kind, input) {
	const fields = fieldMap(kind);
	const clean = {};

	for (const [id, field] of fields) {
		const value = input?.[id];
		if (value === undefined || value === null || value === "") continue;

		switch (field.type) {
			case "count": {
				const number = Number(value);
				if (!Number.isInteger(number) || number < 0 || number > (field.max ?? 999)) throw new Error(`${field.label} must be a whole number from 0 to ${field.max ?? 999}.`);
				clean[id] = number;
				break;
			}
			case "number": {
				const number = Number(value);
				if (!Number.isFinite(number) || number < (field.min ?? 0) || number > (field.max ?? 9999)) throw new Error(`${field.label} must be a number from ${field.min ?? 0} to ${field.max ?? 9999}.`);
				clean[id] = number;
				break;
			}
			case "scale": {
				const number = Number(value);
				if (!Number.isInteger(number) || number < 1 || number > 5) throw new Error(`${field.label} must be from 1 to 5.`);
				clean[id] = number;
				break;
			}
			case "yesno":
				if (value !== "yes" && value !== "no") throw new Error(`${field.label} must be Yes or No.`);
				clean[id] = value;
				break;
			case "choice":
				if (!field.options.some(option => option.value === value)) throw new Error(`${field.label} has an answer that isn't on the list.`);
				clean[id] = value;
				break;
			case "multi": {
				const picked = Array.isArray(value) ? value : [value];
				if (!picked.every(item => field.options.some(option => option.value === item))) throw new Error(`${field.label} has an answer that isn't on the list.`);
				clean[id] = [...new Set(picked)];
				break;
			}
			case "text":
			case "longtext": {
				/* Text starting = + - or @ would run as a formula if a report is opened in a spreadsheet. */
				let text = String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, field.max ?? 200);
				if (/^[=+\-@]/.test(text)) text = `'${text}`;
				if (text) clean[id] = text;
				break;
			}
		}
	}

	/* Every scored element was shot first, so "scored" can't be more than "shot". */
	for (const [id, field] of fields) {
		if (!/Scored$/.test(id) || clean[id] === undefined) continue;
		const shot = fields.get(id.replace(/Scored$/, "Shot"));
		if (shot && clean[id] > (clean[shot.id] ?? 0)) throw new Error(`${field.label} (${clean[id]}) can't be more than ${shot.label.toLowerCase()} (${clean[shot.id] ?? 0}).`);
	}

	return clean;
}

export function cleanTeam(value) {
	const number = Number(value);
	if (!Number.isInteger(number) || number < 1 || number > TEAM_MAX) throw new Error("Team number must be a whole number from 1 to 99999.");
	return number;
}

export function cleanMatchNumber(value) {
	const number = Number(value);
	if (!Number.isInteger(number) || number < 1 || number > MATCH_MAX) throw new Error("Match number must be a whole number from 1 to 999.");
	return number;
}

/* ----- stats ----- */

const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

/* Per-team stats from that team's match reports (no-shows left out) and its pit report. */
export function summarizeTeam(matchReports, pitReport) {
	const played = matchReports.filter(report => report.noShow !== "yes" && report.data);
	const noShows = matchReports.length - played.length;
	const fields = fieldsOf("match");
	const stats = {};

	for (const field of fields) {
		const values = played.map(report => report.data[field.id]).filter(value => value !== undefined);

		if (field.type === "count") {
			stats[field.id] = { avg: mean(values.map(Number)), max: values.length ? Math.max(...values) : null, total: values.reduce((sum, value) => sum + value, 0), n: values.length };
		} else if (field.type === "yesno") {
			stats[field.id] = { rate: values.length ? values.filter(value => value === "yes").length / values.length : null, n: values.length };
		} else if (field.type === "scale") {
			stats[field.id] = { avg: mean(values.map(Number)), n: values.length };
		} else if (field.type === "choice") {
			const counts = {};
			for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
			const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
			stats[field.id] = { counts, mode: top?.[0] ?? null, n: values.length };
		} else if (field.type === "multi") {
			const counts = {};
			for (const value of values.flat()) counts[value] = (counts[value] ?? 0) + 1;
			stats[field.id] = { counts, n: played.length };
		}
	}

	const groups = {};
	for (const group of FTC_GAME.match.groups) {
		const sum = ids => played.reduce((total, report) => total + ids.reduce((inner, id) => inner + (Number(report.data[id]) || 0), 0), 0);
		const scored = sum(group.scored);
		const shot = sum(group.shot);
		groups[group.id] = {
			scoredPerMatch: played.length ? scored / played.length : null,
			shotPerMatch: played.length ? shot / played.length : null,
			accuracy: shot ? scored / shot : null
		};
	}

	/* Pieces scored per match in auto and teleop, and scouted points if the game's points are filled in. */
	const sumIds = (report, test) => fields.filter(field => field.type === "count" && /Scored$/.test(field.id) && test(field.id)).reduce((total, field) => total + (Number(report.data[field.id]) || 0), 0);
	const autoPieces = played.map(report => sumIds(report, id => id.startsWith("auto")));
	const telePieces = played.map(report => sumIds(report, id => id.startsWith("tele")));

	/* A count is worth `value` each; a "Yes" is worth `value` once. */
	const worth = (report, id, value) => report.data[id] === "yes" ? value : (Number(report.data[id]) || 0) * value;
	const points = FTC_GAME.match.points;
	const hasPoints = Object.keys(points).length > 0;
	const pointsPerMatch = hasPoints
		? mean(played.map(report => Object.entries(points).reduce((total, [id, value]) => total + worth(report, id, value), 0)))
		: null;

	const ranking = FTC_GAME.match.rankingPoints;
	const tipsPerMatch = mean(played.map(report => ranking.tipFields.reduce((total, id) => total + (Number(report.data[id]) || 0), 0)));
	const swarmPerMatch = mean(played.map(report => Object.entries(ranking.swarm.fields).reduce((total, [id, value]) => total + worth(report, id, value), 0)));

	return {
		reports: played.length,
		noShows,
		stats,
		groups,
		autoPiecesPerMatch: mean(autoPieces),
		telePiecesPerMatch: mean(telePieces),
		pointsPerMatch,
		tipsPerMatch,
		swarmPerMatch,
		pit: pitReport?.data ?? null,
		flagged: matchReports.filter(report => report.flagged).length
	};
}

/* ----- one report as a row (CSV downloads and the Google Sheet use the same one) ----- */

/* An answer as people read it: option labels instead of stored values. */
export function readableAnswer(field, value) {
	if (value === undefined || value === null) return "";
	if (field.type === "yesno") return value === "yes" ? "Yes" : value === "no" ? "No" : "";
	const label = item => field.options?.find(option => option.value === item)?.label ?? item;
	if (field.type === "choice") return label(value);
	if (field.type === "multi") return (Array.isArray(value) ? value : [value]).map(label).join("; ");
	return value;
}

/* The heading row: who/when first, then every question as "Section: Question" (auto and teleop
   share some wording, so the section keeps the columns apart). */
export function reportHeadings(kind) {
	const questions = FTC_GAME[kind].sections.flatMap(section => section.fields.map(field => `${section.title}: ${field.label}`));
	return [...(kind === "match" ? ["Match", "Alliance", "No show"] : []), "Team", "Scout", "Flagged", "Saved", ...questions];
}

/* A saved report in the same order as the headings. */
export function reportCells(kind, report) {
	return [
		...(kind === "match" ? [report.matchNumber, report.alliance ?? "", report.noShow === "yes" ? "Yes" : "No"] : []),
		report.team, report.scout, report.flagged ? "Yes" : "", new Date(report.createdAt).toISOString(),
		...fieldsOf(kind).map(field => {
			const answer = readableAnswer(field, report.data[field.id]);
			/* A flagged report ("I think I messed this up") also says so at the start of its notes,
			   where it can't be missed in a spreadsheet. */
			return report.flagged && field.id === "notes" ? `[CHECK THIS REPORT] ${answer}`.trimEnd() : answer;
		})
	];
}
