/* =================================
   SCOUT BETS
   Earn points by scouting, bet them on upcoming matches. The server decides
   everything that matters (odds, who may bet, payouts); this page just shows it.
================================= */

const eventSelect = document.getElementById("eventKey");
const setupNotice = document.getElementById("setupNotice");
const balanceBar = document.getElementById("balanceBar");
const balanceElement = document.getElementById("balance");
const matchesElement = document.getElementById("matches");
const myBetsElement = document.getElementById("myBets");
const leaderboardElement = document.getElementById("leaderboard");
const ledgerElement = document.getElementById("ledger");

let balance = 0;
let startingPoints = 15;
let loadId = 0;

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
	"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

const percent = value => `${Math.round(value * 100)}%`;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const side = pick => pick === "red" ? "Red" : "Blue";

async function api(url, options) {
	const response = await fetch(url, options);
	const data = await response.json().catch(() => ({}));
	if (!response.ok) {
		const error = new Error(data.error || "Something went wrong.");
		error.setup = data.setup;
		throw error;
	}
	return data;
}

function when(milliseconds) {
	if (!milliseconds) return "";
	const minutes = Math.round((milliseconds - Date.now()) / 60000);
	const clock = new Date(milliseconds).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
	if (minutes <= 0) return `starting now (${clock})`;
	return minutes < 60 ? `in about ${plural(minutes, "minute")} (${clock})` : clock;
}

/* The made-up test event (BETS_FAKE_EVENT=1): an extra choice in the dropdown and a free-points button. */
function showFakeEvent(fake) {
	const grant = document.getElementById("grantPoints");
	grant.hidden = !fake;
	document.getElementById("resetPoints").hidden = !fake;
	if (!fake || [...eventSelect.options].some(option => option.value === fake.key)) return;

	const option = new Option(`${fake.name} (for testing)`, fake.key);
	option.setAttribute("data-keep", "");
	eventSelect.add(option, 0);
	eventSelect.value = fake.key;
}

/* ----- balance, history, leaderboard ----- */

function showBalance(points) {
	balance = points;
	balanceElement.textContent = points;
}

async function loadAccount() {
	const me = await api("/api/bets/me");

	setupNotice.hidden = true;
	balanceBar.hidden = false;
	document.getElementById("playerName").textContent = me.user.anonymous ? `Playing as ${me.user.name} (this browser)` : me.user.name;
	document.getElementById("nameForm").hidden = !me.user.anonymous;
	document.getElementById("earnWelcome").textContent = me.rules.welcome;
	startingPoints = me.rules.welcome;
	document.getElementById("earnMatch").textContent = me.rules.matchReport;
	document.getElementById("earnPit").textContent = me.rules.pitReport;
	showBalance(me.user.points);
	showFakeEvent(me.fakeEvent);

	ledgerElement.innerHTML = me.ledger.length
		? `<ul class="ledger">${me.ledger.map(entry => `<li><b class="${entry.delta < 0 ? "minus" : "plus"}">${entry.delta > 0 ? "+" : ""}${entry.delta}</b><span>${escapeHtml(entry.reason)}</span></li>`).join("")}</ul>`
		: `<div class="empty-state">Nothing yet.</div>`;
	return true;
}

async function loadLeaderboard() {
	const { players } = await api("/api/bets/leaderboard");

	leaderboardElement.innerHTML = players.length
		? `<ol class="leaderboard">${players.map(player => `
          <li class="${player.isYou ? "you" : ""}">
            <span class="name">${escapeHtml(player.name)}${player.isYou ? " (you)" : ""}<small>${plural(player.reports, "report")} scouted${player.decided ? ` · ${player.wins}/${player.decided} bets won` : ""}</small></span>
            <strong>${player.points}</strong>
          </li>`).join("")}</ol>`
		: `<div class="empty-state">No players yet.</div>`;
}

async function loadMyBets() {
	const { bets, balance: points } = await api("/api/bets/mine");
	showBalance(points);

	const describe = bet => {
		if (bet.status === "won") return `<b class="win">Won +${bet.payout - bet.stake}</b>`;
		if (bet.status === "lost") return `<b class="loss">Lost −${bet.stake}</b>`;
		if (bet.status === "refunded") return `<b>Tie, refunded</b>`;
		return `<b class="open">Open · wins ${Math.round(bet.stake * bet.multiplier)}</b>`;
	};

	myBetsElement.innerHTML = bets.length
		? `<ul class="my-bets">${bets.map(bet => `
          <li class="${bet.pick}">
            <span><b>${escapeHtml(bet.label)}</b><small>${bet.stake} on ${side(bet.pick)} at ×${bet.multiplier.toFixed(2)}</small></span>
            ${describe(bet)}
          </li>`).join("")}</ul>`
		: `<div class="empty-state">No bets yet. Pick a match above.</div>`;
}

/* ----- matches ----- */

function allianceButton(match, pick) {
	return `
      <label class="pick ${pick}">
        <input type="radio" name="pick-${escapeHtml(match.key)}" value="${pick}">
        <span>
          <b>${side(pick)} alliance</b>
          <ul class="pick-teams">${match[pick].map(team => `<li>${team}</li>`).join("")}</ul>
        </span>
      </label>`;
}

function matchCard(match) {
	const bet = match.myBet;
	const breakdown = `/overview/?event=${encodeURIComponent(eventSelect.value)}&match=${encodeURIComponent(match.code.replace(/^qm/, ""))}`;

	let action;
	if (bet) {
		action = `<p class="placed ${bet.pick}">You bet <b>${bet.stake}</b> on <b>${side(bet.pick)}</b> at ×${bet.multiplier.toFixed(2)}. It wins <b>${Math.round(bet.stake * bet.multiplier)}</b>.</p>`;
	} else if (!match.open) {
		action = `<p class="closed">Betting is closed for this match.</p>`;
	} else if (balance < 1) {
		action = `<p class="closed">You're out of points. Scout a match to earn more.</p>`;
	} else {
		action = `
        <div class="stake-row">
          <label>Points to bet
            <input type="number" class="stake" min="1" max="${balance}" step="1" inputmode="numeric" value="${Math.min(balance, 3)}">
          </label>
          <div class="quick">
            <button type="button" class="quick-stake" data-stake="1">1</button>
            <button type="button" class="quick-stake" data-stake="5">5</button>
            <button type="button" class="quick-stake" data-stake="${balance}">All in</button>
          </div>
          <button type="button" class="place-bet" data-key="${escapeHtml(match.key)}">Place bet</button>
        </div>
        <p class="would-win" aria-live="polite">Odds are hidden. Know the teams: long shots pay more. You'll see your payout once you bet.</p>`;
	}

	return `
      <article class="bet-match" data-key="${escapeHtml(match.key)}">
        <div class="bet-match-head">
          <h3>${escapeHtml(match.label)}</h3>
          <span>${escapeHtml(when(match.time))}</span>
          <a href="${breakdown}" target="_blank" rel="noopener">Match breakdown →</a>
        </div>
        <div class="picks">${allianceButton(match, "red")}${allianceButton(match, "blue")}</div>
        ${action}
        ${eventSelect.value === "2026fake" ? `<button type="button" class="play-now" data-key="${escapeHtml(match.key)}">▶ Run this match now (test only)</button>` : ""}
        <p class="bet-error" role="alert" hidden></p>
      </article>`;
}

let currentMatches = [];

async function loadMatches() {
	const thisLoad = ++loadId;
	if (!eventSelect.value) {
		matchesElement.innerHTML = `<div class="empty-state">Add your events in Team settings first.</div>`;
		return;
	}

	try {
		const { matches } = await api(`/api/bets/${eventSelect.value}/matches`);
		if (thisLoad !== loadId) return;
		currentMatches = matches;
		matchesElement.innerHTML = matches.length
			? matches.map(matchCard).join("")
			: `<div class="empty-state">No upcoming matches right now.</div>`;
	} catch (error) {
		if (thisLoad !== loadId) return;
		matchesElement.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
	}
}

matchesElement.addEventListener("click", async event => {
	const card = event.target.closest(".bet-match");
	if (!card) return;

	const quick = event.target.closest(".quick-stake");
	if (quick) {
		card.querySelector(".stake").value = quick.dataset.stake;
		return;
	}

	const play = event.target.closest(".play-now");
	if (play) {
		play.disabled = true;
		try {
			await api("/api/bets/fake/play", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ matchKey: play.dataset.key })
			});
			await refresh();
		} catch (failure) {
			play.disabled = false;
			card.querySelector(".bet-error").textContent = failure.message;
			card.querySelector(".bet-error").hidden = false;
		}
		return;
	}

	const button = event.target.closest(".place-bet");
	if (!button) return;

	const error = card.querySelector(".bet-error");
	const pick = card.querySelector("input[type=radio]:checked")?.value;
	const stake = Math.floor(Number(card.querySelector(".stake").value));
	error.hidden = true;

	if (!pick) {
		error.textContent = "Pick the red or the blue alliance first.";
		error.hidden = false;
		return;
	}
	if (!(stake >= 1)) {
		error.textContent = "Bet at least 1 point.";
		error.hidden = false;
		return;
	}

	button.disabled = true;
	try {
		await api(`/api/bets/${eventSelect.value}/bet`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ matchKey: card.dataset.key, pick, stake })
		});
		await refresh();
	} catch (failure) {
		error.textContent = failure.message;
		error.hidden = false;
		button.disabled = false;
	}
});

/* ----- load everything ----- */

async function refresh() {
	if (!(await loadAccount().catch(() => false))) {
		matchesElement.innerHTML = "";
		return;
	}
	await Promise.all([loadMyBets(), loadLeaderboard()]);
	await loadMatches();
}

document.getElementById("grantPoints").addEventListener("click", async () => {
	await api("/api/bets/fake/grant", { method: "POST" });
	await refresh();
});

document.getElementById("resetPoints").addEventListener("click", async () => {
	if (!confirm(`Reset your points to the starting ${startingPoints} and clear your bets on the test event? The matches stay as they are.`)) return;
	await api("/api/bets/fake/reset-points", { method: "POST" });
	await refresh();
});

document.getElementById("nameForm").addEventListener("submit", async event => {
	event.preventDefault();
	const input = document.getElementById("nameInput");
	try {
		await api("/api/bets/name", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: input.value })
		});
		input.value = "";
		await refresh();
	} catch (error) {
		input.setCustomValidity(error.message);
		input.reportValidity();
		input.setCustomValidity("");
	}
});

eventSelect.addEventListener("change", loadMatches);

/* Keep matches, bets and balances current, but don't redraw while someone is typing a bet.
   The fast-moving test event refreshes every 10 seconds. */
function scheduleRefresh() {
	setTimeout(() => {
		if (!document.hidden && !matchesElement.contains(document.activeElement)) {
			refresh().catch(() => { /* try again next time */ });
		}
		scheduleRefresh();
	}, eventSelect.value === "2026fake" ? 10 * 1000 : 60 * 1000);
}
scheduleRefresh();

/* A match leaves the dashboard the moment its betting closes, without waiting for the next refresh. */
setInterval(() => {
	for (const match of currentMatches) {
		if (match.closesAt && Date.now() >= match.closesAt) {
			matchesElement.querySelector(`.bet-match[data-key="${match.key}"]`)?.remove();
		}
	}
}, 2000);

refresh().catch(error => {
	setupNotice.textContent = error.message;
	setupNotice.hidden = false;
});
