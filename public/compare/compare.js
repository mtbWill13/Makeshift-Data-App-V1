      const eventSelect = document.getElementById("eventKey");
      const teamAInput = document.getElementById("teamA");
      const teamBInput = document.getElementById("teamB");
      const compareButton = document.getElementById("compareButton");
      const results = document.getElementById("results");

      function escapeHtml(value) {
        return String(value ?? "—").replace(
          /[&<>'"]/g,
          (character) =>
            ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              "'": "&#39;",
              '"': "&quot;",
            })[character],
        );
      }
      function averageColumn(rows, columnName) {
        const values = rows
          .filter(
            (row) =>
              String(row["No Show"] ?? "")
                .trim()
                .toUpperCase() !== "TRUE",
          )
          .map((row) => Number(String(row[columnName] ?? "").trim()))
          .filter(Number.isFinite);
        return values.length
          ? values.reduce((sum, value) => sum + value, 0) / values.length
          : null;
      }
      function truePercentage(rows, columnName) {
        const answers = rows
          .map((row) =>
            String(row[columnName] ?? "")
              .trim()
              .toUpperCase(),
          )
          .filter((value) => value === "TRUE" || value === "FALSE");
        return answers.length
          ? (answers.filter((value) => value === "TRUE").length /
              answers.length) *
              100
          : null;
      }
      function firstTextValue(rows, columnName) {
        return (
          rows
            .map((row) => String(row[columnName] ?? "").trim())
            .find(Boolean) ?? null
        );
      }
      function consistencyScore(rows, columnName, minScore = 1, maxScore = 5) {
        const scores = rows
          .filter(
            (row) =>
              String(row["No Show"] ?? "")
                .trim()
                .toUpperCase() !== "TRUE",
          )
          .map((row) => Number(row[columnName]))
          .filter(Number.isFinite);
        if (scores.length < 2) return null;
        const average =
          scores.reduce((sum, score) => sum + score, 0) / scores.length;
        const variance =
          scores.reduce((sum, score) => sum + (score - average) ** 2, 0) /
          scores.length;
        const maximumDeviation = (maxScore - minScore) / 2;
        return Math.max(
          0,
          Math.min(100, 100 * (1 - Math.sqrt(variance) / maximumDeviation)),
        );
      }
      function formatNumber(value, digits = 1) {
        return Number.isFinite(value) ? value.toFixed(digits) : "—";
      }
      async function fetchJson(url) {
        const response = await fetch(url);
        const text = await response.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(`${url} returned an invalid response.`);
        }
        if (!response.ok)
          throw new Error(data.error || `Could not load ${url}.`);
        return data;
      }
      async function fetchStatbotics(teamNumber, eventKey) {
        try {
          return await fetchJson(
            `/api/statbotics/team-event/${teamNumber}/${eventKey}`,
          );
        } catch (error) {
          console.warn(
            `EPA is unavailable for team ${teamNumber}:`,
            error.message,
          );
          return null;
        }
      }

      function buildProfile(teamNumber, data) {
        const key = `frc${teamNumber}`;
        const team = data.teams[key] || {};
        const statbotics = data.statbotics;
        const scoutingRows = data.scouting.filter(
          (row) => String(row["Team Number"] ?? "").trim() === teamNumber,
        );
        const pitRows = data.pit.filter(
          (row) =>
            String(
              row["Team Number of Team Being Scouted"] ??
                row["Team Number"] ??
                "",
            ).trim() === teamNumber,
        );
        return {
          number: teamNumber,
          opr: Number(team.opr),
          dpr: Number(team.dpr),
          ccwm: Number(team.ccwm),
          matches: team.matches || 0,
          totalEpa: Number(statbotics?.epa?.breakdown?.auto_points + statbotics?.epa?.breakdown?.teleop_points + statbotics?.epa?.breakdown?.endgame_points),
          autoEpa: Number(statbotics?.epa?.breakdown?.auto_points),
          teleopEpa: Number(statbotics?.epa?.breakdown?.teleop_points),
          endgameEpa: Number(statbotics?.epa?.breakdown?.endgame_points),
          auto: averageColumn(scoutingRows, "Auto Scoring Points"),
          teleop: averageColumn(scoutingRows, "Teleop Scoring Points"),
          defense: averageColumn(
            scoutingRows,
            "Defense Rating from 1 (incredible) to 5 (poor)",
          ),
          defenseConsistency: consistencyScore(
            scoutingRows,
            "Defense Rating from 1 (incredible) to 5 (poor)",
          ),
          defended: truePercentage(scoutingRows, "Robot was defended"),
          scoutingCount: scoutingRows.length,
          drive: firstTextValue(
            pitRows,
            "What type of drive base does your robot have?",
          ),
          start: firstTextValue(pitRows, "Preferred Starting Location"),
          trench: firstTextValue(
            pitRows,
            "Can your robot drive under the trench?",
          ),
          bump: firstTextValue(pitRows, "Can your robot drive over the bump?"),
          defenseOpen: firstTextValue(
            pitRows,
            "If strategy required; would you be open to playing defense?",
          ),
          language: firstTextValue(
            pitRows,
            "What language is your robot programmed in?",
          ),
        };
      }

      function numericRow(label, a, b, options = {}) {
        const { digits = 1, lowerIsBetter = false, suffix = "" } = options;
        const aValue = Number.isFinite(a) ? a : null;
        const bValue = Number.isFinite(b) ? b : null;
        const aWins =
          aValue !== null &&
          bValue !== null &&
          aValue !== bValue &&
          (lowerIsBetter ? aValue < bValue : aValue > bValue);
        const bWins =
          aValue !== null &&
          bValue !== null &&
          aValue !== bValue &&
          (lowerIsBetter ? bValue < aValue : bValue > aValue);
        return `<tr><td>${label}</td><td class="${aWins ? "winner" : ""}">${formatNumber(aValue, digits)}${aValue === null ? "" : suffix}</td><td class="${bWins ? "winner" : ""}">${formatNumber(bValue, digits)}${bValue === null ? "" : suffix}</td></tr>`;
      }
      function textRow(label, a, b) {
        return `<tr><td>${label}</td><td>${escapeHtml(a)}</td><td>${escapeHtml(b)}</td></tr>`;
      }

      function renderComparison(a, b) {
        const aTotal =
          Number.isFinite(a.auto) && Number.isFinite(a.teleop)
            ? a.auto + a.teleop
            : null;
        const bTotal =
          Number.isFinite(b.auto) && Number.isFinite(b.teleop)
            ? b.auto + b.teleop
            : null;
        const aEdge = [a.opr, a.ccwm, aTotal]
          .filter(Number.isFinite)
          .reduce((sum, value) => sum + value, 0);
        const bEdge = [b.opr, b.ccwm, bTotal]
          .filter(Number.isFinite)
          .reduce((sum, value) => sum + value, 0);
        const summary =
          aEdge === bEdge
            ? "Even"
            : aEdge > bEdge
              ? `Team ${a.number}`
              : `Team ${b.number}`;
        results.innerHTML = `
        <div class="comparison-heading"><div><h2 class="team-name">Team ${escapeHtml(a.number)}</h2><p class="team-detail">${a.scoutingCount} scouting reports</p></div><div class="vs">VS</div><div><h2 class="team-name right">Team ${escapeHtml(b.number)}</h2><p class="team-detail right">${b.scoutingCount} scouting reports</p></div></div>
        <section class="summary"><div class="summary-card"><div class="summary-label">Comparison edge</div><div class="summary-value">${summary}</div><div class="summary-note">Based on available OPR, CCWM, and scouting scoring data.</div></div><div class="summary-card"><div class="summary-label">Event</div><div class="summary-value">${escapeHtml(eventSelect.selectedOptions[0].text)}</div><div class="summary-note">Green cells indicate the stronger numeric value.</div></div></section>
        <h3 class="section-title">Event performance</h3>
        <table class="comparison-table"><thead><tr><th>Stat</th><th>Team ${escapeHtml(a.number)}</th><th>Team ${escapeHtml(b.number)}</th></tr></thead><tbody>
          ${numericRow("OPR", a.opr, b.opr, { digits: 2 })}${numericRow("DPR", a.dpr, b.dpr, { digits: 2, lowerIsBetter: true })}${numericRow("CCWM", a.ccwm, b.ccwm, { digits: 2 })}${numericRow("Total EPA", a.totalEpa, b.totalEpa)}${numericRow("Auto EPA", a.autoEpa, b.autoEpa)}${numericRow("Teleop EPA", a.teleopEpa, b.teleopEpa)}${numericRow("Endgame EPA", a.endgameEpa, b.endgameEpa)}${numericRow("Matches played", a.matches, b.matches, { digits: 0 })}
        </tbody></table>
        <h3 class="section-title">Match scouting</h3>
        <table class="comparison-table"><thead><tr><th>Stat</th><th>Team ${escapeHtml(a.number)}</th><th>Team ${escapeHtml(b.number)}</th></tr></thead><tbody>
          ${numericRow("Average auto points", a.auto, b.auto)}${numericRow("Average teleop points", a.teleop, b.teleop)}${numericRow("Average total points", aTotal, bTotal)}${numericRow("Defense rating", a.defense, b.defense, { lowerIsBetter: true })}${numericRow("Defense consistency", a.defenseConsistency, b.defenseConsistency, { suffix: "%" })}${numericRow("Was Defended in matches", a.defended, b.defended, { suffix: "%" })}${numericRow("Scouting reports", a.scoutingCount, b.scoutingCount, { digits: 0 })}
        </tbody></table>
        <h3 class="section-title">Pit scouting</h3>
        <table class="comparison-table"><thead><tr><th>Stat</th><th>Team ${escapeHtml(a.number)}</th><th>Team ${escapeHtml(b.number)}</th></tr></thead><tbody>
          ${textRow("Drive base", a.drive, b.drive)}${textRow("Preferred start", a.start, b.start)}${textRow("Can pass trench", a.trench, b.trench)}${textRow("Can cross bump", a.bump, b.bump)}${textRow("Open to defense", a.defenseOpen, b.defenseOpen)}${textRow("Programming language", a.language, b.language)}
        </tbody></table>`;
      }

      async function compareTeams() {
        const eventKey = eventSelect.value;
        const teamA = teamAInput.value.trim();
        const teamB = teamBInput.value.trim();
        if (!teamA || !teamB) {
          results.innerHTML =
            '<div class="empty-state">Enter two team numbers to compare.</div>';
          return;
        }
        if (teamA === teamB) {
          results.innerHTML =
            '<div class="empty-state">Choose two different teams.</div>';
          return;
        }
        results.innerHTML =
          '<div class="loading">Loading team comparison…</div>';
        try {
          const [
            matches,
            rankings,
            stats,
            scouting,
            pit,
            statboticsA,
            statboticsB,
          ] = await Promise.all([
            fetchJson(`/api/events/${eventKey}/matches`),
            fetchJson(`/api/events/${eventKey}/rankings`),
            fetchJson(`/api/events/${eventKey}/oprs`),
            fetchJson(`/api/scouting/${eventKey}`),
            fetchJson(`/api/pitscouting/${eventKey}`),
            fetchStatbotics(teamA, eventKey),
            fetchStatbotics(teamB, eventKey),
          ]);
          const teams = {};
          for (const [teamKey, opr] of Object.entries(stats.oprs || {}))
            teams[teamKey] = {
              ...(teams[teamKey] || {}),
              opr,
              dpr: stats.dprs?.[teamKey],
              ccwm: stats.ccwms?.[teamKey],
              matches: 0,
            };
          for (const ranking of Array.isArray(rankings) ? rankings : [])
            teams[ranking.team_key] = {
              ...(teams[ranking.team_key] || { matches: 0 }),
              rank: ranking.rank,
            };
          for (const match of Array.isArray(matches) ? matches : [])
            for (const key of [
              ...(match.red?.team_keys || []),
              ...(match.blue?.team_keys || []),
            ])
              teams[key] = {
                ...(teams[key] || { matches: 0 }),
                matches: (teams[key]?.matches || 0) + 1,
              };
          renderComparison(
            buildProfile(teamA, {
              teams,
              scouting,
              pit,
              statbotics: statboticsA,
            }),
            buildProfile(teamB, {
              teams,
              scouting,
              pit,
              statbotics: statboticsB,
            }),
          );
        } catch (error) {
          results.innerHTML = `<div class="empty-state">Could not load comparison: ${escapeHtml(error.message)}</div>`;
        }
      }
      compareButton.addEventListener("click", compareTeams);
      [teamAInput, teamBInput].forEach((input) =>
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") compareTeams();
        }),
      );
