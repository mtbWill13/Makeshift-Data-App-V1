/* FTC pit scouting page. The questions are drawn from /api/ftc/game. */

const els = {
	season: document.getElementById("seasonSelect"),
	event: document.getElementById("eventSelect"),
	custom: document.getElementById("customEvent"),
	scout: document.getElementById("scoutName"),
	team: document.getElementById("teamNumber"),
	teamNote: document.getElementById("teamNote"),
	sheetNote: document.getElementById("sheetNote"),
	queueNote: document.getElementById("queueNote"),
	formStatus: document.getElementById("formStatus"),
	form: document.getElementById("pitForm"),
	sections: document.getElementById("sections"),
	flag: document.getElementById("messedUp"),
	submit: document.getElementById("submitButton")
};

let game = null;
let picker = null;
let eventTeams = new Set();     // teams registered for this event (empty = unknown)
let lookupCount = 0;

/* Teams registered for the event, to catch a mistyped number. */
let refreshSheetNote = () => {};

async function loadEventTeams() {
	const event = picker.current();
	refreshSheetNote(event);
	try {
		eventTeams = new Set((await ftcFetch(`/api/ftc/event-teams/${event.season}/${event.code}`)).map(String));
	} catch {
		eventTeams = new Set();
	}
	showTeam();
}

/* The team's name (and "not at this event" warning) under the number box. */
async function showTeam() {
	const number = els.team.value.trim();
	const thisLookup = ++lookupCount;

	if (!/^\d{1,5}$/.test(number)) {
		els.teamNote.textContent = "";
		return;
	}

	const event = picker.current();
	const atEvent = eventTeams.size && !eventTeams.has(number);
	let name = "";

	try {
		const info = await ftcFetch(`/api/ftc/team-links/${event.season}/${number}`);
		name = info.toa?.name ?? info.team?.name ?? "";
	} catch {
		/* No name: the number still works. */
	}

	if (thisLookup !== lookupCount) return;
	els.teamNote.textContent = [name && `Team ${number}: ${name}`, atEvent && `Team ${number} isn't on this event's team list. Double check the number.`].filter(Boolean).join(" · ");
}

els.team.addEventListener("change", showTeam);

function updateQueueNote() {
	const queued = FtcScout.queuedCount("pit");
	els.queueNote.hidden = !queued;
	els.queueNote.textContent = queued
		? `${queued} pit report${queued === 1 ? " is" : "s are"} saved on this phone, waiting to upload. They send themselves when you're back online.`
		: "";
}

async function syncQueue() {
	const sent = await FtcScout.syncQueue();
	if (sent) FtcScout.toast("success", `${sent} saved report${sent === 1 ? "" : "s"} uploaded`, "They're in the database now.");
	updateQueueNote();
}

function resetForm() {
	FtcScout.render(els.sections, game.pit.sections);
	els.flag.checked = false;
	els.team.value = "";
	els.teamNote.textContent = "";
}

/* Saves the report on screen on this phone (if there is one), then opens the transfer page. */
document.getElementById("transferButton").addEventListener("click", event => {
	const chosen = picker.current();
	const scout = els.scout.value.trim();
	const team = Number(els.team.value);
	if (!els.team.value.trim() || !chosen.code) return;          // nothing on screen: just open the page

	event.preventDefault();
	if (!scout) return FtcScout.toast("error", "Not saved", "Enter your name at the top first.");
	if (!Number.isInteger(team) || team < 1) return FtcScout.toast("error", "Not saved", "Enter the team number.");

	FtcScout.store.set(FtcScout.NAME_KEY, scout);
	FtcScout.queueOnly("pit", { season: chosen.season, event: chosen.code, team, scout, flagged: els.flag.checked, answers: FtcScout.collect(els.sections, game.pit.sections) });
	window.location.href = "/ftc/transfer/";
});

els.form.addEventListener("submit", async event => {
	event.preventDefault();
	const chosen = picker.current();
	const scout = els.scout.value.trim();
	const team = Number(els.team.value);

	const problem = (message, element) => {
		FtcScout.toast("error", "Not submitted", message);
		element?.focus();
	};

	if (!scout) return problem("Enter your name at the top first.", els.scout);
	if (!chosen.code) return problem("Pick an event first.", els.event);
	if (!Number.isInteger(team) || team < 1) return problem("Enter the team number.", els.team);

	/* A team that isn't at this event is probably a typo. */
	if (eventTeams.size && !eventTeams.has(String(team)) && !confirm(`Team ${team} isn't on this event's team list. Submit it anyway?`)) return;

	FtcScout.store.set(FtcScout.NAME_KEY, scout);

	const payload = {
		season: chosen.season, event: chosen.code, team, scout,
		flagged: els.flag.checked,
		answers: FtcScout.collect(els.sections, game.pit.sections)
	};

	els.submit.disabled = true;
	els.submit.textContent = "Submitting…";

	try {
		const result = await FtcScout.submit("pit", payload);

		if (result.cancelled) {
			FtcScout.toast("warn", "Not submitted", result.message);
		} else {
			FtcScout.toast(result.queued ? "warn" : "success", result.queued ? "Saved on this phone (offline)" : "Submitted!", `Pit report for team ${team} ${result.queued ? "will upload when you're back online." : "is saved."}`);
			resetForm();
		}
	} catch (error) {
		FtcScout.toast("error", "NOT submitted", `${error.message} Your answers are still on the screen. Try again.`);
	} finally {
		els.submit.disabled = false;
		els.submit.textContent = "Submit pit report";
		updateQueueNote();
	}
});

(async () => {
	try {
		game = await FtcScout.loadGame();
	} catch (error) {
		els.formStatus.textContent = `Couldn't load the questions: ${error.message}`;
		return;
	}

	els.scout.value = FtcScout.store.get(FtcScout.NAME_KEY);
	picker = await FtcScout.eventPicker({ seasonSelect: els.season, eventSelect: els.event, customInput: els.custom, onChange: loadEventTeams });
	refreshSheetNote = FtcScout.trackSheetNote(els.sheetNote, picker);

	FtcScout.render(els.sections, game.pit.sections);
	els.form.hidden = false;
	els.formStatus.textContent = "";
	updateQueueNote();
	window.addEventListener("online", syncQueue);
	syncQueue();
	loadEventTeams();
})();
