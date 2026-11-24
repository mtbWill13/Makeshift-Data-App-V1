/* =================================
   OUR SCOUTING, SHOWN ON A TEAM
   Used by the FTC Data Hub (a team's page) and the Strategy Board (a team's detail):
   stats from our match reports, pit answers and the reports themselves. Needs ftc-common.js.
================================= */

const FtcTeamScouting = (() => {
	let game = null;
	const setGame = value => { game = value; };

	const finite = value => value !== null && value !== undefined && Number.isFinite(Number(value));
	const num = (value, digits = 1) => finite(value) ? Number(value).toFixed(digits) : "—";
	const pct = value => finite(value) ? `${Math.round(value * 100)}%` : "—";
	const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

	/* ----- one team's numbers, from our reports (row.s) ----- */

	const optionLabel = (fieldId, kind, value) => {
		const field = game[kind].sections.flatMap(section => section.fields).find(item => item.id === fieldId);
		return field?.options?.find(option => option.value === value)?.label ?? value;
	};
	
	/* ----- one team's numbers, from our reports (s) and the event (row) ----- */
	
	function profile(row) {
		const s = row.s;
		const pit = s?.pit ?? {};
		const rate = id => s?.stats?.[id]?.rate ?? null;
		const yes = id => pit[id] === "yes";
		const shoots = (() => {
			const counts = s?.stats?.shootsFrom?.counts ?? {};
			const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([value]) => optionLabel("shootsFrom", "match", value));
			return top.length ? top : (pit.shootsFrom ?? []).map(value => optionLabel("shootsFrom", "pit", value));
		})();
		const autoStartCounts = s?.stats?.autoStart?.counts ?? {};
	
		return {
			reports: s?.reports ?? 0,
			scouted: Boolean(s && (s.reports || s.pit)),
			leave: rate("autoLeave"), autoPark: rate("autoPark"),
			endPark: rate("teleParks") ?? (s?.pit ? (yes("teleParks") ? 1 : pit.teleParks === "no" ? 0 : null) : null),
			removes: rate("removesPollen") ?? (s?.pit ? (yes("removesPollen") ? 1 : pit.removesPollen === "no" ? 0 : null) : null),
			blocker: rate("blocker") ?? (s?.pit ? (yes("blocker") ? 1 : pit.blocker === "no" ? 0 : null) : null),
			breakdown: rate("breakdown"),
			driver: s?.stats?.driver?.avg ?? null,
			autoPieces: s?.autoPiecesPerMatch ?? null,
			telePieces: s?.telePiecesPerMatch ?? null,
			pollenAccuracy: s?.groups?.telePollen?.accuracy ?? null,
			nectarAccuracy: s?.groups?.teleNectar?.accuracy ?? null,
			points: s?.pointsPerMatch ?? null,
			tips: s?.tipsPerMatch ?? null,
			swarm: s?.swarmPerMatch ?? null,
			clearsGarden: rate("clearsGarden") ?? (s?.pit ? (yes("clearsGarden") ? 1 : pit.clearsGarden === "no" ? 0 : null) : null),
			canTip: yes("canTipHive"),
			shoots,
			secondSide: (pit.autoStarts ?? []).includes("second") || (autoStartCounts.second ?? 0) > 0,
			shootAfterTip: yes("autoShootAfterTip"),
			pit
		};
	}
	
	/* Short plain-English tags for a team. */
	function tagsFor(row) {
		const p = profile(row);
		const tags = [];
		const add = (text, kind = "") => tags.push({ text, kind });
	
		if (!p.scouted) return [{ text: "Not scouted yet", kind: "" }];
	
		if ((p.tips !== null && p.tips >= 0.5) || p.canTip) add(p.tips !== null ? `Tips the hive (${num(p.tips)}/match)` : "Can tip the hive", "good");
		if (p.clearsGarden !== null && p.clearsGarden >= 0.3) add("Clears gardens", "warn");
		if (p.blocker !== null && p.blocker >= 0.3) add(`Blocker${p.reports ? ` (${pct(p.blocker)})` : ""}`, "warn");
		if (p.removes !== null && p.removes >= 0.3) add("Removes pollen", "good");
		if (p.endPark !== null && p.endPark >= 0.6) add("Parks at the end", "good");
		if (p.leave !== null && p.leave >= 0.8) add("Leaves in auto", "good");
		if (p.autoPark !== null && p.autoPark >= 0.5) add("Parks in auto", "good");
		if (p.secondSide) add("Can start on the second side");
		if (p.shootAfterTip) add("Shoots after a tip in auto");
		if (p.breakdown !== null && p.breakdown >= 0.25) add(`Breaks down (${pct(p.breakdown)})`, "bad");
		else if (p.breakdown !== null && p.reports >= 3 && p.breakdown === 0) add("No breakdowns seen", "good");
		if (p.shoots.length) add(`Shoots: ${p.shoots.slice(0, 2).join(", ").toLowerCase()}`);
		return tags;
	}
	
	const tagHtml = tags => `<div class="tag-row">${tags.map(tag => `<span class="tag ${tag.kind}">${ftcEscape(tag.text)}</span>`).join("")}</div>`;

	function answerText(field, value) {
		if (value === undefined || value === null) return "";
		if (field.type === "yesno") return value === "yes" ? "Yes" : "No";
		const label = item => field.options?.find(option => option.value === item)?.label ?? item;
		if (field.type === "multi") return value.map(label).join(", ");
		if (field.type === "choice") return label(value);
		if (field.type === "scale") return `${value} / 5`;
		return String(value);
	}

	/* The stat cards that come from our own reports. */
	function cardsHtml(row, mine) {
		const p = profile(row);
		const card = (label, value, note = "") => `<div><dt>${label}</dt><dd>${value}${note ? `<small>${ftcEscape(note)}</small>` : ""}</dd></div>`;
		return [
			card("Reports", p.reports, mine?.summary?.noShows ? plural(mine.summary.noShows, "no-show") : ""),
			card("Hive tips", num(p.tips), `${num(p.swarm)} leave + park pts`),
			card("Auto scored", num(p.autoPieces), `leaves ${pct(p.leave)} · parks ${pct(p.autoPark)}`),
			card("Teleop scored", num(p.telePieces), `pollen ${pct(p.pollenAccuracy)} · nectar ${pct(p.nectarAccuracy)} accurate`),
			card("Parks at the end", pct(p.endPark)),
			card("Breakdowns", pct(p.breakdown), p.driver ? `driver ${num(p.driver)} / 5` : "")
		].join("");
	}

	function pitHtml(mine) {
		const pit = mine?.pitReports?.[0];
		if (!pit) return "";
		const fields = game.pit.sections.flatMap(section => section.fields);
		return `
      <h4 class="pv-subtitle">Pit scouting (${ftcEscape(pit.scout)}${pit.flagged ? " · check this" : ""})</h4>
      <dl class="pit-grid">${fields.filter(field => pit.data[field.id] !== undefined).map(field => `<div><dt>${ftcEscape(field.label)}</dt><dd>${ftcEscape(answerText(field, pit.data[field.id]))}</dd></div>`).join("")}</dl>`;
	}

	function reportCardsHtml(mine) {
		const matchFields = game.match.sections.flatMap(section => section.fields);
		const cards = (mine?.matchReports ?? []).map(report => {
			const sum = prefix => matchFields.filter(field => field.type === "count" && field.id.startsWith(prefix) && /Scored$/.test(field.id)).reduce((total, field) => total + (report.data[field.id] ?? 0), 0);
			const line = (label, value) => value ? `<span>${label} <b>${ftcEscape(value)}</b></span>` : "";
			return `
        <article class="report-card${report.flagged ? " flagged" : ""}">
          <h4>Qual ${report.matchNumber}${report.alliance ? ` · ${report.alliance}` : ""}<small>${ftcEscape(report.scout)}</small></h4>
          ${report.flagged ? `<p class="check-this">Check this report: the scout wasn't sure they got it right.</p>` : ""}
          ${report.noShow === "yes" ? `<p><b>No show</b></p>` : `
          <div class="answers">
            ${line("Hive tips", (report.data.autoTips ?? 0) + (report.data.teleTips ?? 0))}
            ${line("Auto scored", sum("auto"))}${line("Teleop scored", sum("tele"))}
            ${line("Auto", [report.data.autoLeave === "yes" && "leaves", report.data.autoPark === "yes" && "parks"].filter(Boolean).join(" + "))}
            ${line("Auto start", report.data.autoStart && optionLabel("autoStart", "match", report.data.autoStart))}
            ${line("End", report.data.teleParks === "yes" ? "parks" : "")}
            ${line("Blocker", report.data.blocker === "yes" ? "yes" : "")}
            ${line("Breakdown", report.data.breakdown === "yes" ? (report.data.breakdownNote || "yes") : "")}
            ${line("Fouls", (report.data.minorFouls ?? 0) + (report.data.majorFouls ?? 0))}
            ${line("Driver", report.data.driver && `${report.data.driver} / 5`)}
          </div>`}
          ${report.data.notes ? `<p>“${ftcEscape(report.data.notes)}”</p>` : ""}
        </article>`;
		});

		return cards.join("");
	}

	/* A whole "Our scouting" section for a team page. */
	function sectionHtml(mine, row) {
		const reports = mine?.matchReports ?? [];
		if (!reports.length && !(mine?.pitReports ?? []).length) return "";

		const flagged = reports.filter(report => report.flagged).length + (mine.pitReports ?? []).filter(report => report.flagged).length;
		return `
      <h3 class="section-title">Our scouting</h3>
      ${flagged ? `<p class="check-this">${plural(flagged, "report")} flagged "check this": the scout wasn't sure they got ${flagged === 1 ? "it" : "them"} right.</p>` : ""}
      <dl class="detail-grid">${cardsHtml(row, mine)}</dl>
      ${tagHtml(tagsFor(row))}
      ${pitHtml(mine)}
      <h4 class="pv-subtitle">Match reports (${reports.length})</h4>
      <div class="report-list">${reportCardsHtml(mine) || `<div class="empty-state">No match reports for this team yet.</div>`}</div>`;
	}

	return { setGame, profile, tagsFor, tagHtml, optionLabel, answerText, cardsHtml, pitHtml, reportCardsHtml, sectionHtml, helpers: { finite, num, pct, plural } };
})();
