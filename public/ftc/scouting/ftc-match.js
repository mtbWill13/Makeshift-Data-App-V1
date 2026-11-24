/* FTC match scouting page. The questions are drawn from /api/ftc/game. */

const els = {
	season: document.getElementById("seasonSelect"),
	event: document.getElementById("eventSelect"),
	custom: document.getElementById("customEvent"),
	scout: document.getElementById("scoutName"),
	scheduleNote: document.getElementById("scheduleNote"),
	sheetNote: document.getElementById("sheetNote"),
	panel: document.getElementById("assignmentPanel"),
	startingMatch: document.getElementById("startingMatch"),
	stations: document.getElementById("stationPicker"),
	setAssignment: document.getElementById("setAssignment"),
	assignmentStatus: document.getElementById("assignmentStatus"),
	bar: document.getElementById("assignmentBar"),
	barText: document.getElementById("assignmentText"),
	change: document.getElementById("changeAssignment"),
	queueNote: document.getElementById("queueNote"),
	formStatus: document.getElementById("formStatus"),
	form: document.getElementById("matchForm"),
	matchNumber: document.getElementById("matchNumber"),
	team: document.getElementById("teamNumber"),
	sections: document.getElementById("sections"),
	flag: document.getElementById("messedUp"),
	submit: document.getElementById("submitButton")
};

const ASSIGNMENT_KEY = "ftc-scout-assignment";
const STATIONS = [
	{ code: "r1", alliance: "red", index: 0, label: "Red 1" },
	{ code: "r2", alliance: "red", index: 1, label: "Red 2" },
	{ code: "b1", alliance: "blue", index: 0, label: "Blue 1" },
	{ code: "b2", alliance: "blue", index: 1, label: "Blue 2" }
];

let game = null;
let picker = null;
let schedule = [];
let typedTeam = false;        // a scout who typed a team number keeps it
let loadCount = 0;

/* ----- schedule and assignment ----- */

const teamAt = (matchNumber, station) => {
	const match = schedule.find(item => item.level === "Quals" && Number(item.id) === Number(matchNumber));
	const spot = STATIONS.find(item => item.code === station);
	return match && spot ? match[spot.alliance].teams[spot.index] ?? null : null;
};

const savedAssignment = () => {
	try { return JSON.parse(FtcScout.store.get(ASSIGNMENT_KEY, "null")); } catch { return null; }
};

const currentAssignment = () => {
	const saved = savedAssignment();
	const event = picker.current();
	return saved && saved.season === event.season && saved.code === event.code ? saved : null;
};

function drawStations() {
	const selected = els.stations.dataset.picked ?? "";
	els.stations.innerHTML = STATIONS.map(station => {
		const team = teamAt(els.startingMatch.value, station.code);
		return `<label class="choice ${station.alliance}"><input type="radio" name="station" value="${station.code}"${selected === station.code ? " checked" : ""}><span>${station.label}${team ? `<small>team ${team}</small>` : ""}</span></label>`;
	}).join("");
}

els.stations.addEventListener("change", event => { els.stations.dataset.picked = event.target.value; });
els.startingMatch.addEventListener("input", drawStations);

let refreshSheetNote = () => {};

async function loadSchedule() {
	const event = picker.current();
	refreshSheetNote(event);
	const thisLoad = ++loadCount;
	els.scheduleNote.textContent = "Loading the match schedule…";

	try {
		const data = await ftcFetch(`/api/ftc/schedule/${event.season}/${event.code}`);
		if (thisLoad !== loadCount) return;
		schedule = data.matches;
		els.scheduleNote.textContent = schedule.length
			? `${schedule.filter(match => match.level === "Quals").length} qualification matches from ${data.source}. Teams fill in automatically.`
			: "No schedule is published for this event yet. Type the team number yourself.";
	} catch (error) {
		if (thisLoad !== loadCount) return;
		schedule = [];
		els.scheduleNote.textContent = "Couldn't load the schedule. Type the team number yourself.";
	}

	drawStations();
	applyAssignment();
}

/* Fills the match, alliance and team from the saved assignment. */
function applyAssignment() {
	const assignment = currentAssignment();
	els.panel.hidden = Boolean(assignment);
	els.bar.hidden = !assignment;
	if (!assignment) return;

	const station = STATIONS.find(item => item.code === assignment.station);
	const team = teamAt(assignment.matchNumber, assignment.station);
	els.barText.innerHTML = `<strong>Qual ${ftcEscape(assignment.matchNumber)} · ${station.label}</strong>${team ? ` · team ${ftcEscape(team)}` : ""}`;
	els.matchNumber.value = assignment.matchNumber;
	els.form.querySelector(`input[name="alliance"][value="${station.alliance}"]`).checked = true;
	if (!typedTeam) els.team.value = team ?? "";
}

els.setAssignment.addEventListener("click", () => {
	const matchNumber = Number(els.startingMatch.value);
	const station = els.stations.dataset.picked;

	if (!Number.isInteger(matchNumber) || matchNumber < 1) {
		els.assignmentStatus.textContent = "Enter a starting match from 1 to 999.";
		return;
	}
	if (!station) {
		els.assignmentStatus.textContent = "Pick your station.";
		return;
	}

	const event = picker.current();
	FtcScout.store.set(ASSIGNMENT_KEY, JSON.stringify({ season: event.season, code: event.code, matchNumber, station }));
	els.assignmentStatus.textContent = "";
	typedTeam = false;
	applyAssignment();
});

els.change.addEventListener("click", () => {
	const assignment = currentAssignment();
	if (assignment) {
		els.startingMatch.value = assignment.matchNumber;
		els.stations.dataset.picked = assignment.station;
		drawStations();
	}
	els.panel.hidden = false;
	els.bar.hidden = true;
});

els.team.addEventListener("input", () => { typedTeam = true; });

/* ----- the form ----- */

const noShowChoice = () => els.form.querySelector('input[name="noShow"]:checked')?.value ?? "no";

/* A no-show has nothing to report: only the notes stay. */
function showNoShow() {
	const noShow = noShowChoice() === "yes";
	for (const section of els.sections.querySelectorAll(".scout-section")) {
		section.hidden = noShow && section.dataset.section !== "notes";
	}
}

els.form.addEventListener("change", event => { if (event.target.name === "noShow") showNoShow(); });

function resetForm() {
	render();
	els.flag.checked = false;
	els.form.querySelector('input[name="noShow"][value="no"]').checked = true;
	els.team.value = "";
	typedTeam = false;
}

function render() {
	FtcScout.render(els.sections, game.match.sections, { defaultNo: true });
	showNoShow();
}

function updateQueueNote() {
	const queued = FtcScout.queuedCount("match");
	els.queueNote.hidden = !queued;
	els.queueNote.textContent = queued
		? `${queued} match report${queued === 1 ? " is" : "s are"} saved on this phone, waiting to upload. They send themselves when you're back online.`
		: "";
}

async function syncQueue() {
	const sent = await FtcScout.syncQueue();
	if (sent) FtcScout.toast("success", `${sent} saved report${sent === 1 ? "" : "s"} uploaded`, "They're in the database now.");
	updateQueueNote();
}

els.form.addEventListener("submit", async event => {
	event.preventDefault();
	const event_ = picker.current();
	const scout = els.scout.value.trim();
	const matchNumber = Number(els.matchNumber.value);
	const team = Number(els.team.value);
	const alliance = els.form.querySelector('input[name="alliance"]:checked')?.value ?? null;

	if (!scout) return problem("Enter your name at the top first.", els.scout);
	if (!event_.code) return problem("Pick an event first.", els.event);
	if (!Number.isInteger(matchNumber) || matchNumber < 1) return problem("Enter the match number.", els.matchNumber);
	if (!Number.isInteger(team) || team < 1) return problem("Enter the team number.", els.team);

	FtcScout.store.set(FtcScout.NAME_KEY, scout);

	const payload = {
		season: event_.season, event: event_.code, matchNumber, team, alliance, scout,
		noShow: noShowChoice(), flagged: els.flag.checked,
		answers: FtcScout.collect(els.sections, game.match.sections)
	};

	els.submit.disabled = true;
	els.submit.textContent = "Submitting…";

	try {
		const result = await FtcScout.submit("match", payload);

		if (result.cancelled) {
			FtcScout.toast("warn", "Not submitted", `${result.message} Check the match and team number.`);
		} else {
			FtcScout.toast(result.queued ? "warn" : "success", result.queued ? "Saved on this phone (offline)" : "Submitted!", `Team ${team}, match ${matchNumber} ${result.queued ? "will upload when you're back online." : "is saved."}`);
			advance();
			resetForm();
			applyAssignment();
		}
	} catch (error) {
		FtcScout.toast("error", "NOT submitted", `${error.message} Your answers are still on the screen. Try again.`);
	} finally {
		els.submit.disabled = false;
		els.submit.textContent = "Submit match report";
		updateQueueNote();
	}
});

function problem(message, element) {
	FtcScout.toast("error", "Not submitted", message);
	element?.focus();
}

/* Next match, same station. */
function advance() {
	const assignment = currentAssignment();
	if (!assignment) return;
	FtcScout.store.set(ASSIGNMENT_KEY, JSON.stringify({ ...assignment, matchNumber: Math.min(999, assignment.matchNumber + 1) }));
}

/* ----- start ----- */

(async () => {
	try {
		game = await FtcScout.loadGame();
	} catch (error) {
		els.formStatus.textContent = `Couldn't load the questions: ${error.message}`;
		return;
	}

	els.scout.value = FtcScout.store.get(FtcScout.NAME_KEY);
	picker = await FtcScout.eventPicker({ seasonSelect: els.season, eventSelect: els.event, customInput: els.custom, onChange: loadSchedule });
	refreshSheetNote = FtcScout.trackSheetNote(els.sheetNote, picker);

	render();
	els.form.hidden = false;
	els.formStatus.textContent = "";
	updateQueueNote();
	window.addEventListener("online", syncQueue);
	syncQueue();
	loadSchedule();
})();
