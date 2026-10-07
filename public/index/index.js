
/* =================================
   DOM ELEMENTS
================================= */

const eventKeySelect =
	document.getElementById("EventKeys");

const teamNumberInput =
	document.getElementById("teamInput");

const results =
	document.getElementById("results");

const button =
	document.getElementById("button");


/* =================================
   GLOBAL DATA
================================= */

let eventKey = eventKeySelect.value;

/* "Entire Season" option in the event dropdown */
const SEASON_KEY = "season";

const SEASON_YEAR = [...eventKeySelect.options]
	.map(option => option.value)
	.find(value => /^\d{4}/.test(value))
	.slice(0, 4);

const teamData = {};

let scoutingData = [];

let pitScoutingData = [];


/* =================================
   DATA HELPERS
================================= */

function resetTeamData() {
	for (const teamKey of Object.keys(teamData)) {
		delete teamData[teamKey];
	}
}


function getTeam(teamKey) {

	if (!teamData[teamKey]) {

		teamData[teamKey] = {
			teamKey,
			opr: null,
			dpr: null,
			ccwm: null,
			rank: null,
			record: null,
			matches: []
		};

	}

	return teamData[teamKey];

}


function averageColumn(rows, columnName) {

	const values = rows

		.filter(row =>
			String(row["No Show"])
				.toUpperCase() !== "TRUE"
		)

		.map(row =>
			String(row[columnName] ?? "").trim()
		)

		.filter(value => value !== "")

		.map(Number)

		.filter(Number.isFinite);


	if (values.length === 0) {
		return null;
	}


	return values.reduce(
		(sum, value) => sum + value,
		0
	) / values.length;

}


function truePercentage(rows, columnName) {

	const answers = rows

		.map(row =>
			String(row[columnName] ?? "")
				.trim()
				.toUpperCase()
		)

		.filter(value =>
			value === "TRUE" ||
			value === "FALSE"
		);


	if (answers.length === 0) {
		return null;
	}


	const trueCount =
		answers.filter(value => value === "TRUE").length;


	return (trueCount / answers.length) * 100;

}


function formatAverage(value) {

	return Number.isFinite(value)
		? value.toFixed(1)
		: "Not available";

}


function escapeHtml(value) {

	return escapeChartText(value);

}


function finiteNumberOrNull(value) {

	const number = Number(value);


	return Number.isFinite(number)
		? number
		: null;

}


function consistencyScore(
	rows,
	columnName,
	minScore = 1,
	maxScore = 5
) {

	const scores = rows

		.filter(row =>
			String(row["No Show"])
				.toUpperCase() !== "TRUE"
		)

		.map(row =>
			Number(row[columnName])
		)

		.filter(Number.isFinite);


	if (scores.length < 2) {
		return null;
	}


	const average =
		scores.reduce(
			(sum, score) => sum + score,
			0
		) / scores.length;


	const variance =
		scores.reduce(
			(sum, score) =>
				sum + (score - average) ** 2,
			0
		) / scores.length;


	const standardDeviation =
		Math.sqrt(variance);


	const maximumDeviation =
		(maxScore - minScore) / 2;


	return Math.max(
		0,
		Math.min(
			100,
			100 *
			(1 - standardDeviation / maximumDeviation)
		)
	);

}

function defenceMatchesPlayed(rows, columnName) {

	const scores = rows

		.filter(row =>
			String(row["No Show"])
				.toUpperCase() !== "TRUE"
		)

		.map(row =>
			Number(row[columnName])
		)

		.filter(Number.isFinite);


	return scores.length;


}


/* =================================
   LOAD SCOUTING DATA
================================= */

let stats = null;
async function loadScoutingData() {
	const url = `/api/scouting/${eventKey}`;
	const response = await fetch(url);
	const text = await response.text();

	let data;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error(
			`${url} returned HTML instead of JSON (HTTP ${response.status}). ` +
			"Open the site at http://localhost:3000."
		);
	}

	if (!response.ok) {
		throw new Error(data.error || "Could not load scouting data");
	}

	if (!Array.isArray(data)) {
		throw new Error("Scouting API did not return an array");
	}

	scoutingData = data;
}

async function loadPitScoutingData() {
	const url = `/api/pitscouting/${eventKey}`;
	const response = await fetch(url);
	const text = await response.text();

	let data;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error(
			`${url} returned HTML instead of JSON (HTTP ${response.status}). ` +
			"Open the site at http://localhost:3000."
		);
	}

	if (!response.ok) {
		throw new Error(data.error || "Could not load scouting data");
	}

	if (!Array.isArray(data)) {
		throw new Error("Scouting API did not return an array");
	}

	pitScoutingData = data;
}
/* =================================
   LOAD EVENT DATA
================================= */

async function loadEventData() {

	const [
		matchesResponse,
		rankingsResponse,
		oprsResponse
	] = await Promise.all([

		fetch(
			`/api/events/${eventKey}/matches`
		),

		fetch(
			`/api/events/${eventKey}/rankings`
		),

		fetch(
			`/api/events/${eventKey}/oprs`
		)

	]);


	/* An event with no TBA data yet (or a test event) returns an error:
	   treat that as empty so scouting data can still be shown. */
	const jsonOrNull = async response =>
		response.ok
			? response.json().catch(() => null)
			: null;

	const matches =
		await jsonOrNull(matchesResponse) ?? [];

	const rankings =
		await jsonOrNull(rankingsResponse) ?? [];

	stats =
		await jsonOrNull(oprsResponse) ?? {};


	/* OPR / DPR / CCWM */


	for (
		const [teamKey, opr]
		of Object.entries(stats.oprs || {})
	) {

		const team =
			getTeam(teamKey);


		team.opr =
			opr;

		team.dpr =
			stats.dprs?.[teamKey];

		team.ccwm =
			stats.ccwms?.[teamKey];

	}


	/* Rankings */

	if (Array.isArray(rankings)) {

		for (const ranking of rankings) {

			const team =
				getTeam(ranking.team_key);


			team.rank =
				ranking.rank;

			team.record =
				ranking.record;

		}

	}


	/* Matches */

	for (const match of Array.isArray(matches) ? matches : []) {

		const teamsInMatch = [

			...(match.red?.team_keys ?? []),
			...(match.blue?.team_keys ?? [])

		];


		for (const teamKey of teamsInMatch) {

			getTeam(teamKey)
				.matches
				.push(match);

		}

	}

}


/* =================================
   STATBOTICS
================================= */

async function loadStatboticsEPA(
	teamNumber,
	eventKey
) {

	const response =
		await fetch(
			`/api/statbotics/team-event/${teamNumber}/${eventKey}`
		);


	const data =
		await response.json();


	if (!response.ok) {

		throw new Error(
			data.error ||
			"Statbotics EPA is unavailable"
		);

	}

	return data;

}


async function loadStatboticsMatchHistory(
	teamNumber,
	eventKey
) {

	const response =
		await fetch(
			`/api/statbotics/team-matches/${teamNumber}/${eventKey}`
		);


	const data =
		await response.json();


	if (!response.ok) {

		throw new Error(
			data.error ||
			"Statbotics match history is unavailable"
		);

	}


	return Array.isArray(data)
		? data
		: [];

}


function teamIsOnAlliance(teamNumber, teamKeys) {

	return (teamKeys || []).some(team =>
		String(team) === String(teamNumber)
	);

}


function probabilityToUnit(value) {

	const probability = Number(value);


	if (!Number.isFinite(probability)) {
		return null;
	}


	const unitProbability =
		probability > 1
			? probability / 100
			: probability;


	return unitProbability >= 0 && unitProbability <= 1
		? unitProbability
		: null;

}


function clutchFactor(matches, teamNumber) {

	const matchResults = [];


	for (const match of matches) {

		const redTeams = match.alliances?.red?.team_keys ?? [];
		const blueTeams = match.alliances?.blue?.team_keys ?? [];

		const alliance =
			teamIsOnAlliance(teamNumber, redTeams)
				? "red"
				: teamIsOnAlliance(teamNumber, blueTeams)
					? "blue"
					: null;

		const redWinProbability =
			probabilityToUnit(match.pred?.red_win_prob);


		if (!alliance || redWinProbability === null) {
			continue;
		}


		const redScore = Number(match.result?.red_score);
		const blueScore = Number(match.result?.blue_score);
		const winner = String(match.result?.winner ?? "").toLowerCase();

		let outcome = null;


		if (winner === "red" || winner === "blue") {
			outcome = winner === alliance ? 1 : 0;
		} else if (
			Number.isFinite(redScore) &&
			Number.isFinite(blueScore)
		) {
			if (redScore === blueScore) {
				outcome = 0.5;
			} else {
				const winningAlliance =
					redScore > blueScore
						? "red"
						: "blue";

				outcome = winningAlliance === alliance ? 1 : 0;
			}
		}


		if (outcome === null) {
			continue;
		}


		const winProbability =
			alliance === "red"
				? redWinProbability
				: 1 - redWinProbability;




		const predictedRedScore = Number(match.pred?.red_score);
		const predictedBlueScore = Number(match.pred?.blue_score);

		let ownScoreDelta = null;
		let opponentScoreDelta = null;

		if (
			Number.isFinite(redScore) &&
			Number.isFinite(blueScore) &&
			Number.isFinite(predictedRedScore) &&
			Number.isFinite(predictedBlueScore)
		) {

			const actualOwnScore =
				alliance === "red" ? redScore : blueScore;

			const predictedOwnScore =
				alliance === "red" ? predictedRedScore : predictedBlueScore;

			const actualOpponentScore =
				alliance === "red" ? blueScore : redScore;

			const predictedOpponentScore =
				alliance === "red" ? predictedBlueScore : predictedRedScore;

			ownScoreDelta = actualOwnScore - predictedOwnScore;
			opponentScoreDelta = actualOpponentScore - predictedOpponentScore;

		}


		matchResults.push({
			outcome,
			winProbability,
			ownScoreDelta,
			opponentScoreDelta
		});

	}


	if (matchResults.length === 0) {
		return null;
	}


	const actualWins =
		matchResults.reduce(
			(total, match) => total + match.outcome,
			0
		);

	const expectedWins =
		matchResults.reduce(
			(total, match) => total + match.winProbability,
			0
		);

	const scoreResults =
		matchResults.filter(match => match.ownScoreDelta !== null);

	const averageOwnScoreDelta =
		scoreResults.length
			? scoreResults.reduce(
				(total, match) => total + match.ownScoreDelta,
				0
			) / scoreResults.length
			: null;

	const averageOpponentScoreDelta =
		scoreResults.length
			? scoreResults.reduce(
				(total, match) => total + match.opponentScoreDelta,
				0
			) / scoreResults.length
			: null;

	return {
		matches: matchResults.length,
		actualWins,
		expectedWins,
		winScore: ((actualWins - expectedWins) / matchResults.length) * 100,
		scoreMatches: scoreResults.length,
		averageOwnScoreDelta,
		averageOpponentScoreDelta
	};

}


function formatClutchFactor(clutch) {

	if (!clutch) {
		return "—";
	}


	const sign = clutch.winScore > 0 ? "+" : "";


	return `${sign}${clutch.winScore.toFixed(1)}%`;

}


function formatOwnScoreDelta(clutch) {

	if (!clutch || clutch.averageOwnScoreDelta === null) {
		return "—";
	}

	const sign = clutch.averageOwnScoreDelta > 0 ? "+" : "";

	return `${sign}${clutch.averageOwnScoreDelta.toFixed(1)} pts`;

}


/* =================================
   RENDER TEAM
================================= */

async function printTeamData() {
	const teamNumber =
		teamNumberInput.value.trim();

	if (!teamNumber) {
		results.innerHTML = `
          <div class="empty-state">
            Enter a team number, then press "View Team".
          </div>
        `;

		return;
	}

	saveTeamsInUrl(teamNumber);

	const teamKey =
		`frc${teamNumber}`;

	const team =
		teamData[teamKey];


	const scoutingRows = scoutingData.filter(row =>
		String(row["Team Number"] ?? "").trim() === teamNumber
	);

	const pitScoutingRows =
		pitScoutingData.filter(row =>
			String(row["Team Number of Team Being Scouted"] ?? "").trim()
			=== teamNumber
		);


	if (!team && scoutingRows.length === 0 && pitScoutingRows.length === 0) {
		results.innerHTML = `
    <div class="empty-state">
      No TBA, match-scouting, or pit-scouting data found for team ${teamNumber}.
    </div>
  `;
		return;
	}

	function firstTextValue(rows, columnName) {
		return rows
			.map(row => String(row[columnName] ?? "").trim())
			.find(value => value !== "") ?? null;
	}

	/* Scouting calculations */

	const averageAuto =
		averageColumn(
			scoutingRows,
			"Auto Scoring Points"
		);


	const averageTeleop =
		averageColumn(
			scoutingRows,
			"Teleop Scoring Points"
		);


	const averageTotalPoints =

		averageAuto !== null &&
			averageTeleop !== null

			? averageAuto + averageTeleop

			: null;


	const averageDefenseScore =
		averageColumn(
			scoutingRows,
			"Defense Rating from 1 (incredible) to 5 (poor)"
		);


	const defenseConsistency =
		consistencyScore(
			scoutingRows,
			"Defense Rating from 1 (incredible) to 5 (poor)"
		);


	const defendedPercentage =
		truePercentage(
			scoutingRows,
			"Robot was defended"
		);

	let driveType = firstTextValue(
		pitScoutingRows,
		"What type of drive base does your robot have?"
	);
	const coolestThing = firstTextValue(
		pitScoutingRows,
		"What is the coolest thing about your robot or robot cart?"
	)

	const preferredStart = firstTextValue(
		pitScoutingRows,
		"Preferred Starting Location"
	)

	const matchesPlayingDefence = defenceMatchesPlayed(
		scoutingRows,
		"Defense Rating from 1 (incredible) to 5 (poor)"
	)

	const trench = firstTextValue(
		pitScoutingRows,
		"Can your robot drive under the trench?"
	)

	const bump = firstTextValue(
		pitScoutingRows,
		"Can your robot drive over the bump?"
	)

	const okPlayingDefence = firstTextValue(
		pitScoutingRows,
		"If strategy required; would you be open to playing defense?"
	)

	const programmingLanguage = firstTextValue(
		pitScoutingRows,
		"What language is your robot programmed in?"
	);



	/* EPA */

	let statbotics = null;
	let statboticsMatches = [];


	try {

		statbotics =
			await loadStatboticsEPA(
				teamNumber,
				eventKey
			);

	} catch (error) {

		console.log(
			"Statbotics error:",
			error.message
		);

	}


	try {

		statboticsMatches =
			await loadStatboticsMatchHistory(
				teamNumber,
				eventKey
			);

	} catch (error) {

		console.log(
			"Statbotics match-history error:",
			error.message
		);

	}


	const opr =
		team?.opr ?? null;


	const epa =
		statbotics
			?.epa
			?.total_points
			?.mean ?? null;

	const tbaTeamName = await fetch(`/api/teamName/${teamNumber}`)
		.then(response => response.ok ? response.json() : {})
		.then(data => data.name ?? null)
		.catch(() => null);

	const teamClutchFactor =
		clutchFactor(
			statboticsMatches,
			teamNumber
		);

	const oprValues = Object.values(stats?.oprs || {})
		.map(Number)
		.filter(Number.isFinite);

	const eventAverageOpr =
		oprValues.length
			? oprValues.reduce((sum, opr) => sum + opr, 0) / oprValues.length
			: null;

	const topTen = [...oprValues]
		.sort((a, b) => b - a)
		.slice(0, 10);

	const topTenAverageOpr =
		topTen.length
			? topTen.reduce((sum, opr) => sum + opr, 0) / topTen.length
			: null;



	const topTenMultiplier =
		topTenAverageOpr / eventAverageOpr;

	const sortedOprs = [...oprValues]
		.sort((a, b) => b - a);

	const sixteenBestOpr = sortedOprs[15];



	const sixteenBestMultiplier =
		sixteenBestOpr / eventAverageOpr;

	const highestOPR = sortedOprs[0] ?? null;

	const qualRecord = statbotics?.record?.qual ?? null;
	const elimRecord = statbotics?.record?.elim ?? null;
	const totalStatboticsRecord = statbotics?.record?.total ?? null;

	const recordQuals =
		Number.isFinite(qualRecord?.wins) &&
			Number.isFinite(qualRecord?.losses)
			? `${qualRecord.wins}-${qualRecord.losses}`
			: null;

	const recordElims =
		Number.isFinite(elimRecord?.wins) &&
			Number.isFinite(elimRecord?.losses)
			? `${elimRecord.wins}-${elimRecord.losses}`
			: null;

	const totalRecord =
		Number.isFinite(qualRecord?.wins) &&
			Number.isFinite(qualRecord?.losses) &&
			Number.isFinite(elimRecord?.wins) &&
			Number.isFinite(elimRecord?.losses)
			? `${qualRecord.wins + elimRecord.wins}-${qualRecord.losses + elimRecord.losses}`
			: null;

	const winRate =
		finiteNumberOrNull(totalStatboticsRecord?.winrate) === null
			? null
			: finiteNumberOrNull(totalStatboticsRecord.winrate) * 100;

	const totalEPA =
		finiteNumberOrNull(
			statbotics?.epa?.total_points?.mean ??
			statbotics?.epa?.total_points
		);

	const teamName =
		statbotics?.team_name ?? tbaTeamName ??
		`Team ${teamNumber}`;

	const autoEPA =
		finiteNumberOrNull(
			statbotics?.epa?.breakdown?.auto_points
		);

	const teleopEPA =
		finiteNumberOrNull(
			statbotics?.epa?.breakdown?.teleop_points
		);

	const endgameEPA =
		finiteNumberOrNull(
			statbotics?.epa?.breakdown?.endgame_points
		);

	const trendPoints = performanceTrendPoints(scoutingRows);

	function averagePowerRating() {
		let totalPoints = 0;
		let numEntries = 0;

		if (totalEPA != null) {
			totalPoints += totalEPA;
			numEntries++;
		} if (opr != null) {
			totalPoints += opr;
			numEntries++;
		} if (averageTotalPoints != null) {
			totalPoints += averageTotalPoints;
			numEntries++;
		}

		return numEntries ? totalPoints / numEntries : null;
	}

	function estimatePick() {
		let pick = "";

		if (opr >= sixteenBestOpr) {
			pick = "1st"
		} else if (String(driveType ?? "").toLowerCase().includes("tank")) {
			pick = "dnp"
		}

		return pick;
	}

	function determineOPRRank() {
		let rank = "—";

		for (let i = 0; i < sortedOprs.length; i++) {
			if (opr !== null && opr === sortedOprs[i]) {
				rank = i + 1;
				break;
			}
		}

		return rank;
	}

	const teamImage = `https://www.thebluealliance.com/avatar/2026/frc${teamNumber}.png`;

	showTeamMedia(teamNumber, eventKey.slice(0, 4));

	/* RENDER */

	results.innerHTML = `

      <div class="team-hero">
        <div class="team-heading">
			<div class="team-heading-container">
				<h2>Team ${escapeHtml(teamNumber)}: ${escapeHtml(teamName)}</h2>
				<img class="teamImage" src=${teamImage}></img>
			</div>

          <span>
            ${scoutingRows.length}
            scouting matches recorded • EPA, OPR and Scouting Average Score: ${averagePowerRating() === null
			? "—"
			: averagePowerRating().toFixed(2)
		}
          </span>

          <div class="team-actions">
            <a class="back-link" href="${escapeHtml(eventRankingsUrl(teamNumber))}">View in event rankings →</a>
            ${BTB_LINK_SLOT}
          </div>

        </div>
        ${ROBOT_PHOTO_SLOT}
      </div>

        <!-- TOP STATISTICS -->

        <section class="top-stats">
          <div class="stat-card">

            <div class="stat-label">
              OPR
            </div>

            <div class="stat-value">
              ${opr !== null
			? opr.toFixed(2)
			: "—"
		}
            </div>

            <div class="stat-description">
              Official event offensive power rating
            </div>

          </div>


          <div class="stat-card">

            <div class="stat-label">
              Average Points
            </div>

            <div class="stat-value">
              ${averageTotalPoints !== null
			? averageTotalPoints.toFixed(2)
			: "—"
		}
            </div>

            <div class="stat-description">
              Average auto + teleop points from scouting
            </div>

          </div>


          <div class="stat-card">

            <div class="stat-label">
              EPA
            </div>

            <div class="stat-value">
              ${totalEPA !== null
			? totalEPA.toFixed(2)
			: "—"
		}
            </div>

            <div class="stat-description">
              Statbotics event EPA
            </div>

          </div>

        </section>

        ${performanceTrendChart(trendPoints, "Scouting average by match")}

        <!-- Event Results -->

        <h3 class="section-title">Event Results</h3>

        <section class="data-grid">

           <div class="data-item">

            <div class="data-item-label">
              Matches Played
            </div>

            <div class="data-item-value">
              ${team?.matches?.length ?? 0
		}
            </div>

          </div>

          <div class="data-item">

            <div class="data-item-label">
              record
            </div>

            <div class="data-item-value">
              ${totalRecord !== null ?
			totalRecord :
			"—"
		}
            </div>

          </div>

          <div class="data-item">

            <div class="data-item-label">
              Quals Record
            </div>

            <div class="data-item-value">
              ${recordQuals !== null ?
			recordQuals :
			"—"
		}
            </div>

          </div>

          <div class="data-item">

            <div class="data-item-label">
              Win Rate
            </div>

            <div class="data-item-value">
              ${winRate !== null ?
			winRate.toFixed(0) + "%" :
			"—"
		}
            </div>

          </div>

          <div class="data-item">

            <div class="data-item-label">
              Clutch Factor
            </div>

            <div class="data-item-value">
              ${formatClutchFactor(teamClutchFactor)}
            </div>

            <div class="data-item-description">
              ${teamClutchFactor
			? `${teamClutchFactor.actualWins.toFixed(1)} actual wins vs ${teamClutchFactor.expectedWins.toFixed(1)} expected over ${teamClutchFactor.matches} completed matches`
			: "No completed Statbotics match predictions available"
		}
            </div>

          </div>

          <div class="data-item">

  <div class="data-item-label">
Own Score vs Prediction  </div>

  <div class="data-item-value">
  ${formatOwnScoreDelta(teamClutchFactor)}
</div>

<div class="data-item-description">
  ${teamClutchFactor && teamClutchFactor.averageOwnScoreDelta !== null
			? `Averaged over ${teamClutchFactor.scoreMatches} matches with score predictions`
			: "No Statbotics score predictions available"
		}
</div>

</div>
        </section>


        <!-- EVENT DATA -->

        <h3 class="section-title">
          <a href="https://www.thebluealliance.com/team/${teamNumber}" 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      class="external-link">TBA</a> and <a href="https://www.statbotics.io/team/${teamNumber}" 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      class="external-link">Statbotics</a> Statistics
        </h3>

        <section class="data-grid">

       

          <div class="data-item">

            <div class="data-item-label">
              OPR rank
            </div>

            <div class="data-item-value">
              ${determineOPRRank()}
            </div>

          </div>


          <div class="data-item">

            <div class="data-item-label">
              Defensive Power Rating
            </div>

            <div class="data-item-value">
              ${team?.dpr !== null &&
			team?.dpr !== undefined
			? team.dpr.toFixed(2)
			: "—"
		}
            </div>

          </div>


          <div class="data-item">

            <div class="data-item-label">
              Calculated Contribution to Winning Margin
            </div>

            <div class="data-item-value">
              ${team?.ccwm !== null &&
			team?.ccwm !== undefined
			? team.ccwm.toFixed(2)
			: "—"
		}
            </div>

          </div>

          

          <div class="data-item">

            <div class="data-item-label">
              Estimated Auto EPA
            </div>

            <div class="data-item-value">
              ${autoEPA === null ? "—" : autoEPA.toFixed(1)}
            </div>

          </div>


          <div class="data-item">

            <div class="data-item-label">
              Estimated Teleop EPA
            </div>

            <div class="data-item-value">
              ${teleopEPA === null ? "—" : teleopEPA.toFixed(1)}
            </div>

          </div>
          <div class="data-item">

            <div class="data-item-label">
              Estimated Endgame EPA
            </div>

            <div class="data-item-value">
              ${endgameEPA === null ? "—" : endgameEPA.toFixed(1)}
            </div>

          </div>


          


         

        </section>


        <!-- SCOUTING AVERAGES -->

        <h3 class="section-title">
          Scouting Averages
        </h3>

        

        <section class="data-grid">

          
          <div class="data-item">

            <div class="data-item-label">
              Auto Points
            </div>

            <div class="data-item-value">
              ${formatAverage(averageAuto)}
            </div>

          </div>


          <div class="data-item">

            <div class="data-item-label">
              Teleop Points
            </div>

            <div class="data-item-value">
              ${formatAverage(averageTeleop)}
            </div>

          </div>


          <div class="data-item">

            <div class="data-item-label">
              Defence Score
            </div>

            <div class="data-item-value">
              ${formatAverage(averageDefenseScore)}
            </div>

          </div>

    


          <div class="data-item">

            <div class="data-item-label">
              Defence Consistency
            </div>

            <div class="data-item-value">
              ${defenseConsistency === null
			? "Not enough matches"
			: `${defenseConsistency.toFixed(0)}%` + " over " + matchesPlayingDefence + " matches"
		}
            </div>

          </div>
          <div class="data-item">

            <div class="data-item-label">
              Was Defended
            </div>

            <div class="data-item-value">
              ${defendedPercentage === null
			? "—"
			: `${defendedPercentage.toFixed(0)}%`
		}
            </div>

          </div>


          


          

        </section>

        <!-- Event Stats -->

        <h3 class="section-title">
          Event Statistics
        </h3>

        

        <section class="data-grid">

          
          <div class="data-item">

            <div class="data-item-label">
              Average Event OPR
            </div>

            <div class="data-item-value">
              ${formatAverage(eventAverageOpr)}
            </div>

          </div>


          <div class="data-item">

            <div class="data-item-label">
              Top Ten Average Event OPR
            </div>

            <div class="data-item-value">
              ${formatAverage(topTenAverageOpr)}
            </div>

          </div>
          
          

          <div class="data-item">

            <div class="data-item-label">
              Highest Event OPR
            </div>

            <div class="data-item-value">
              ${highestOPR === null ? "—" : highestOPR.toFixed(2)}
            </div>

          </div>

        </section>

        <!-- PIT SCOUTING -->
        <h3 class="section-title">
          Pit Scouting
        </h3>

        

        <section class="data-grid">
          
        <div class="data-item">

            <div class="data-item-label">
              Drive Type
            </div>

            <div class="data-item-value">
              ${driveType === null ? "—" : escapeHtml(driveType)}
            </div>

          </div>

          <div class="data-item">

            <div class="data-item-label">
              Can drive under trench
            </div>

            <div class="data-item-value">
              ${trench === null ? "—" : escapeHtml(trench)}
            </div>

          </div>

          <div class="data-item">

            <div class="data-item-label">
              Can drive over bump
            </div>

            <div class="data-item-value">
              ${bump === null ? "—" : escapeHtml(bump)}
            </div>

          </div>

          <div class="data-item">

            <div class="data-item-label">
              preferred start location
            </div>

            <div class="data-item-value">
              ${preferredStart === null ? "—" : escapeHtml(preferredStart)}
            </div>

          </div>

          <div class="data-item">

            <div class="data-item-label">
              Would be ok playing defence
            </div>

            <div class="data-item-value">
              ${okPlayingDefence === null ? "—" : escapeHtml(okPlayingDefence)}
            </div>

          </div>

          <div class="data-item">

            <div class="data-item-label">
              Programming LAnguage
            </div>

            <div class="data-item-value">
              ${programmingLanguage === null ? "—" : escapeHtml(programmingLanguage)}
            </div>

          </div>

          <div class="data-item">

            <div class="data-item-label">
              Coolest thing about robot or robot cart
            </div>

            <div class="data-item-value">
              ${coolestThing === null ? "—" : escapeHtml(coolestThing)}
            </div>

          </div>
        
          </section>

        <!-- INDIVIDUAL SCOUTING -->

        <h3 class="section-title">
          Individual Scouting Reports
        </h3>


        ${scoutingRows.length

			? `

              <section class="scouting-list">

                ${scoutingRows.map((row, index) => `

                  <article class="scouting-card">

                    <div class="scouting-card-header">
                      Match ${escapeHtml(String(row["Match Number"] ?? "").trim() || index + 1)}
                    </div>

                    ${Object.entries(row)
					.map(([column, value]) => `

                        <div class="scouting-row">

                          <span>
                            ${escapeHtml(column)}
                          </span>

                          <strong>
							${value === "TRUE"
								? `<span class="scout-true">TRUE</span>`
								: value === "FALSE"
									? `<span class="scout-false">FALSE</span>`
									: escapeHtml(value || "—")}
                          </strong>

                        </div>

                      `)
					.join("")}

                  </article>

                `).join("")}

              </section>

            `

			: `

              <div class="empty-state">
                No scouting entries found for this team.
              </div>

            `
		}

      `;

}


/* =================================
   RENDER SEASON
================================= */

const PIT_SCOUTING_QUESTIONS = [
	["Drive Type", "What type of drive base does your robot have?"],
	["Can drive under trench", "Can your robot drive under the trench?"],
	["Can drive over bump", "Can your robot drive over the bump?"],
	["Preferred start location", "Preferred Starting Location"],
	["Would be ok playing defence", "If strategy required; would you be open to playing defense?"],
	["Programming Language", "What language is your robot programmed in?"],
	["Coolest thing about robot or robot cart", "What is the coolest thing about your robot or robot cart?"]
];


function formatNumber(value, digits = 1) {

	return Number.isFinite(value)
		? value.toFixed(digits)
		: "—";

}


function formatRecord(record) {

	return Number.isFinite(record?.wins) && Number.isFinite(record?.losses)
		? `${record.wins}-${record.losses}-${record.ties ?? 0}`
		: "—";

}


function formatStatboticsRank(rank) {

	return Number.isFinite(rank?.rank)
		? `${rank.rank} of ${rank.team_count}`
		: "—";

}


function dataItem(label, value, description = "") {

	return `
          <div class="data-item">
            <div class="data-item-label">${label}</div>
            <div class="data-item-value">${value}</div>
            ${description ? `<div class="data-item-description">${description}</div>` : ""}
          </div>`;

}


/* =================================
   ROBOT PHOTO + BEHIND THE BUMPERS
================================= */

const ROBOT_PHOTO_SLOT = `
        <a class="robot-photo" target="_blank" rel="noopener noreferrer" hidden>
          <img alt="">
          <span>Robot photo • The Blue Alliance</span>
        </a>`;

const BTB_LINK_SLOT = `
            <a class="back-link btb-link" target="_blank" rel="noopener noreferrer" hidden>▶ Behind the Bumpers</a>
            <span class="btb-past" hidden></span>`;

/* Fills in the team's TBA robot photo and Behind the Bumpers video for that
   year. Each stays hidden if TBA doesn't have it, the photo fails to load, or
   the user has since moved on to another team. */
async function showTeamMedia(teamNumber, year) {

	try {
		const response = await fetch(`/api/teams/${encodeURIComponent(teamNumber)}/media/${year}`);
		const media = await response.json();

		if (!response.ok) {
			return;
		}

		/* Wait for the results to render, then make sure they're still this team's. */
		await new Promise(resolve => setTimeout(resolve));

		if (teamNumberInput.value.trim() !== String(teamNumber)) {
			return;
		}

		const photoSlot = results.querySelector(".robot-photo");

		if (photoSlot && media.url) {
			const image = photoSlot.querySelector("img");
			image.alt = `Team ${teamNumber}'s ${year} robot`;
			image.addEventListener("load", () => { photoSlot.hidden = false; }, { once: true });
			image.src = media.url;

			if (media.viewUrl) {
				photoSlot.href = media.viewUrl;
			}
		}

		const videoLink = results.querySelector(".btb-link");

		if (videoLink && media.behindTheBumpers) {
			videoLink.href = media.behindTheBumpers.url;
			videoLink.title = media.behindTheBumpers.title;
			videoLink.hidden = false;
		}

		/* Earlier seasons' episodes, newest first, e.g. "Past seasons: 2025 · 2024". */
		const pastLinks = results.querySelector(".btb-past");
		const past = media.pastBehindTheBumpers ?? [];

		if (pastLinks && past.length) {
			pastLinks.innerHTML = `${media.behindTheBumpers ? "Past seasons:" : "▶ Behind the Bumpers:"} ${past
				.map(episode => `<a href="${escapeHtml(episode.url)}" title="${escapeHtml(episode.title)}" target="_blank" rel="noopener noreferrer">${escapeHtml(episode.season)}</a>`)
				.join(" · ")}`;
			pastLinks.hidden = false;
		}
	} catch {
		/* Media is optional; the page works without it. */
	}

}


/* Every event scouting sheet the team appears in; events without a sheet return []. */
async function loadSheetRowsForEvents(events, path) {

	const perEvent = await Promise.all(events.map(event =>
		fetch(`/api/${path}/${event.key}`)
			.then(response => response.ok ? response.json() : [])
			.catch(() => [])
	));

	return events.map((event, index) => ({
		event,
		rows: Array.isArray(perEvent[index]) ? perEvent[index] : []
	}));

}


async function printSeasonData() {

	const teamNumber =
		teamNumberInput.value.trim();

	if (!teamNumber) {
		results.innerHTML = `
          <div class="empty-state">
            Enter a team number, then press "View Team" to see their whole season.
          </div>
        `;

		return;
	}

	saveTeamsInUrl(teamNumber);

	const response = await fetch(`/api/teams/${teamNumber}/season/${SEASON_YEAR}`);
	const season = await response.json().catch(() => ({}));

	if (!response.ok) {
		throw new Error(season.error || "Could not load season data");
	}

	const events = season.events ?? [];

	const [scoutingByEvent, pitByEvent] = await Promise.all([
		loadSheetRowsForEvents(events, "scouting"),
		loadSheetRowsForEvents(events, "pitscouting")
	]);

	const scoutingRowsByEvent = scoutingByEvent.map(({ event, rows }) => ({
		event,
		rows: rows.filter(row =>
			String(row["Team Number"] ?? "").trim() === teamNumber
		)
	}));

	const scoutingRows =
		scoutingRowsByEvent.flatMap(({ rows }) => rows);

	/* Most recent event with a pit-scouting entry wins. */
	const latestPit = pitByEvent
		.map(({ event, rows }) => ({
			event,
			rows: rows.filter(row =>
				String(row["Team Number of Team Being Scouted"] ?? "").trim() === teamNumber
			)
		}))
		.reverse()
		.find(({ rows }) => rows.length);

	const scoutingAverageFor = rows => {
		const totals = performanceTrendPoints(rows).map(point => point.scouting);

		return totals.length
			? totals.reduce((sum, total) => sum + total, 0) / totals.length
			: null;
	};

	const averageAuto =
		averageColumn(scoutingRows, "Auto Scoring Points");

	const averageTeleop =
		averageColumn(scoutingRows, "Teleop Scoring Points");

	const averageTotalPoints =
		averageAuto !== null && averageTeleop !== null
			? averageAuto + averageTeleop
			: null;

	const playedRows = scoutingRows.filter(row =>
		String(row["No Show"] ?? "").trim().toUpperCase() !== "TRUE"
	);

	/* % of played matches where a numeric column was above zero (e.g. any climb). */
	const nonZeroPercentage = columnName => {
		const values = playedRows
			.map(row => String(row[columnName] ?? "").trim())
			.filter(value => value !== "")
			.map(Number)
			.filter(Number.isFinite);

		return values.length
			? values.filter(value => value > 0).length / values.length * 100
			: null;
	};

	const answerPercentage = (columnName, answer) => {
		const values = playedRows
			.map(row => String(row[columnName] ?? "").trim().toLowerCase())
			.filter(value => value !== "" && value !== "x");

		return values.length
			? values.filter(value => value === answer).length / values.length * 100
			: null;
	};

	const formatPercentage = value =>
		value === null ? "—" : `${value.toFixed(0)}%`;

	const matchTotals = performanceTrendPoints(scoutingRows)
		.map(point => point.scouting);

	const bestMatchTotal = matchTotals.length
		? Math.max(...matchTotals)
		: null;

	const matchTotalSpread = (() => {
		if (matchTotals.length < 2) return null;
		const mean = matchTotals.reduce((sum, total) => sum + total, 0) / matchTotals.length;
		return Math.sqrt(matchTotals.reduce((sum, total) => sum + (total - mean) ** 2, 0) / matchTotals.length);
	})();

	const averageClimbPoints =
		averageColumn(scoutingRows, "Climb points");

	const eventOprs = events
		.filter(event => Number.isFinite(event.opr));

	const averageOpr = eventOprs.length
		? eventOprs.reduce((sum, event) => sum + event.opr, 0) / eventOprs.length
		: null;

	const bestOprEvent = [...eventOprs]
		.sort((a, b) => b.opr - a.opr)[0];

	const seasonEpa = finiteNumberOrNull(season.epa?.total_points?.mean ?? season.epa?.total_points);
	const peakEpa = finiteNumberOrNull(season.epa?.stats?.max);
	const winRate = finiteNumberOrNull(season.record?.winrate);
	const teamImage = `https://www.thebluealliance.com/avatar/${SEASON_YEAR}/frc${teamNumber}.png`;

	showTeamMedia(teamNumber, SEASON_YEAR);

	const eventCards = events.map(event => {
		const eventScouting = scoutingRowsByEvent
			.find(entry => entry.event.key === event.key).rows;
		const scoutingAverage = scoutingAverageFor(eventScouting);
		const notes = [event.allianceStatus, event.playoffStatus].filter(Boolean);

		return `
          <article class="data-item season-event">
            <div class="season-event-header">
              <div>
                <h4>${escapeHtml(event.name)}</h4>
                <div class="data-item-description">${escapeHtml(event.startDate ?? "")}</div>
              </div>
              <button class="secondary-button season-event-button" type="button" data-event-key="${escapeHtml(event.key)}" data-event-name="${escapeHtml(event.name)}">
                Event details →
              </button>
            </div>

            <div class="season-event-stats">
              <div><span>Rank</span><strong>${event.rank ? `${event.rank}${event.numTeams ? ` / ${event.numTeams}` : ""}` : "—"}</strong></div>
              <div><span>Quals</span><strong>${formatRecord(event.qualRecord)}</strong></div>
              <div><span>Playoffs</span><strong>${formatRecord(event.playoffRecord)}</strong></div>
              <div><span>OPR</span><strong>${formatNumber(event.opr)}</strong></div>
              <div><span>EPA</span><strong>${formatNumber(event.epa)}</strong></div>
              <div><span>Scouting avg</span><strong>${formatNumber(scoutingAverage)}</strong></div>
            </div>

            <div class="data-item-description">
              ${eventScouting.length} scouting report${eventScouting.length === 1 ? "" : "s"}${notes.length ? ` • ${escapeHtml(notes.join(" • "))}` : ""}
            </div>
          </article>`;
	}).join("");

	results.innerHTML = `

      <div class="team-hero">
        <div class="team-heading">
			<div class="team-heading-container">
				<h2>Team ${escapeHtml(teamNumber)}: ${escapeHtml(season.name ?? "")}</h2>
				<img class="teamImage" src="${teamImage}" alt="">
			</div>

          <span>
            ${SEASON_YEAR} season • ${events.length} event${events.length === 1 ? "" : "s"} • ${scoutingRows.length} scouting matches recorded
          </span>

          <div class="team-actions">
            ${BTB_LINK_SLOT}
          </div>

        </div>
        ${ROBOT_PHOTO_SLOT}
      </div>

        <!-- TOP STATISTICS -->

        <section class="top-stats">

          <div class="stat-card">
            <div class="stat-label">Season EPA</div>
            <div class="stat-value">${formatNumber(seasonEpa, 2)}</div>
            <div class="stat-description">
              Statbotics season EPA${peakEpa !== null ? ` • peak ${peakEpa.toFixed(1)}` : ""}
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-label">Season Record</div>
            <div class="stat-value">${formatRecord(season.record)}</div>
            <div class="stat-description">
              ${winRate !== null ? `${(winRate * 100).toFixed(0)}% win rate over ${season.record.count} matches` : "No completed matches yet"}
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-label">Average OPR</div>
            <div class="stat-value">${formatNumber(averageOpr, 2)}</div>
            <div class="stat-description">
              ${bestOprEvent ? `Best: ${bestOprEvent.opr.toFixed(1)} at ${escapeHtml(bestOprEvent.name)}` : "No OPR data yet"}
            </div>
          </div>

        </section>

        <!-- EVENTS -->

        <h3 class="section-title">Event by Event</h3>

        ${events.length
			? `<section class="season-events">${eventCards}</section>`
			: `<div class="empty-state">Team ${escapeHtml(teamNumber)} has no ${SEASON_YEAR} events on The Blue Alliance.</div>`
		}

        <!-- STATBOTICS -->

        <h3 class="section-title">
          <a href="https://www.statbotics.io/team/${encodeURIComponent(teamNumber)}"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="external-link">Statbotics</a> Season Statistics
        </h3>

        <section class="data-grid">
          ${dataItem("Auto EPA", formatNumber(finiteNumberOrNull(season.epa?.breakdown?.auto_points)))}
          ${dataItem("Teleop EPA", formatNumber(finiteNumberOrNull(season.epa?.breakdown?.teleop_points)))}
          ${dataItem("Endgame EPA", formatNumber(finiteNumberOrNull(season.epa?.breakdown?.endgame_points)))}
          ${dataItem("World Rank", formatStatboticsRank(season.epa?.ranks?.total))}
          ${dataItem("Country Rank", formatStatboticsRank(season.epa?.ranks?.country))}
          ${dataItem("District Rank", formatStatboticsRank(season.epa?.ranks?.district))}
        </section>

        <!-- SCOUTING AVERAGES -->

        <h3 class="section-title">Season Scouting Averages</h3>

        ${scoutingRows.length
			? `<section class="data-grid">
          ${dataItem("Scouting Reports", scoutingRows.length, `From ${scoutingRowsByEvent.filter(({ rows }) => rows.length).length} event(s) with scouting sheets`)}
          ${dataItem("Auto Points", formatAverage(averageAuto))}
          ${dataItem("Teleop Points", formatAverage(averageTeleop))}
          ${dataItem("Average Points", formatAverage(averageTotalPoints), "Average auto + teleop points from scouting")}
          ${dataItem("Climb Points", formatAverage(averageClimbPoints), "Average auto + endgame climb points")}
          ${dataItem("Average With Climb", averageTotalPoints !== null && averageClimbPoints !== null ? (averageTotalPoints + averageClimbPoints).toFixed(1) : "—", "Auto + teleop + climb points")}
          ${dataItem("Best Match", formatNumber(bestMatchTotal), "Highest single-match scouting total")}
          ${dataItem("Match-to-Match Spread", formatNumber(matchTotalSpread), "Standard deviation of match totals; lower is more consistent")}
        </section>

        <h3 class="section-title">Climbing, Driving &amp; Defence</h3>

        <section class="data-grid">
          ${dataItem("Auto Climb Rate", formatPercentage(nonZeroPercentage("Auto Climb")), "Played matches with an auto climb")}
          ${dataItem("Endgame Climb Rate", formatPercentage(nonZeroPercentage("End Game Climb")), "Played matches with an endgame climb")}
          ${dataItem("Scored All Preload", formatPercentage(answerPercentage("Score Preloaded", "all")), `Partial: ${formatPercentage(answerPercentage("Score Preloaded", "partial"))} • None: ${formatPercentage(answerPercentage("Score Preloaded", "none"))}`)}
          ${dataItem("Shuttled Fuel", formatPercentage(truePercentage(scoutingRows, "Shuttle Fuel")), "Matches where they shuttled fuel")}
          ${dataItem("Driver Skill", formatAverage(averageColumn(scoutingRows, "Driver Skill ranking compared to other robots on the field from 1 (best) to 6 (worst)")), "1 (best) to 6 (worst) vs robots on the field")}
          ${dataItem("Defence Score", formatAverage(averageColumn(scoutingRows, "Defense Rating from 1 (incredible) to 5 (poor)")), `1 (incredible) to 5 (poor) • played defence in ${defenceMatchesPlayed(scoutingRows, "Defense Rating from 1 (incredible) to 5 (poor)")} matches`)}
          ${dataItem("Was Defended", formatPercentage(truePercentage(scoutingRows, "Robot was defended")))}
        </section>

        <h3 class="section-title">Reliability</h3>

        <section class="data-grid">
          ${dataItem("No Shows", formatPercentage(truePercentage(scoutingRows, "No Show")))}
          ${dataItem("Died / Broke Down", formatPercentage(truePercentage(scoutingRows, "Robot died/had breakdown in functionality")))}
          ${dataItem("Tipped Over", formatPercentage(truePercentage(scoutingRows, "Robot tipped/fell over")))}
          ${dataItem("Fouls / Cards", formatPercentage(truePercentage(scoutingRows, "Robot received fouls or a yellow/red card")))}
        </section>`
			: `<div class="empty-state">No scouting entries found for this team this season.</div>`
		}

        <!-- PIT SCOUTING -->

        <h3 class="section-title">
          Pit Scouting${latestPit ? ` (${escapeHtml(latestPit.event.name)})` : ""}
        </h3>

        ${latestPit
			? `<section class="data-grid">${PIT_SCOUTING_QUESTIONS.map(([label, question]) => {
				const answer = latestPit.rows
					.map(row => String(row[question] ?? "").trim())
					.find(Boolean);
				return dataItem(label, answer ? escapeHtml(answer) : "—");
			}).join("")}</section>`
			: `<div class="empty-state">No pit scouting found for this team this season.</div>`
		}
      `;

}


/* Selects an event, adding it to the dropdown for this visit only if it isn't
   one of the built-in options (e.g. an event opened from the season view). */
function selectEvent(key, name) {

	if (![...eventKeySelect.options].some(option => option.value === key)) {
		const option = new Option(name || key, key);
		option.dataset.temporary = "true";
		eventKeySelect.add(option);
	}

	eventKeySelect.value = key;

}


/* Link to the event rankings page for the selected event, carrying the event
   name so the rankings page can show events that aren't in its dropdown. */
function eventRankingsUrl(teamNumber) {

	const option = eventKeySelect.selectedOptions[0];
	const params = new URLSearchParams({ event: eventKeySelect.value, team: teamNumber });

	if (option?.dataset.temporary) {
		params.set("name", option.text.trim());
	}

	return `/event/?${params}`;

}


/* "Event details" on a season card switches the dropdown to that event. */
results.addEventListener("click", event => {

	const eventButton = event.target.closest("[data-event-key]");

	if (!eventButton) {
		return;
	}

	const { eventKey: key, eventName } = eventButton.dataset;

	selectEvent(key, eventName);
	reloadData();
	window.scrollTo({ top: 0, behavior: "smooth" });

});


/* =================================
   RELOAD EVERYTHING
================================= */

async function reloadData() {

	eventKey =
		eventKeySelect.value;


	resetTeamData();

	const url = new URL(window.location);
	url.searchParams.set("event", eventKey);

	if (eventKeySelect.selectedOptions[0]?.dataset.temporary) {
		url.searchParams.set("name", eventKeySelect.selectedOptions[0].text.trim());
	} else {
		url.searchParams.delete("name");
	}

	window.history.replaceState({}, "", url);


	results.innerHTML = `
        <div class="loading">
          ${eventKey === SEASON_KEY ? "Loading season data…" : "Loading event data…"}
        </div>
      `;


	try {

		if (eventKey === SEASON_KEY) {
			await printSeasonData();
			return;
		}

		await Promise.all([
			loadEventData(),
			loadScoutingData(),
			loadPitScoutingData()
		]);
		await printTeamData();


	} catch (error) {

		console.error(error);


		results.innerHTML = `

          <div class="empty-state">

            Error loading data:

            <br><br>

            ${error.message}

          </div>

        `;

	}

}


/* =================================
   EVENT LISTENERS
================================= */

eventKeySelect.addEventListener(
	"change",
	reloadData
);


button.addEventListener(
	"click",
	reloadData
);


teamNumberInput.addEventListener(
	"keydown",
	event => {

		if (event.key === "Enter") {
			reloadData();
		}

	}
);


/* =================================
   AUTO-REFRESH SCOUTING DATA
================================= */

setInterval(

	async () => {

		/* Season view pulls from every event; refresh it with "View Team" instead. */
		if (eventKey === SEASON_KEY) {
			return;
		}

		try {

			await loadScoutingData();

			if (teamNumberInput.value.trim()) {
				await printTeamData();
			}

		} catch (error) {

			console.error(
				"Failed to refresh scouting data:",
				error
			);

		}

	},

	30000

);


/* INITIAL LOAD */
const initialParams = new URL(window.location).searchParams;
const eventFromUrl = initialParams.get("event");

if ([...eventKeySelect.options].some(option => option.value === eventFromUrl)) {
	eventKeySelect.value = eventFromUrl;
} else if (/^\d{4}[a-z0-9]+$/i.test(eventFromUrl ?? "")) {
	selectEvent(eventFromUrl, initialParams.get("name"));
}

const teams = getTeamsFromUrl();

if (teams.length == 1) {
	teamNumberInput.value = teams[0];
}

reloadData();

document.addEventListener("wheel", event => {
	if (document.activeElement.type == "number") {
		document.activeElement.blur();
	}
});
