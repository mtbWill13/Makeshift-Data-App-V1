const managed = document.getElementById("managed");
const settings = document.getElementById("settings");
const nameInput = document.getElementById("name");
const eventList = document.getElementById("eventList");

const colors = { primary: "#eb4e3f", accent: "#59a8d7" };
let colorProblemText = "";

async function api(url, method = "GET", body) {
	const response = await fetch(url, {
		method,
		headers: body ? { "Content-Type": "application/json" } : undefined,
		body: body ? JSON.stringify(body) : undefined
	});
	const data = await response.json().catch(() => ({}));
	return { ok: response.ok, data };
}

function say(id, text, kind = "") {
	const element = document.getElementById(id);
	element.textContent = text;
	element.className = `form-message${kind ? ` ${kind}` : ""}`;
}

/* Keeps this page and the saved team in step after any change. */
function showTeamChanges(data) {
	rememberTeam({ ...window.TEAM, ...data });
	window.TEAM = { ...window.TEAM, ...data };
	drawEvents(data.events);
}

function drawEvents(events) {
	if (!events.length) {
		const empty = document.createElement("li");
		empty.className = "no-sheets";
		empty.textContent = "No events yet. Add your first one below. Every page's event dropdown is built from this list.";
		eventList.replaceChildren(empty);
		return;
	}

	eventList.replaceChildren(...events.map(event => {
		const item = document.createElement("li");
		const title = document.createElement("strong");
		title.textContent = event.name;
		const key = document.createElement("span");
		key.textContent = event.key;
		const sheet = document.createElement("span");
		sheet.className = event.hasSheet ? "sheet-on" : "sheet-off";
		sheet.textContent = event.hasSheet ? "Sheet connected" : "No sheet yet";
		const edit = document.createElement("button");
		edit.type = "button";
		edit.className = "secondary-button small-button";
		edit.textContent = event.hasSheet ? "Edit" : "Connect sheet";
		edit.addEventListener("click", () => {
			document.getElementById("eventName").value = event.name;
			document.getElementById("eventKey").value = event.key;
			document.getElementById("sheet").value = "";
			document.getElementById("sheet").focus();
			say("eventMessage", event.hasSheet ? "Paste a new sheet link to replace this event's sheet, or change the name." : "Paste this event's sheet link, then save.");
		});
		const remove = document.createElement("button");
		remove.type = "button";
		remove.className = "secondary-button small-button";
		remove.textContent = "Remove";
		remove.addEventListener("click", async () => {
			if (!confirm(`Remove ${event.name}? Your Google Sheet isn't deleted; the event just disappears from this site.`)) return;
			const { ok, data } = await api(`/api/team/events/${encodeURIComponent(event.key)}`, "DELETE");
			if (!ok) return say("eventMessage", data.error || "Couldn't remove that event.", "bad");
			showTeamChanges(data);
			say("eventMessage", `Removed ${event.name}.`, "good");
		});
		item.append(title, key, sheet, edit, remove);
		return item;
	}));
}

/* The team's events on The Blue Alliance can fill in a name and key. */
function drawQuickFill(tbaEvents) {
	const row = document.getElementById("quickFillRow");
	const select = document.getElementById("quickFill");
	row.hidden = !tbaEvents.length;
	if (!tbaEvents.length) return;

	select.replaceChildren(new Option("Pick one to fill in the name and key…", ""), ...tbaEvents.map(event => new Option(`${event.name} (${event.key})`, event.key)));
	select.onchange = () => {
		const event = tbaEvents.find(other => other.key === select.value);
		if (!event) return;
		document.getElementById("eventName").value = event.name;
		document.getElementById("eventKey").value = event.key;
	};
}

async function start() {
	const { ok, data: team } = await api("/api/team");
	if (!ok) return;

	if (team.legacy) {
		managed.hidden = false;
		return;
	}

	settings.hidden = false;
	nameInput.value = team.name;
	colors.primary = team.colors.primary;
	colors.accent = team.colors.accent;
	mountColorPicker(document.getElementById("colorPicker"), colors, problem => { colorProblemText = problem; });
	showTeamChanges(team);
	drawQuickFill(team.tbaEvents ?? []);
	document.getElementById("serviceEmail").textContent = team.serviceAccountEmail || "(ask the site owner)";

	if (team.templateUrl) {
		const link = document.createElement("a");
		link.href = team.templateUrl;
		link.target = "_blank";
		link.rel = "noopener noreferrer";
		link.textContent = "Open the team template sheet ↗";
		document.getElementById("templateLink").replaceChildren(link);
	}
}

document.getElementById("profileForm").addEventListener("submit", async event => {
	event.preventDefault();
	if (colorProblemText) return say("profileMessage", colorProblemText, "bad");

	const { ok, data } = await api("/api/team/profile", "POST", { name: nameInput.value, colors });
	if (!ok) return say("profileMessage", data.error || "Couldn't save.", "bad");

	rememberTeam(data);
	say("profileMessage", "Saved.", "good");
	setTimeout(() => window.location.reload(), 600);
});

document.getElementById("eventForm").addEventListener("submit", async event => {
	event.preventDefault();
	const save = document.getElementById("eventSave");
	const hasSheet = document.getElementById("sheet").value.trim() !== "";
	save.disabled = true;
	say("eventMessage", hasSheet ? "Checking your sheet…" : "Saving…");

	const { ok, data } = await api("/api/team/events", "POST", {
		name: document.getElementById("eventName").value,
		key: document.getElementById("eventKey").value,
		sheet: document.getElementById("sheet").value
	});

	save.disabled = false;
	if (!ok) return say("eventMessage", data.error || "Couldn't save that event.", "bad");

	showTeamChanges(data);
	for (const id of ["eventName", "eventKey", "sheet"]) document.getElementById(id).value = "";
	document.getElementById("quickFill").value = "";
	say("eventMessage", hasSheet ? "Saved. Your scouting data will show for that event on every page." : "Saved. Connect its sheet any time.", "good");
});

document.getElementById("passwordForm").addEventListener("submit", async event => {
	event.preventDefault();
	const { ok, data } = await api("/api/team/passwords", "POST", {
		current: document.getElementById("current").value,
		password: document.getElementById("newPassword").value,
		scoutPasscode: document.getElementById("newScout").value
	});

	if (!ok) return say("passwordMessage", data.error || "Couldn't save.", "bad");

	for (const id of ["current", "newPassword", "newScout"]) document.getElementById(id).value = "";
	say("passwordMessage", "Saved.", "good");
});

document.getElementById("deleteForm").addEventListener("submit", async event => {
	event.preventDefault();
	const button = document.getElementById("deleteSave");

	if (!confirm(`Delete the account for team ${window.TEAM?.number ?? ""}? This can't be undone.`)) return;

	button.disabled = true;
	const { ok, data } = await api("/api/team/delete", "POST", {
		password: document.getElementById("deletePassword").value,
		confirm: document.getElementById("deleteConfirm").value
	});

	if (!ok) {
		button.disabled = false;
		return say("deleteMessage", data.error || "Couldn't delete the account.", "bad");
	}

	try {
		localStorage.removeItem(TEAM_STORAGE_KEY);
	} catch {
		/* nothing to clear */
	}
	window.location.replace("/login/");
});

document.getElementById("logout").addEventListener("click", logoutTeam);

start();
