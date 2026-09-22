const eventKey = document.getElementById("eventKey");
const scoutingForm = document.getElementById("scoutingForm");
const formFields = document.getElementById("formFields");
const formStatus = document.getElementById("formStatus");
const submissionToken = document.getElementById("submissionToken");
const submitButton = document.getElementById("submitButton");
const startingMatch = document.getElementById("startingMatch");
const driverStation = document.getElementById("driverStation");
const setAssignmentButton = document.getElementById("setAssignmentButton");
const assignmentStatus = document.getElementById("assignmentStatus");
const FORM_TYPE = "match-scouting";
const ASSIGNMENT_STORAGE_KEY = "makeshift-match-assignment";
const SCOUT_NAME_STORAGE_KEY = "makeshift-scout-name";
const PASSCODE_STORAGE_KEY = "makeshift-scouting-passcode";
let eventMatches = [];

ScoutOffline.registerServiceWorker();

function scheduleCacheKey(event) {
	return `makeshift-match-schedule-${event}`;
}

function savedAssignment() {
	try {
		return JSON.parse(localStorage.getItem(ASSIGNMENT_STORAGE_KEY) || "null");
	} catch {
		return null;
	}
}

function saveAssignment(assignment) {
	localStorage.setItem(ASSIGNMENT_STORAGE_KEY, JSON.stringify(assignment));
}

function stationDetails(station) {
	const match = /^([a-z]+)([1-3])$/i.exec(station || "");

	return match
		? { alliance: match[1].toLowerCase(), index: Number(match[2]) - 1 }
		: null;
}

function currentScheduledMatch() {
	const assignment = savedAssignment();

	if (!assignment || assignment.eventKey !== eventKey.value) {
		return null;
	}

	return eventMatches.find(match =>
		match.level === "qm" && Number(match.number) === Number(assignment.matchNumber)
	) ?? null;
}

function teamForAssignment() {
	const assignment = savedAssignment();
	const match = currentScheduledMatch();
	const station = stationDetails(assignment?.driverStation);

	if (!match || !station) {
		return null;
	}

	const teamKey = match[station.alliance]?.team_keys?.[station.index];
	return teamKey ? String(teamKey).replace(/^frc/i, "") : null;
}

function headerIndex(headers, expression) {
	return headers.findIndex(header => expression.test(header));
}

function applyAssignment(headers) {
	const assignment = savedAssignment();
	const match = currentScheduledMatch();
	const teamNumber = teamForAssignment();

	if (!assignment || assignment.eventKey !== eventKey.value) {
		assignmentStatus.textContent = "Set a starting match and driver station to assign teams automatically.";
		return;
	}

	const matchInput = document.querySelector(`[name="column-${headerIndex(headers, /^match number$/i)}"]`);
	const teamInput = document.querySelector(`[name="column-${headerIndex(headers, /^team number$/i)}"]`);
	const stationInput = document.querySelector(`[name="column-${headerIndex(headers, /^driver station$/i)}"]`);

	if (matchInput) matchInput.value = assignment.matchNumber;
	if (teamInput) teamInput.value = teamNumber ?? "";
	if (stationInput) stationInput.value = assignment.driverStation.toUpperCase();

	assignmentStatus.textContent = match && teamNumber
		? `Assigned to Qual ${assignment.matchNumber}, ${assignment.driverStation.toUpperCase()}: Team ${teamNumber}.`
		: `Qual ${assignment.matchNumber} is not in the cached schedule yet.`;
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
}

function setMatchAssignment() {
	const matchNumber = Number(startingMatch.value);

	if (!Number.isInteger(matchNumber) || matchNumber < 1 || !driverStation.value) {
		assignmentStatus.textContent = "Enter a starting match and select a driver station.";
		return;
	}

	saveAssignment({
		eventKey: eventKey.value,
		matchNumber,
		driverStation: driverStation.value
	});

	loadForm();
}

function advanceMatchAssignment() {
	const assignment = savedAssignment();

	if (!assignment || assignment.eventKey !== eventKey.value) {
		return;
	}

	assignment.matchNumber += 1;
	saveAssignment(assignment);
	startingMatch.value = assignment.matchNumber;
}

/*
  Match-scouting columns shown to scouts.
  Add or remove Google Sheets column letters here to change the form.
*/
const SCOUTING_COLUMNS = "B C D E H K L M N R T".split(" ");

function escapeHtml(value) {
	return String(value ?? "").replace(/[&<>"']/g, character => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#39;"
	})[character]);
}

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
	const fieldName = `column-${index}`;
	const fieldId = `field-${columnIndexToLetter(index)}`;
	const required = isTeamNumberField(header) ? "required" : "";
	const isScoutName = isScoutNameField(header);

	if (isBoolean || isYesNoField(header)) {
		return `
      <div class="control-group">
        <label for="${fieldId}">${safeHeader}</label>
        <select id="${fieldId}" name="${fieldName}" ${required}>
          <option value="">Select an answer</option>
          <option value="TRUE">Yes</option>
          <option value="FALSE">No</option>
        </select>
      </div>`;
	}

	if (isScoringField(header)) {
		return `
      <div class="control-group score-field">
        <label for="${fieldId}">${safeHeader}</label>
        <div class="score-clicker">
          <input id="${fieldId}" name="${fieldName}" type="number" value="0" min="0" step="5">
          <button class="score-button" type="button" data-score-field="${fieldId}">+5</button>
        </div>
      </div>`;
	}

	if (isLongAnswerField(header)) {
		return `
      <div class="control-group full-width">
        <label for="${fieldId}">${safeHeader}</label>
        <textarea id="${fieldId}" name="${fieldName}" rows="4" ${required}></textarea>
      </div>`;
	}

	const type = isTeamNumberField(header) ? "number" : "text";
	const readOnly = isTimestampField(header) ? "readonly" : "";
	let value = isTimestampField(header)
		? new Date().toISOString()
		: isScoutName
			? localStorage.getItem(SCOUT_NAME_STORAGE_KEY) || ""
			: "";

	return `
    <div class="control-group">
      <label for="${fieldId}">${safeHeader}</label>
      <input id="${fieldId}" name="${fieldName}" type="${type}" value="${escapeHtml(value)}" ${isScoutName ? "data-scout-name" : ""} ${readOnly} ${required}>
    </div>`;
}

function savePersistentScoutFields() {
	const scoutName = formFields.querySelector("[data-scout-name]")?.value.trim();

	if (scoutName) {
		localStorage.setItem(SCOUT_NAME_STORAGE_KEY, scoutName);
	}

	if (submissionToken.value) {
		sessionStorage.setItem(PASSCODE_STORAGE_KEY, submissionToken.value);
	}
}

function restorePersistentScoutFields() {
	const scoutName = localStorage.getItem(SCOUT_NAME_STORAGE_KEY);
	const scoutNameInput = formFields.querySelector("[data-scout-name]");

	if (scoutName && scoutNameInput) {
		scoutNameInput.value = scoutName;
	}

	submissionToken.value = sessionStorage.getItem(PASSCODE_STORAGE_KEY) || "";
}

async function fetchJson(url, options) {
	const response = await fetch(url, options);
	const data = await response.json().catch(() => ({}));

	if (!response.ok) {
		throw new Error(data.error || "Could not complete the request.");
	}

	return data;
}

async function submitToServer(submission) {
	return fetchJson(`/api/scouting/${submission.eventKey}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			submissionToken: submission.submissionToken,
			answers: submission.answers
		})
	});
}

async function syncOfflineQueue() {
	const result = await ScoutOffline.sync(FORM_TYPE, submitToServer);

	if (result.synced) {
		formStatus.textContent = `${result.synced} offline scouting response${result.synced === 1 ? "" : "s"} synced to Google Sheets.`;
	}

	return result;
}

async function loadForm() {
	scoutingForm.hidden = true;
	formStatus.textContent = "Loading scouting fields…";

	try {
		await loadMatchSchedule();
		const { headers, booleanColumnIndexes = [] } = await fetchJson(`/api/scouting/${eventKey.value}/schema`);
		ScoutOffline.saveSchema(FORM_TYPE, eventKey.value, { headers, booleanColumnIndexes });
		renderForm(headers, booleanColumnIndexes, false);
	} catch (error) {
		const cached = ScoutOffline.cachedSchema(FORM_TYPE, eventKey.value);

		if (cached) {
			renderForm(cached.headers, cached.booleanColumnIndexes ?? [], true);
			return;
		}

		formFields.innerHTML = "";
		formStatus.textContent = error.message;
	}
}

function renderForm(headers, booleanColumnIndexes, offline) {
	const selectedColumns = SCOUTING_COLUMNS
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

	const unavailableColumns = SCOUTING_COLUMNS.filter(columnLetter => {
		const index = columnLetterToIndex(columnLetter);
		return index === null || !headers[index];
	});

	if (!selectedFields.length) {
		throw new Error("None of the column letters in SCOUTING_COLUMNS match this sheet's header row.");
	}

	formFields.innerHTML = selectedFields.map(fieldMarkup).join("");
	scoutingForm.hidden = false;
	restorePersistentScoutFields();
	applyAssignment(headers);
	formStatus.textContent = offline
		? `Offline mode: ${selectedFields.length} cached fields loaded. New submissions will be saved on this device until connection returns.`
		: unavailableColumns.length
			? `Ready: ${selectedFields.length} fields loaded. ${unavailableColumns.join(", ")} could not be found in this sheet.`
			: `Ready: ${selectedFields.length} fields loaded.`;
}

scoutingForm.addEventListener("submit", async event => {
	event.preventDefault();

	savePersistentScoutFields();
	const answers = Object.fromEntries(new FormData(scoutingForm).entries());
	submitButton.disabled = true;
	formStatus.textContent = "Submitting scouting response…";

	const submission = {
		type: FORM_TYPE,
		eventKey: eventKey.value,
		submissionToken: submissionToken.value,
		answers
	};

	try {
		if (!navigator.onLine) {
			throw new TypeError("Device is offline");
		}

		await submitToServer(submission);

		scoutingForm.reset();
		advanceMatchAssignment();
		formStatus.textContent = "Scouting response submitted successfully.";
		await loadForm();
	} catch (error) {
		if (error instanceof TypeError) {
			await ScoutOffline.queueSubmission(submission);
			scoutingForm.reset();
			advanceMatchAssignment();
			await loadForm();
			formStatus.textContent = "Offline scouting response saved on this device and will sync automatically when online.";
		} else {
			formStatus.textContent = error.message;
		}
	} finally {
		submitButton.disabled = false;
	}
});

formFields.addEventListener("click", event => {
	const button = event.target.closest("[data-score-field]");

	if (!button) {
		return;
	}

	const scoreInput = document.getElementById(button.dataset.scoreField);
	const currentScore = Number(scoreInput?.value) || 0;

	if (scoreInput) {
		scoreInput.value = currentScore + 5;
	}
});

eventKey.addEventListener("change", loadForm);
setAssignmentButton.addEventListener("click", setMatchAssignment);
submissionToken.addEventListener("input", () => {
	if (submissionToken.value) {
		sessionStorage.setItem(PASSCODE_STORAGE_KEY, submissionToken.value);
	} else {
		sessionStorage.removeItem(PASSCODE_STORAGE_KEY);
	}
});
window.addEventListener("online", syncOfflineQueue);

const assignment = savedAssignment();
if (assignment?.eventKey === eventKey.value) {
	startingMatch.value = assignment.matchNumber;
	driverStation.value = assignment.driverStation;
}

restorePersistentScoutFields();
syncOfflineQueue();
loadForm();
