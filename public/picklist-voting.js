/* Live picklist voting: thumbs up / down and comments on every team, shared by everyone on the team's
   account. Used by both the FRC and FTC picklists. The page defines window.picklistBoard() (which
   picklist is showing) and, optionally, window.picklistVotesChanged() (called when votes change). */
(() => {
	const POLL_MS = 3000;
	const ID_KEY = "picklist-voter-id";
	const NAME_KEY = "picklist-voter-name";

	const store = {
		get(key) { try { return localStorage.getItem(key); } catch { return null; } },
		set(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } }
	};

	const newId = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`).slice(0, 36);
	let voterId = store.get(ID_KEY);
	if (!voterId) { voterId = newId(); store.set(ID_KEY, voterId); }

	const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

	let board = null;
	let state = { version: 0, teams: {} };
	let live = null;          // true / false once the first poll has answered
	let openTeam = null;      // the team whose dialog is open
	let bar = null;
	let dialog = null;

	const entry = team => state.teams[team] ?? { up: [], down: [], comments: [] };
	const myVote = team => entry(team).up.some(v => v.voter === voterId) ? 1 : entry(team).down.some(v => v.voter === voterId) ? -1 : 0;
	const nameInput = () => bar?.querySelector(".vote-name");
	const myName = () => (nameInput()?.value ?? store.get(NAME_KEY) ?? "").trim();

	/* Net votes (up minus down) for a team, or null when nobody has voted. */
	function score(team) {
		const item = entry(String(team));
		return item.up.length + item.down.length ? item.up.length - item.down.length : null;
	}

	function widgetHtml(team) {
		const item = entry(team);
		const mine = myVote(team);
		return `<button class="vote-btn up" type="button" data-vote="1" aria-pressed="${mine === 1}" title="Vote for ${team}">▲ <b>${item.up.length}</b></button>`
			+ `<button class="vote-btn down" type="button" data-vote="-1" aria-pressed="${mine === -1}" title="Vote against ${team}">▼ <b>${item.down.length}</b></button>`
			+ `<button class="vote-comments${item.comments.length ? " has" : ""}" type="button" data-comments title="Comments on ${team}">Comments${item.comments.length ? ` <b>${item.comments.length}</b>` : ""}</button>`;
	}

	/* Adds (or refreshes) the vote buttons on every team row and picklist entry. */
	function decorate() {
		for (const row of document.querySelectorAll(".pool-row[data-team], .entry[data-team]")) {
			const host = row.querySelector(".pool-team, .entry-title");
			if (!host) continue;
			let widget = host.querySelector(":scope > .vote-widget");
			if (!widget) {
				widget = document.createElement("span");
				widget.className = "vote-widget";
				host.append(widget);
			}
			widget.dataset.voteTeam = row.dataset.team;
			const html = widgetHtml(row.dataset.team);
			if (widget.dataset.html !== html) { widget.innerHTML = html; widget.dataset.html = html; }
		}
	}

	function renderDialog() {
		if (!dialog?.open || !openTeam) return;
		const item = entry(openTeam);
		const mine = myVote(openTeam);
		const names = list => list.length ? list.map(v => escapeHtml(v.name)).join(", ") : "nobody yet";

		dialog.querySelector(".vote-dialog-body").innerHTML = `
			<div class="vote-tally">
				<button class="vote-btn up" type="button" data-vote="1" aria-pressed="${mine === 1}">▲ For <b>${item.up.length}</b></button>
				<button class="vote-btn down" type="button" data-vote="-1" aria-pressed="${mine === -1}">▼ Against <b>${item.down.length}</b></button>
			</div>
			<p class="vote-names"><span>For:</span> ${names(item.up)}</p>
			<p class="vote-names"><span>Against:</span> ${names(item.down)}</p>
			<h4>Comments</h4>
			<ul class="vote-comment-list">${item.comments.length ? item.comments.map(c => `
				<li><div><b>${escapeHtml(c.name)}</b> <small>${new Date(c.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small>
				${c.voter === voterId ? `<button class="vote-delete" type="button" data-delete-comment="${c.id}" aria-label="Delete your comment">✕</button>` : ""}</div>
				<p>${escapeHtml(c.text)}</p></li>`).join("") : `<li class="vote-empty">No comments yet.</li>`}</ul>`;
	}

	function applyState(next) {
		if (!next || !next.changed) return;
		state = { version: next.version, teams: next.teams ?? {} };
		decorate();
		if (dialog?.open) renderDialog();
		window.picklistVotesChanged?.();
	}

	function setStatus(text, kind = "") {
		const status = bar?.querySelector(".vote-status");
		if (!status) return;
		status.textContent = text;
		status.dataset.kind = kind;
	}

	async function api(path, options) {
		const response = await fetch(`/api/picklist/${encodeURIComponent(board)}/${path}`, options);
		const data = await response.json().catch(() => ({}));
		if (!response.ok) throw new Error(data.error || "Voting didn't work.");
		return data;
	}

	async function poll() {
		if (document.hidden) return;
		const wanted = window.picklistBoard?.();
		if (!wanted) return;
		if (wanted !== board) {
			board = wanted;
			state = { version: 0, teams: {} };
			decorate();
			window.picklistVotesChanged?.();
		}

		try {
			applyState(await api(`votes?since=${state.version}`));
			if (live !== true) { live = true; setStatus("Live", "on"); }
		} catch (error) {
			live = false;
			setStatus(error.message === "Please log in." ? "Log in again to vote" : "Offline, retrying…", "off");
		}
	}

	function needName() {
		if (myName()) return false;
		setStatus("Enter your name to vote", "warn");
		nameInput()?.focus();
		return true;
	}

	async function vote(team, value) {
		if (needName()) return;
		const next = myVote(team) === value ? 0 : value;

		/* Show it straight away; the answer from the server then replaces this. */
		const item = entry(team);
		const updated = { up: item.up.filter(v => v.voter !== voterId), down: item.down.filter(v => v.voter !== voterId), comments: item.comments };
		if (next === 1) updated.up.push({ voter: voterId, name: myName() });
		if (next === -1) updated.down.push({ voter: voterId, name: myName() });
		state.teams[team] = updated;
		decorate();
		renderDialog();
		window.picklistVotesChanged?.();

		try {
			applyState(await api("vote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ team, vote: next, voter: voterId, name: myName() }) }));
		} catch (error) {
			setStatus(error.message, "warn");
			state.version = 0;
			poll();
		}
	}

	function openComments(team) {
		openTeam = team;
		dialog.querySelector(".vote-dialog-title").textContent = `Team ${team}`;
		dialog.querySelector("textarea").value = "";
		dialog.querySelector(".vote-dialog-error").textContent = "";
		dialog.showModal();
		renderDialog();
	}

	async function postComment(event) {
		event.preventDefault();
		if (needName()) { dialog.querySelector(".vote-dialog-error").textContent = "Enter your name at the top of the page first."; return; }
		const box = dialog.querySelector("textarea");
		const text = box.value.trim();
		if (!text) return;

		try {
			applyState(await api("comment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ team: openTeam, text, voter: voterId, name: myName() }) }));
			box.value = "";
			dialog.querySelector(".vote-dialog-error").textContent = "";
		} catch (error) {
			dialog.querySelector(".vote-dialog-error").textContent = error.message;
		}
	}

	function build() {
		const layout = document.querySelector(".picklist-layout");
		if (!layout) return;

		bar = document.createElement("section");
		bar.className = "vote-bar";
		bar.innerHTML = `
			<strong>Team voting</strong>
			<label>Your name <input class="vote-name" type="text" maxlength="30" autocomplete="name" placeholder="So votes show who made them"></label>
			<button class="secondary-button small vote-sort" type="button">Rank teams by votes</button>
			<span class="vote-status" aria-live="polite" data-kind="">Connecting…</span>`;
		layout.before(bar);

		nameInput().value = store.get(NAME_KEY) ?? "";
		nameInput().addEventListener("change", () => { store.set(NAME_KEY, nameInput().value.trim()); setStatus(live ? "Live" : "Connecting…", live ? "on" : ""); });
		bar.querySelector(".vote-sort").addEventListener("click", () => {
			if (typeof sortBy === "function" && typeof prefs !== "undefined") {
				if (!prefs.columns.includes("votes")) { prefs.columns = [...prefs.columns.slice(0, -1), "votes"]; if (typeof renderColumns === "function") renderColumns(); }
				prefs.sort = { key: "votes", dir: -1 };
				if (typeof savePrefs === "function") savePrefs();
				if (typeof renderPool === "function") renderPool();
			}
		});

		dialog = document.createElement("dialog");
		dialog.className = "vote-dialog";
		dialog.innerHTML = `
			<form method="dialog" class="vote-dialog-head"><h3 class="vote-dialog-title"></h3><button class="icon-button" aria-label="Close">✕</button></form>
			<div class="vote-dialog-body"></div>
			<form class="vote-comment-form">
				<textarea rows="3" maxlength="300" placeholder="Add a comment for everyone on the team"></textarea>
				<p class="vote-dialog-error" role="alert"></p>
				<button type="submit">Post comment</button>
			</form>`;
		document.body.append(dialog);
		dialog.querySelector(".vote-comment-form").addEventListener("submit", postComment);
		dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
		dialog.addEventListener("close", () => { openTeam = null; });

		document.addEventListener("click", async event => {
			const widget = event.target.closest(".vote-widget, .vote-tally");
			const voteButton = event.target.closest("[data-vote]");
			if (voteButton) {
				const team = voteButton.closest(".vote-widget")?.dataset.voteTeam ?? openTeam;
				if (team) vote(team, Number(voteButton.dataset.vote));
				return;
			}

			const commentsButton = event.target.closest("[data-comments]");
			if (commentsButton && widget) return openComments(widget.dataset.voteTeam);

			const del = event.target.closest("[data-delete-comment]");
			if (del) {
				try {
					applyState(await api(`comment/${del.dataset.deleteComment}?voter=${encodeURIComponent(voterId)}`, { method: "DELETE" }));
				} catch (error) {
					dialog.querySelector(".vote-dialog-error").textContent = error.message;
				}
			}
		});

		/* The page redraws its team rows whenever it sorts or filters: add the buttons to the new rows. */
		const watch = new MutationObserver(() => decorate());
		for (const id of ["pool", "lists"]) {
			const element = document.getElementById(id);
			if (element) watch.observe(element, { childList: true, subtree: true });
		}

		document.addEventListener("visibilitychange", poll);
		setInterval(poll, POLL_MS);
		poll();
	}

	window.PicklistVoting = { score, poll };
	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
	else build();
})();
