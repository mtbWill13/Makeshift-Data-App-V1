const eventKey = document.getElementById("eventKey");
const scoutingForm = document.getElementById("scoutingForm");
const formFields = document.getElementById("formFields");
const formStatus = document.getElementById("formStatus");
const queueNote = document.getElementById("queueNote");
const submitButton = document.getElementById("submitButton");
const messedUp = document.getElementById("messedUp");
const startingMatch = document.getElementById("startingMatch");
const assignmentPanel = document.getElementById("assignmentPanel");
const assignmentSummary = document.getElementById("assignmentSummary");
const assignmentText = document.getElementById("assignmentText");
const assignmentStations = document.getElementById("assignmentStations");
const setAssignmentButton = document.getElementById("setAssignmentButton");
const changeAssignment = document.getElementById("changeAssignment");
const assignmentStatus = document.getElementById("assignmentStatus");
const FORM_TYPE = "match-scouting";
const ASSIGNMENT_STORAGE_KEY = "makeshift-match-assignment";
const SCOUT_NAME_STORAGE_KEY = "makeshift-scout-name";

const SUBMIT_LABEL = "Submit Match Scouting";
const DEFAULT_QUAL_MAX = 200;
const MAX_COMMENT_CHARS = 500;
const MAX_TEXT_CHARS = 100;

let eventMatches = [];
let eventTeamNumbers = new Set();   // teams known to be at this event (empty = unknown)
let qualMax = DEFAULT_QUAL_MAX;
let formHeaders = [];

ScoutOffline.registerServiceWorker();
ScoutUI.bindScoreButtons(formFields);

const STATIONS = [
	{ code: "r1", label: "Red 1", tone: "red" },
	{ code: "r2", label: "Red 2", tone: "red" },
	{ code: "r3", label: "Red 3", tone: "red" },
	{ code: "b1", label: "Blue 1", tone: "blue" },
	{ code: "b2", label: "Blue 2", tone: "blue" },
	{ code: "b3", label: "Blue 3", tone: "blue" }
];


/* =================================
   MATCH ASSIGNMENT
   Pick your qualification match and driver station once; the match and team
   fill in for you and move on to the next match after each report.
================================= */

function scheduleCacheKey(event) {
	return `makeshift-match-schedule-${event}`;
}

/* "red1", "RED1", "r1", "blue 3" … all become r1 / b3. */
function stationCode(value) {
	const match = /^(red|r|blue|b)\s*([1-3])$/i.exec(String(value ?? "").trim());
	return match ? `${match[1][0].toLowerCase()}${match[2]}` : "";
}

function savedAssignment() {
	try {
		const saved = JSON.parse(localStorage.getItem(ASSIGNMENT_STORAGE_KEY) || "null");
		return saved ? { ...saved, driverStation: stationCode(saved.driverStation) } : null;
	} catch {
		return null;
	}
}

function saveAssignment(assignment) {
	localStorage.setItem(ASSIGNMENT_STORAGE_KEY, JSON.stringify(assignment));
}

function currentAssignment() {
	const assignment = savedAssignment();
	return assignment && assignment.eventKey === eventKey.value && assignment.driverStation ? assignment : null;
}

/* The team in a given station of a given qualification match, from the schedule. */
function teamAt(matchNumber, code) {
	const match = eventMatches.find(item => item.level === "qm" && Number(item.number) === Number(matchNumber));
	const station = /^([rb])([1-3])$/.exec(code);
	if (!match || !station) return null;

	const teamKey = match[station[1] === "r" ? "red" : "blue"]?.team_keys?.[Number(station[2]) - 1];
	return teamKey ? String(teamKey).replace(/^frc/i, "") : null;
}

function stationOptions(matchNumber) {
	return STATIONS.map(station => ({ value: station.code, label: station.label, tone: station.tone, sub: teamAt(matchNumber, station.code) ?? "" }));
}

/* Show who is playing in each station for a match (when the schedule is known). */
function refreshStationHints(root, matchNumber) {
	for (const small of root.querySelectorAll("small[data-sub]")) {
		small.textContent = teamAt(matchNumber, small.dataset.sub) ?? "";
	}
}

function renderAssignmentStations() {
	const assignment = currentAssignment();
	const checked = assignmentStations.querySelector("input:checked")?.value ?? assignment?.driverStation ?? "";

	assignmentStations.innerHTML = ScoutUI.radioGroup({
		name: "assignStation",
		label: "Your driver station",
		options: stationOptions(Number(startingMatch.value)),
		value: checked,
		perRow: 3
	});
}

/* Collapse the setup box into one line once scouting has started. */
function showAssignmentUI() {
	const assignment = currentAssignment();

	assignmentPanel.hidden = Boolean(assignment);
	assignmentSummary.hidden = !assignment;

	if (assignment) {
		const station = STATIONS.find(item => item.code === assignment.driverStation);
		const team = teamAt(assignment.matchNumber, assignment.driverStation);
		assignmentText.textContent = `Qual ${assignment.matchNumber} · ${station?.label ?? ""}${team ? ` · Team ${team}` : ""}`;
		startingMatch.value = assignment.matchNumber;
	}

	renderAssignmentStations();
}

function setMatchAssignment() {
	const matchNumber = Number(startingMatch.value);
	const station = assignmentStations.querySelector("input:checked")?.value;

	if (!Number.isInteger(matchNumber) || matchNumber < 1 || matchNumber > qualMax) {
		assignmentStatus.textContent = `Enter a starting match from 1 to ${qualMax}.`;
		startingMatch.focus();
		return;
	}

	if (!station) {
		assignmentStatus.textContent = "Tap your driver station (Red 1–3 or Blue 1–3).";
		return;
	}

	saveAssignment({ eventKey: eventKey.value, matchNumber, driverStation: station });
	showAssignmentUI();
	loadForm();
}

function advanceMatchAssignment() {
	const assignment = currentAssignment();
	if (!assignment) return;

	assignment.matchNumber = Math.min(qualMax, assignment.matchNumber + 1);
	saveAssignment(assignment);
	startingMatch.value = assignment.matchNumber;
}

function headerIndex(headers, expression) {
	return headers.findIndex(header => expression.test(header));
}

const fieldByHeader = (headers, expression) => {
	const index = headerIndex(headers, expression);
	return index === -1 ? null : { index, name: `column-${index}` };
};

function applyAssignment(headers) {
	const assignment = currentAssignment();

	if (!assignment) {
		assignmentStatus.textContent = "Set a starting match and driver station to assign teams automatically.";
		return;
	}

	const match = fieldByHeader(headers, /^match number$/i);
	const station = fieldByHeader(headers, /^driver station$/i);

	if (match) formFields.querySelector(`[name="${match.name}"]`).value = assignment.matchNumber;
	if (station) {
		const radio = formFields.querySelector(`[name="${station.name}"][value="${assignment.driverStation}"]`);
		if (radio) {
			radio.checked = true;
			/* Already chosen in the setup box, so don't ask again. It's still filled in
			   and submitted; "Change" in the summary bar picks a different station. */
			radio.closest("fieldset").hidden = true;
		}
	}

	syncStationHints();

	const team = teamAt(assignment.matchNumber, assignment.driverStation);
	assignmentStatus.textContent = team
		? `Assigned to Qual ${assignment.matchNumber}, ${assignment.driverStation.toUpperCase()}: Team ${team}.`
		: `Schedule unavailable for Qual ${assignment.matchNumber}. Enter the team number manually; scouting and offline saving still work.`;
	showAssignmentUI();
}

/* Keep the driver-station buttons showing who's playing, and fill in the team. */
function syncStationHints() {
	const match = fieldByHeader(formHeaders, /^match number$/i);
	const station = fieldByHeader(formHeaders, /^driver station$/i);
	const team = fieldByHeader(formHeaders, /^team number$/i);
	if (!match) return;

	const matchNumber = Number(formFields.querySelector(`[name="${match.name}"]`)?.value);
	if (station) refreshStationHints(formFields, matchNumber);

	const chosen = station ? formFields.querySelector(`[name="${station.name}"]:checked`)?.value : null;
	const teamInput = team ? formFields.querySelector(`[name="${team.name}"]`) : null;
	const scheduled = chosen ? teamAt(matchNumber, chosen) : null;

	/* Never overwrite a team number the scout typed themselves. */
	if (teamInput && scheduled && (!teamInput.value || teamInput.dataset.auto === "1")) {
		teamInput.value = scheduled;
		teamInput.dataset.auto = "1";
	}
}

async function loadMatchSchedule() {
	try {
		const matches = await fetchJson(`/api/events/${eventKey.value}/matches`);
		eventMatches = Array.isArray(matches) ? matches : [];
		localStorage.setItem(scheduleCacheKey(eventKey.value), JSON.stringify(eventMatches));
	} catch (error) {
		try {
			eventMatches = JSON.parse(localStorage.getItem(scheduleCacheKey(eventKey.value)) || "[]");
		} catch {
			eventMatches = [];
		}
	}

	const quals = eventMatches.filter(match => match.level === "qm").map(match => Number(match.number));
	qualMax = quals.length ? Math.max(...quals) : DEFAULT_QUAL_MAX;
	startingMatch.max = qualMax;
}

/* Teams at this event, to catch a mistyped team number. Unknown is fine: no check. */
async function loadEventTeams() {
	const cacheKey = `makeshift-event-teams-${eventKey.value}`;
	let numbers = [];

	try {
		const data = await fetchJson(`/api/events/${eventKey.value}/teams`);
		numbers = Array.isArray(data) ? data : [];
		if (numbers.length) localStorage.setItem(cacheKey, JSON.stringify(numbers));
	} catch {
		numbers = [];
	}

	if (!numbers.length && typeof KNOWN_EVENT_TEAMS !== "undefined" && KNOWN_EVENT_TEAMS[eventKey.value]) {
		numbers = KNOWN_EVENT_TEAMS[eventKey.value].teams.map(([number]) => number);
	}

	if (!numbers.length) {
		try {
			numbers = JSON.parse(localStorage.getItem(cacheKey) || "[]");
		} catch {
			numbers = [];
		}
	}

	eventTeamNumbers = new Set(numbers.map(String));
}


/* =================================
   FORM FIELDS
   Match-scouting columns shown to scouts when the sheet is the older 39-column
   one (a simple sheet shows every column). Add or remove Google Sheets column
   letters here to change that form.
================================= */

const SCOUTING_COLUMNS = "B C D E H K L M N R T".split(" ");

const escapeHtml = ScoutUI.escapeHtml;

function isTimestampField(header) {
	return /timestamp|date.*time|time.*date/i.test(header);
}

function isTeamNumberField(header) {
	return /team number/i.test(header);
}

function isScoutNameField(header) {
	return /scout(?:er)?\s*name/i.test(header);
}

function isYesNoField(header) {
	return /^(can|does|is|would|has)\b/i.test(header) ||
		/\b(no show|preloaded|climb|defended|died|breakdown|tipped|fell|fouls|yellow card|red card|was defended|tip\/falls)\b/i.test(header);
}

function isLongAnswerField(header) {
	return /coolest|describe|explain|notes|comments|anything else|strategy/i.test(header);
}

function isScoringField(header) {
	return /\b(auto|teleop|end ?game|estimated)?\s*scoring points\b/i.test(header);
}

function columnLetterToIndex(columnLetter) {
	const normalized = String(columnLetter).trim().toUpperCase();

	if (!/^[A-Z]+$/.test(normalized)) {
		return null;
	}

	return [...normalized].reduce(
		(index, character) => index * 26 + character.charCodeAt(0) - 64,
		0
	) - 1;
}

function columnIndexToLetter(index) {
	let result = "";
	let current = index + 1;

	while (current > 0) {
		const remainder = (current - 1) % 26;
		result = String.fromCharCode(65 + remainder) + result;
		current = Math.floor((current - 1) / 26);
	}

	return result;
}

function fieldMarkup(field) {
	const { header, index, isBoolean } = field;
	const safeHeader = escapeHtml(header);
	const name = `column-${index}`;
	const id = `field-${columnIndexToLetter(index)}`;
	const isScoutName = isScoutNameField(header);

	/* Which robot you're watching: six colour-coded buttons that also show the team there. */
	if (/^driver station$/i.test(header)) {
		return ScoutUI.radioGroup({ name, label: header, options: stationOptions(0), required: true, perRow: 3, wide: true });
	}

	/* Climb is a level, not a yes/no. The sheet and the stats read "level 1/2/3". */
	if (/^end ?game climb$/i.test(header)) {
		return ScoutUI.radioGroup({
			name,
			label: header,
			value: "no",
			wide: true,
			options: [
				{ value: "no", label: "No climb", big: true },
				{ value: "level 1", label: "Level 1" },
				{ value: "level 2", label: "Level 2" },
				{ value: "level 3", label: "Level 3" }
			]
		});
	}

	/* 1 (incredible) to 5 (poor), or didn't play defense: stored the way the sheet's stats read it. */
	if (/^defen[cs]e rating/i.test(header)) {
		return ScoutUI.radioGroup({
			name,
			label: header,
			value: "x",
			wide: true,
			options: [
				{ value: "x", label: "None", sub: "No defense", big: true },
				{ value: "1", label: "1", sub: "Incredible" },
				{ value: "2", label: "2" },
				{ value: "3", label: "3" },
				{ value: "4", label: "4" },
				{ value: "5", label: "5", sub: "Poor" }
			]
		});
	}

	if (isBoolean || isYesNoField(header)) {
		return ScoutUI.yesNoGroup({ name, label: header });
	}

	if (isScoringField(header)) {
		return ScoutUI.scoreControl({ id, name, label: header });
	}

	if (isLongAnswerField(header)) {
		return `
      <div class="control-group full-width">
        <label for="${id}">${safeHeader}</label>
        <textarea id="${id}" name="${name}" rows="4" maxlength="${MAX_COMMENT_CHARS}"></textarea>
      </div>`;
	}

	if (/^match number$/i.test(header)) {
		return `
      <div class="control-group">
        <label for="${id}">${safeHeader}</label>
        <input id="${id}" name="${name}" type="number" inputmode="numeric" min="1" max="${qualMax}" step="1" required>
      </div>`;
	}

	if (isTeamNumberField(header)) {
		return `
      <div class="control-group">
        <label for="${id}">${safeHeader}</label>
        <input id="${id}" name="${name}" type="number" inputmode="numeric" min="1" max="99999" step="1" required>
      </div>`;
	}

	const readOnly = isTimestampField(header) ? "readonly" : "";
	const value = isTimestampField(header)
		? new Date().toISOString()
		: isScoutName
			? localStorage.getItem(SCOUT_NAME_STORAGE_KEY) || ""
			: "";

	return `
    <div class="control-group">
      <label for="${id}">${safeHeader}</label>
      <input id="${id}" name="${name}" type="text" maxlength="${isScoutName ? 40 : MAX_TEXT_CHARS}" value="${escapeHtml(value)}" ${isScoutName ? "data-scout-name required autocomplete=\"name\"" : ""} ${readOnly}>
    </div>`;
}

function savePersistentScoutFields() {
	const scoutName = formFields.querySelector("[data-scout-name]")?.value.trim();

	if (scoutName) {
		localStorage.setItem(SCOUT_NAME_STORAGE_KEY, scoutName);
	}
}

function restorePersistentScoutFields() {
	const scoutName = localStorage.getItem(SCOUT_NAME_STORAGE_KEY);
	const scoutNameInput = formFields.querySelector("[data-scout-name]");

	if (scoutName && scoutNameInput) {
		scoutNameInput.value = scoutName;
	}
}

async function fetchJson(url, options) {
	const response = await fetch(url, options);
	const data = await response.json().catch(() => ({}));

	if (!response.ok) {
		const error = new Error(data.error || "Could not complete the request.");
		error.status = response.status;
		error.data = data;
		throw error;
	}

	return data;
}


/* =================================
   LOADING THE FORM
================================= */

/* Each load gets a number. If another event is picked while one is still loading,
   the older load must not draw its fields over the newer event's form. */
let formLoadCount = 0;

async function loadForm() {
	const thisLoad = ++formLoadCount;
	scoutingForm.hidden = true;
	formStatus.textContent = "Loading scouting fields…";

	try {
		await Promise.all([loadMatchSchedule(), loadEventTeams()]);
		const { headers, booleanColumnIndexes = [], fields } = await fetchJson(`/api/scouting/${eventKey.value}/schema`);
		if (thisLoad !== formLoadCount) return;
		ScoutOffline.saveSchema(FORM_TYPE, eventKey.value, { headers, booleanColumnIndexes, fields });
		renderForm(headers, booleanColumnIndexes, false, fields);
	} catch (error) {
		if (thisLoad !== formLoadCount) return;
		const cached = ScoutOffline.cachedSchema(FORM_TYPE, eventKey.value);

		if (cached) {
			renderForm(cached.headers, cached.booleanColumnIndexes ?? [], true, cached.fields);
			return;
		}

		formFields.innerHTML = "";
		formStatus.textContent = error.message;
	}
}

/* `fields` is the list of column positions the server says to show (every
   column of a simple sheet). Without it (an older cached copy), fall back to
   the fixed column letters of the original 39-column sheet. */
function renderForm(headers, booleanColumnIndexes, offline, fields) {
	const selectedColumns = fields
		? fields.map(index => ({ index })).filter(column => headers[column.index])
		: SCOUTING_COLUMNS
			.map(columnLetter => ({
				columnLetter: String(columnLetter).trim().toUpperCase(),
				index: columnLetterToIndex(columnLetter)
			}))
			.filter(column => column.index !== null && headers[column.index]);

	const selectedFields = selectedColumns.map(column => ({
		header: headers[column.index],
		index: column.index,
		isBoolean: booleanColumnIndexes.includes(column.index)
	}));

	const unavailableColumns = fields ? [] : SCOUTING_COLUMNS.filter(columnLetter => {
		const index = columnLetterToIndex(columnLetter);
		return index === null || !headers[index];
	});

	if (!selectedFields.length) {
		throw new Error("This sheet's header row has no scouting columns.");
	}

	formHeaders = headers;
	formFields.innerHTML = selectedFields.map(fieldMarkup).join("");
	messedUp.checked = false;
	scoutingForm.hidden = false;
	ScoutUI.addCounters(formFields);
	restorePersistentScoutFields();
	applyAssignment(headers);
	showAssignmentUI();
	formStatus.textContent = offline
		? `Offline mode: ${selectedFields.length} cached fields loaded. New submissions will be saved on this device until connection returns.`
		: unavailableColumns.length
			? `Ready: ${selectedFields.length} fields loaded. ${unavailableColumns.join(", ")} could not be found in this sheet.`
			: `Ready: ${selectedFields.length} fields loaded.`;
}

/* Typing a match number or choosing a station updates who's shown in each station. */
formFields.addEventListener("input", event => {
	const input = event.target;

	if (input.matches("input[type=number]") && /^field-/.test(input.id) && input.name === (fieldByHeader(formHeaders, /^match number$/i)?.name)) {
		syncStationHints();
	}

	/* A team number typed by hand stops being "auto". */
	if (event.isTrusted && input.name === fieldByHeader(formHeaders, /^team number$/i)?.name) {
		delete input.dataset.auto;
	}
});

formFields.addEventListener("change", event => {
	if (event.target.matches("input[type=radio]") && event.target.name === fieldByHeader(formHeaders, /^driver station$/i)?.name) {
		syncStationHints();
	}
});

startingMatch.addEventListener("input", () => {
	refreshStationHints(assignmentStations, Number(startingMatch.value));
});


/* =================================
   SUBMITTING
================================= */

async function submitToServer(submission, { confirmDuplicate = false } = {}) {
	return fetchJson(`/api/scouting/${submission.eventKey}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ answers: submission.answers, confirmDuplicate })
	});
}

async function updateQueueNote() {
	const queued = (await ScoutOffline.queuedSubmissions(FORM_TYPE).catch(() => [])).length;
	queueNote.hidden = !queued;
	queueNote.textContent = queued
		? `${queued} report${queued === 1 ? " is" : "s are"} saved on this device, waiting to upload. They send automatically when you're back online.`
		: "";
}

async function syncOfflineQueue() {
	/* Reports saved offline were already confirmed by the scout; don't ask again. */
	const result = await ScoutOffline.sync(FORM_TYPE, submission => submitToServer(submission, { confirmDuplicate: true }));

	if (result.synced) {
		ScoutUI.toast("success", `${result.synced} saved report${result.synced === 1 ? "" : "s"} uploaded`, "They're in Google Sheets now.");
	}

	updateQueueNote();
	return result;
}

/* The answers from the form: only the sheet's columns, with the "messed up" flag
   added to the comment. */
function collectAnswers() {
	const answers = {};

	for (const [key, value] of new FormData(scoutingForm).entries()) {
		if (key.startsWith("column-")) answers[key] = String(value).trim();
	}

	const comments = fieldByHeader(formHeaders, /^comments?$/i);
	if (messedUp.checked && comments) {
		answers[comments.name] = ScoutUI.applyFlag(answers[comments.name]);
	}

	return answers;
}

function describeReport(answers) {
	const match = fieldByHeader(formHeaders, /^match number$/i);
	const team = fieldByHeader(formHeaders, /^team number$/i);
	return `Qual ${answers[match?.name] ?? "?"}, Team ${answers[team?.name] ?? "?"}`;
}

scoutingForm.addEventListener("submit", async event => {
	event.preventDefault();

	/* Highlights the first missing or out-of-range field. */
	if (!scoutingForm.reportValidity()) {
		ScoutUI.toast("error", "Not submitted", "Fill in the highlighted field first.");
		return;
	}

	savePersistentScoutFields();
	const answers = collectAnswers();

	/* A team that isn't at this event is probably a typo. */
	const team = fieldByHeader(formHeaders, /^team number$/i);
	const teamValue = answers[team?.name];
	if (team && eventTeamNumbers.size && !eventTeamNumbers.has(String(Number(teamValue)))
		&& !confirm(`Team ${teamValue} isn't on this event's team list. Submit it anyway?`)) {
		return;
	}

	const submission = { type: FORM_TYPE, eventKey: eventKey.value, answers };
	const summary = describeReport(answers);

	submitButton.disabled = true;
	submitButton.textContent = "Submitting…";

	let confirmDuplicate = false;

	try {
		for (;;) {
			try {
				if (!navigator.onLine) throw new TypeError("Device is offline");

				await submitToServer(submission, { confirmDuplicate });

				scoutingForm.reset();
				advanceMatchAssignment();
				ScoutUI.toast("success", "Submitted!", `${summary} is saved in Google Sheets.`);
				await loadForm();
				break;
			} catch (error) {
				/* Someone already scouted this robot in this match: ask first. */
				if (error.status === 409 && error.data?.duplicate && !confirmDuplicate) {
					if (confirm(`${error.data.error}\n\nSubmit another report for it anyway?`)) {
						confirmDuplicate = true;
						continue;
					}

					ScoutUI.toast("warn", "Not submitted", `${error.data.error} Check the match and team number, or submit again to add it anyway.`);
					break;
				}

				if (error instanceof TypeError) {
					// remove the "column-"" from the submission for smaller qr code sizes
					for (const key of Object.keys(submission.answers)) {
						submission.answers[key.substring(7)] = submission.answers[key];
						delete submission.answers[key];
					}

					await ScoutOffline.queueSubmission(submission);
					scoutingForm.reset();
					advanceMatchAssignment();
					ScoutUI.toast("warn", "Saved on this device (offline)", `${summary} will upload automatically when you're back online.`);
					await loadForm();
					break;
				}

				ScoutUI.toast("error", "NOT submitted", `${error.message} Your answers are still on the screen. Try again.`);
				break;
			}
		}
	} finally {
		submitButton.disabled = false;
		submitButton.textContent = SUBMIT_LABEL;
		updateQueueNote();
	}
});

eventKey.addEventListener("change", () => {
	showAssignmentUI();
	loadForm();
});
setAssignmentButton.addEventListener("click", setMatchAssignment);
changeAssignment.addEventListener("click", () => {
	assignmentPanel.hidden = false;
	assignmentSummary.hidden = true;
	renderAssignmentStations();
	startingMatch.focus();
});
window.addEventListener("online", syncOfflineQueue);


/* =================================
   START
   Pick today's event first (when the dates are known), then load its form.
================================= */

(async () => {
	await ScoutUI.pickEventByDate(eventKey);

	restorePersistentScoutFields();
	showAssignmentUI();
	updateQueueNote();
	syncOfflineQueue();
	loadForm();
})();
