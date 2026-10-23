document.addEventListener("wheel", event => {
	if (document.activeElement.type == "number") {
		document.activeElement.blur();
	}
});

/* If the login has expired (or the team password was changed), any data request
   comes back 401 with { login: true }. Send the person to the login page and
   bring them back here after. Other 401s (a wrong password on a
   settings form) are ordinary errors for the page to show. */
const nativeFetch = window.fetch.bind(window);
const onAuthPage = /^\/(login|signup)(\/|$)/.test(window.location.pathname);

function sendToLogin() {
	window.location.href = `/login/?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
}

window.fetch = async (...args) => {
	const response = await nativeFetch(...args);

	if (response.status === 401 && !onAuthPage) {
		const url = new URL(typeof args[0] === "string" ? args[0] : args[0].url, window.location.href);
		if (url.origin === window.location.origin && url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/login")) {
			const body = await response.clone().json().catch(() => ({}));
			if (body.login) sendToLogin();
		}
	}

	return response;
};


/* =================================
   TEAM
   Each team account has its own name, colours and events. The server says who
   is logged in (/api/team); it's kept in localStorage so a page can use it the
   moment it loads, then re-checked in the background.
================================= */

const TEAM_STORAGE_KEY = "makeshift-team";

function storedTeam() {
	try {
		return JSON.parse(localStorage.getItem(TEAM_STORAGE_KEY));
	} catch {
		return null;
	}
}

function rememberTeam(team) {
	try {
		localStorage.setItem(TEAM_STORAGE_KEY, JSON.stringify({
			number: team.number, name: team.name, colors: team.colors, legacy: team.legacy,
			events: team.events, eventChoices: team.eventChoices ?? []
		}));
	} catch {
		/* Private mode: the page just asks the server each time. */
	}
}

/* First visit in this browser (or storage cleared): ask once, before the page draws. */
function fetchTeamNow() {
	try {
		const request = new XMLHttpRequest();
		request.open("GET", "/api/team", false);
		request.send();
		if (request.status === 401) return sendToLogin();
		return request.status === 200 ? JSON.parse(request.responseText) : null;
	} catch {
		return null;
	}
}

/* Pages with an event dropdown get this team's events (its events on The Blue
   Alliance plus any with a connected sheet) instead of the built-in list. */
function applyTeamEvents(team) {
	if (team.legacy) return;

	const choices = team.eventChoices ?? [];

	for (const id of ["eventKey", "EventKeys"]) {
		const select = document.getElementById(id);
		if (!select) continue;

		/* Built-in choices that aren't events stay: "Entire Season", and anything marked data-keep. */
		const season = [...select.options].filter(option => option.value === "season");
		const kept = [...select.options].filter(option => option.value === "season" || option.hasAttribute("data-keep"));
		const options = choices.map(event => new Option(event.name, event.key));
		if (!options.length) options.push(new Option("No events yet: add some in Team settings", ""));
		select.replaceChildren(...kept, ...options);

		/* Most pages start on "Entire Season". Pages marked data-default-event (the
		   picklist) and pages with no season choice start on the latest event that
		   has a sheet (else the latest). */
		const start = choices.findLast(event => event.hasSheet) ?? choices.at(-1);
		select.value = season.length && !select.hasAttribute("data-default-event") ? "season" : start?.key ?? "";
	}
}

function applyTeam(team) {
	window.TEAM = team;

	if (!team.legacy) {
		for (const brand of document.querySelectorAll(".brand")) {
			const name = document.createElement("span");
			name.textContent = team.name;
			const number = document.createElement("b");
			number.textContent = team.number;
			brand.classList.add("brand-text");
			brand.replaceChildren(name, number);
		}
		for (const element of document.querySelectorAll("[data-team-settings]")) element.hidden = false;
	}

	for (const element of document.querySelectorAll("[data-team-number]")) element.textContent = team.number;
	for (const element of document.querySelectorAll("[data-team-name]")) element.textContent = team.name;
	applyTeamEvents(team);
}

async function logoutTeam() {
	await nativeFetch("/api/logout", { method: "POST" }).catch(() => {});
	try {
		localStorage.removeItem(TEAM_STORAGE_KEY);
	} catch {
		/* nothing to clear */
	}
	window.location.href = "/login/";
}

if (!onAuthPage) {
	const known = storedTeam() ?? fetchTeamNow();

	if (known) {
		rememberTeam(known);
		applyTeam(known);

		/* Changed on the server (settings edited elsewhere, or a different team's
		   login in this browser)? Pick it up, once. */
		nativeFetch("/api/team").then(response => response.ok ? response.json() : null).then(fresh => {
			if (!fresh) return;
			const before = JSON.stringify({ n: known.number, a: known.name, c: known.colors, e: known.events, x: known.eventChoices });
			const after = JSON.stringify({ n: fresh.number, a: fresh.name, c: fresh.colors, e: fresh.events, x: fresh.eventChoices });
			rememberTeam(fresh);
			if (before !== after) window.location.reload();
		}).catch(() => {});
	}
}
