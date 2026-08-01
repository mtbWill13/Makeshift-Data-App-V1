      const eventSelect = document.getElementById("eventKey");
      const redInputs = ["red1", "red2", "red3"].map((id) =>
        document.getElementById(id),
      );
      const blueInputs = ["blue1", "blue2", "blue3"].map((id) =>
        document.getElementById(id),
      );
      const results = document.getElementById("results");
      function escapeHtml(value) {
        return String(value ?? "—").replace(
          /[&<>'"]/g,
          (c) =>
            ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              "'": "&#39;",
              '"': "&quot;",
            })[c],
        );
      }
      function format(value, digits = 1) {
        return Number.isFinite(value) ? value.toFixed(digits) : "—";
      }
      function average(rows, column) {
        const values = rows
          .filter(
            (row) =>
              String(row["No Show"] ?? "")
                .trim()
                .toUpperCase() !== "TRUE",
          )
          .map((row) => Number(String(row[column] ?? "").trim()))
          .filter(Number.isFinite);
        return values.length
          ? values.reduce((sum, value) => sum + value, 0) / values.length
          : null;
      }
      function averageFirst(rows, columns) {
        for (const column of columns) {
          const value = average(rows, column);
          if (Number.isFinite(value)) return value;
        }
        return null;
      }
      function consistency(rows, column) {
        const values = rows
          .filter(
            (row) =>
              String(row["No Show"] ?? "")
                .trim()
                .toUpperCase() !== "TRUE",
          )
          .map((row) => Number(row[column]))
          .filter(Number.isFinite);
        if (values.length < 2) return null;
        const mean =
          values.reduce((sum, value) => sum + value, 0) / values.length;
        const variance =
          values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
          values.length;
        return Math.max(0, Math.min(100, 100 * (1 - Math.sqrt(variance) / 2)));
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
      async function fetchEpa(team, event) {
        try {
          return await fetchJson(`/api/statbotics/team-event/${team}/${event}`);
        } catch {
          return null;
        }
      }
      function numberOrNull(value) {
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
      }
      function sum(values) {
        const usable = values.filter(Number.isFinite);
        return usable.length
          ? usable.reduce((total, value) => total + value, 0)
          : null;
      }
      function profile(teamNumber, data) {
        const eventTeam = data.teams[`frc${teamNumber}`] || {};
        const rows = data.scouting.filter(
          (row) => String(row["Team Number"] ?? "").trim() === teamNumber,
        );
        const epa = data.epas[teamNumber];
        const auto = average(rows, "Auto Scoring Points");
        const teleop = average(rows, "Teleop Scoring Points");
        const endgame = averageFirst(rows, [
          "Endgame Scoring Points",
          "End Game Scoring Points",
          "Endgame Points",
          "End Game Points",
        ]);
        return {
          teamNumber,
          opr: numberOrNull(eventTeam.opr),
          dpr: numberOrNull(eventTeam.dpr),
          ccwm: numberOrNull(eventTeam.ccwm),
          totalEpa: numberOrNull(epa?.epa?.total_points?.mean),
          autoEpa: numberOrNull(epa?.epa?.breakdown?.auto_points),
          teleopEpa: numberOrNull(epa?.epa?.breakdown?.teleop_points),
          endgameEpa: numberOrNull(epa?.epa?.breakdown?.endgame_points),
          auto,
          teleop,
          endgame,
          total:
            Number.isFinite(auto) &&
            Number.isFinite(teleop) &&
            Number.isFinite(endgame)
              ? auto + teleop + endgame
              : null,
          defense: average(
            rows,
            "Defense Rating from 1 (incredible) to 5 (poor)",
          ),
          consistency: consistency(
            rows,
            "Defense Rating from 1 (incredible) to 5 (poor)",
          ),
          reports: rows.length,
        };
      }
      function alliance(teamNumbers, data) {
        const teams = teamNumbers.map((team) => profile(team, data));
        const allRows = data.scouting.filter((row) =>
          teamNumbers.includes(String(row["Team Number"] ?? "").trim()),
        );
        return {
          teamNumbers,
          opr: sum(teams.map((team) => team.opr)),
          totalEpa: sum(teams.map((team) => team.totalEpa)),
          autoEpa: sum(teams.map((team) => team.autoEpa)),
          teleopEpa: sum(teams.map((team) => team.teleopEpa)),
          endgameEpa: sum(teams.map((team) => team.endgameEpa)),
          dpr: sum(teams.map((team) => team.dpr)),
          ccwm: sum(teams.map((team) => team.ccwm)),
          auto: sum(teams.map((team) => team.auto)),
          teleop: sum(teams.map((team) => team.teleop)),
          endgame: sum(teams.map((team) => team.endgame)),
          total: sum(teams.map((team) => team.total)),
          defense: average(
            allRows,
            "Defense Rating from 1 (incredible) to 5 (poor)",
          ),
          consistency: consistency(
            allRows,
            "Defense Rating from 1 (incredible) to 5 (poor)",
          ),
          reports: allRows.length,
        };
      }
      function row(
        label,
        red,
        blue,
        { digits = 1, lower = false, suffix = "" } = {},
      ) {
        const redWin =
          Number.isFinite(red) &&
          Number.isFinite(blue) &&
          red !== blue &&
          (lower ? red < blue : red > blue);
        const blueWin =
          Number.isFinite(red) &&
          Number.isFinite(blue) &&
          red !== blue &&
          (lower ? blue < red : blue > red);
        return `<tr><td>${label}</td><td class="${redWin ? "winner" : ""}">${format(red, digits)}${Number.isFinite(red) ? suffix : ""}</td><td class="${blueWin ? "winner" : ""}">${format(blue, digits)}${Number.isFinite(blue) ? suffix : ""}</td></tr>`;
      }
      function table(title, red, blue, rows) {
        return `<h3 class="section-title">${title}</h3><table class="comparison-table"><thead><tr><th>Stat</th><th>Red Alliance</th><th>Blue Alliance</th></tr></thead><tbody>${rows.map((args) => row(...args)).join("")}</tbody></table>`;
      }
      function teamTable(title, color, teams) {
        const metrics = [
          ["OPR", "opr", { digits: 2 }],
          ["Average auto points", "auto"],
          ["Average teleop points", "teleop"],
          ["Average total points", "total"],
          ["Average defense score", "defense"],
          ["Defense consistency", "consistency", { suffix: "%" }],
        ];
        return `<article class="individual-table-card ${color}"><h4>${title}</h4><table class="comparison-table"><thead><tr><th>Stat</th>${teams.map((team) => `<th>${escapeHtml(team.teamNumber)}</th>`).join("")}</tr></thead><tbody>${metrics.map(([label, key, options = {}]) => `<tr><td>${label}</td>${teams.map((team) => `<td>${format(team[key], options.digits ?? 1)}${Number.isFinite(team[key]) ? options.suffix || "" : ""}</td>`).join("")}</tr>`).join("")}</tbody></table></article>`;
      }
      function chart(
        title,
        redTeams,
        blueTeams,
        key,
        { digits = 1, suffix = "" } = {},
      ) {
        const entries = [
          ...redTeams.map((team) => ({ ...team, color: "red" })),
          ...blueTeams.map((team) => ({ ...team, color: "blue" })),
        ];
        const values = entries.map((team) => team[key]).filter(Number.isFinite);
        if (!values.length)
          return `<article class="chart-card"><h4>${title}</h4><div class="team-bars"><div class="chart-empty">No data is available for these teams.</div></div></article>`;
        const maximum = Math.max(...values, 1);
        return `<article class="chart-card"><h4>${title}</h4><div class="chart-key"><span><i class="red-key"></i>Red alliance</span><span><i class="blue-key"></i>Blue alliance</span></div><div class="team-bars">${entries
          .map((team) => {
            const value = team[key];
            const height = Number.isFinite(value)
              ? Math.max(3, (value / maximum) * 100)
              : 0;
            return `<div class="team-bar ${team.color}"><span class="team-bar-value">${format(value, digits)}${Number.isFinite(value) ? suffix : ""}</span>${Number.isFinite(value) ? `<div class="team-bar-fill" style="height:${height}%"></div>` : "<div></div>"}<span class="team-bar-label">${escapeHtml(team.teamNumber)}</span></div>`;
          })
          .join("")}</div></article>`;
      }
      function render(red, blue) {
        const redTeams = red.teamNumbers.map((team) =>
          profile(team, currentData),
        );
        const blueTeams = blue.teamNumbers.map((team) =>
          profile(team, currentData),
        );
        const charts = [
          chart("OPR", redTeams, blueTeams, "opr", { digits: 2 }),
          chart("Average total points", redTeams, blueTeams, "total"),
          chart("Average auto points", redTeams, blueTeams, "auto"),
          chart("Average defense score", redTeams, blueTeams, "defense"),
          chart("Defense consistency", redTeams, blueTeams, "consistency", {
            suffix: "%",
          }),
        ].join("");
        results.innerHTML = `<div class="heading"><div><h2 class="alliance-name">Red Alliance</h2><p class="team-list">${red.teamNumbers.map(escapeHtml).join(" • ")}</p></div><div class="vs">VS</div><div><h2 class="alliance-name blue">Blue Alliance</h2><p class="team-list blue">${blue.teamNumbers.map(escapeHtml).join(" • ")}</p></div></div>${table(
          "Event performance",
          red,
          blue,
          [
            ["Combined OPR", red.opr, blue.opr, { digits: 2 }],
            ["Combined DPR", red.dpr, blue.dpr, { digits: 2, lower: true }],
            ["Combined CCWM", red.ccwm, blue.ccwm, { digits: 2 }],
            ['Combined total EPA',red.autoEpa + red.teleopEpa + red.endgameEpa,blue.autoEpa + blue.teleopEpa + blue.endgameEpa],
            ['Combined auto EPA',red.autoEpa,blue.autoEpa],
            ['Combined teleop EPA',red.teleopEpa,blue.teleopEpa],
          ],
        )}${table("Match scouting projection", red, blue, [
          ["Expected auto points", red.auto, blue.auto],
          ["Expected teleop points", red.teleop, blue.teleop],
          ["Expected total points", red.total, blue.total],
          [
            "Average defense rating",
            red.defense,
            blue.defense,
            { lower: true },
          ],
          // [
          //   "Defense consistency",
          //   red.consistency,
          //   blue.consistency,
          //   { suffix: "%" },
          // ],
          ["Scouting reports", red.reports, blue.reports, { digits: 0 }],
        ])}<h3 class="section-title">Individual team comparison</h3><section class="individual-tables">${teamTable("Red alliance", "red", redTeams)}${teamTable("Blue alliance", "blue", blueTeams)}</section><h3 class="section-title">Individual team charts</h3><section class="charts-grid">${charts}</section>`;
      }
      let currentData = { teams: {}, scouting: [], epas: {} };
      async function compare() {
        const red = redInputs.map((input) => input.value.trim());
        const blue = blueInputs.map((input) => input.value.trim());
        if ([...red, ...blue].some((value) => !value)) {
          results.innerHTML =
            '<div class="empty-state">Enter all six team numbers.</div>';
          return;
        }
        if (new Set([...red, ...blue]).size !== 6) {
          results.innerHTML =
            '<div class="empty-state">Each alliance must use three different teams.</div>';
          return;
        }
        results.innerHTML =
          '<div class="loading">Loading alliance comparison…</div>';
        try {
          const event = eventSelect.value;
          const [stats, scouting, ...epas] = await Promise.all([
            fetchJson(`/api/events/${event}/oprs`),
            fetchJson(`/api/scouting/${event}`),
            ...[...red, ...blue].map((team) => fetchEpa(team, event)),
          ]);
          const teams = {};
          for (const [key, opr] of Object.entries(stats.oprs || {}))
            teams[key] = {
              opr,
              dpr: stats.dprs?.[key],
              ccwm: stats.ccwms?.[key],
            };
          const epaMap = Object.fromEntries(
            [...red, ...blue].map((team, index) => [team, epas[index]]),
          );
          currentData = { teams, scouting, epas: epaMap };
          render(alliance(red, currentData), alliance(blue, currentData));
        } catch (error) {
          results.innerHTML = `<div class="empty-state">Could not load alliance comparison: ${escapeHtml(error.message)}</div>`;
        }
      }
      document
        .getElementById("compareButton")
        .addEventListener("click", compare);
      [...redInputs, ...blueInputs].forEach((input) =>
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") compare();
        }),
      );
