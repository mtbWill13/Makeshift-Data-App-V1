
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

      return value === null
        ? "Not available"
        : value.toFixed(1);

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


      const matches =
        await matchesResponse.json();

      const rankings =
        await rankingsResponse.json();

      stats =
        await oprsResponse.json();


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

      for (const match of matches) {

        const teamsInMatch = [

          ...match.red.team_keys,
          ...match.blue.team_keys

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


      const teamKey =
        `frc${teamNumber}`;


      const team =
        teamData[teamKey];


      const scoutingRows =
        scoutingData.filter(row =>
          String(row["Team Number"] ?? "").trim()
          === teamNumber
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


      const opr =
        team?.opr ?? null;


      const epa =
        statbotics
          ?.epa
          ?.total_points
          ?.mean ?? null;

      const oprValues = Object.values(stats.oprs || {})
  .map(Number)
  .filter(Number.isFinite);

const eventAverageOpr =
  oprValues.reduce((sum, opr) => sum + opr, 0) / oprValues.length;

      const topTen = [...oprValues]
        .sort((a, b) => b - a)
        .slice(0, 10);

      const topTenAverageOpr =
        topTen.reduce((sum, opr) => sum + opr, 0) / topTen.length;



     const topTenMultiplier =
        topTenAverageOpr / eventAverageOpr;

      const sortedOprs = [...oprValues]
  .sort((a, b) => b - a);

const sixteenBestOpr = sortedOprs[15]; 



const sixteenBestMultiplier =
  sixteenBestOpr / eventAverageOpr;

  const highestOPR = sortedOprs[0];

  //const totalEPA = statbotics.epa.breakdown.auto_points + statbotics.epa.breakdown.teleop_points  + statbotics?.epa?.breakdown?.endgame_points
    const totalEPA = statbotics.epa.total_points

      function averagePowerRating() {
          let totalPoints = 0;
          let numEntries = 0;

          if(epa != null) {
            totalPoints += epa;
            numEntries++;
          }if(opr != null) {
            totalPoints += opr;
            numEntries++;
          }if(averageTotalPoints != null) {
            totalPoints += averageTotalPoints;
            numEntries++;
          }

          return totalPoints / numEntries;
      }

      function estimatePick() {
        let pick = "";

        if(opr >= sixteenBestOpr) {
          pick = "1st"
        } else if(String(driveType ?? "").toLowerCase().includes("tank")) {
          pick = "dnp"
        }

        return pick;
      }

      function determineOPRRank() {
        let rank = 0;
        
        for(let i = 0; i < sortedOprs.length; i++) {
          if(opr == sortedOprs[i]) {
            rank = i + 1;
            break;
          }
        }

        return rank;
      }
      /* RENDER */

      results.innerHTML = `

        <div class="team-heading">
          <h2>Team ${teamNumber}</h2>

          <span>
            ${scoutingRows.length}
            scouting matches recorded • EPA, OPR and Scouting Average Score: ${averagePowerRating().toFixed(2)}
          </span>

        </div>

        <!-- TOP STATISTICS -->

        <section class="top-stats">
          <div class="stat-card">

            <div class="stat-label">
              OPR
            </div>

            <div class="stat-value">
              ${
                opr !== null
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
              ${
                averageTotalPoints !== null
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
              ${
                totalEPA !== null
                  ? totalEPA.toFixed(2)
                  : "—"
              }
            </div>

            <div class="stat-description">
              Statbotics event EPA
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
              Matches Played
            </div>

            <div class="data-item-value">
              ${
                team?.matches?.length ?? 0
              }
            </div>

          </div>

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
              ${
                team?.dpr !== null &&
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
              ${
                team?.ccwm !== null &&
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
              ${
                statbotics
                  ?.epa
                  ?.breakdown
                  ?.auto_points !== undefined

                  ? statbotics.epa.breakdown.auto_points
                      .toFixed(1)

                  : "—"
              }
            </div>

          </div>


          <div class="data-item">

            <div class="data-item-label">
              Estimated Teleop EPA
            </div>

            <div class="data-item-value">
              ${
                statbotics
                  ?.epa
                  ?.breakdown
                  ?.teleop_points !== undefined

                  ? statbotics.epa.breakdown.teleop_points
                      .toFixed(1)

                  : "—"
              }
            </div>

          </div>
          <div class="data-item">

            <div class="data-item-label">
              Estimated Endgame EPA
            </div>

            <div class="data-item-value">
              ${
                statbotics
                  ?.epa
                  ?.breakdown
                  ?.endgame_points !== undefined

                  ? statbotics.epa.breakdown.endgame_points
                      .toFixed(1)

                  : "—"
              }
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
              ${
                defenseConsistency === null
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
              ${
                defendedPercentage === null
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
              ${highestOPR.toFixed(2)}
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
              ${driveType === null ? "—" : driveType}
            </div>

          </div>

          <div class="data-item">

            <div class="data-item-label">
              Can drive under trench
            </div>

            <div class="data-item-value">
              ${trench === null ? "—" : trench}
            </div>

          </div>

          <div class="data-item">

            <div class="data-item-label">
              Can drive over bump
            </div>

            <div class="data-item-value">
              ${bump === null ? "—" : bump}
            </div>

          </div>

          <div class="data-item">

            <div class="data-item-label">
              preferred start location
            </div>

            <div class="data-item-value">
              ${preferredStart === null ? "—" : preferredStart}
            </div>

          </div>

          <div class="data-item">

            <div class="data-item-label">
              Would be ok playing defence
            </div>

            <div class="data-item-value">
              ${okPlayingDefence === null ? "—" : okPlayingDefence}
            </div>

          </div>

          <div class="data-item">

            <div class="data-item-label">
              Programming LAnguage
            </div>

            <div class="data-item-value">
              ${programmingLanguage === null ? "—" : programmingLanguage}
            </div>

          </div>

          <div class="data-item">

            <div class="data-item-label">
              Coolest thing about robot or robot cart
            </div>

            <div class="data-item-value">
              ${coolestThing === null ? "—" : coolestThing}
            </div>

          </div>
        
          </section>

        <!-- INDIVIDUAL SCOUTING -->

        <h3 class="section-title">
          Individual Scouting Reports
        </h3>


        ${
          scoutingRows.length

            ? `

              <section class="scouting-list">

                ${scoutingRows.map((row, index) => `

                  <article class="scouting-card">

                    <div class="scouting-card-header">
                      Match ${index + 1}
                    </div>

                    ${Object.entries(row)
                      .map(([column, value]) => `

                        <div class="scouting-row">

                          <span>
                            ${column}
                          </span>

                          <strong>
                            ${value ?? "—"}
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
       RELOAD EVERYTHING
    ================================= */

    async function reloadData() {

      eventKey =
        eventKeySelect.value;


      resetTeamData();


      results.innerHTML = `
        <div class="loading">
          Loading event data…
        </div>
      `;


      try {

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

    reloadData();
