const eventKey = document.getElementById("eventKey");
const pitScoutingForm = document.getElementById("pitScoutingForm");
const formFields = document.getElementById("formFields");
const formStatus = document.getElementById("formStatus");
const queueNote = document.getElementById("queueNote");
const submitButton = document.getElementById("submitButton");
const messedUp = document.getElementById("messedUp");
const SCOUT_NAME_STORAGE_KEY = "makeshift-scout-name";
const FORM_TYPE = "pit-scouting";

const SUBMIT_LABEL = "Submit Pit Scouting";
const MAX_COMMENT_CHARS = 500;
const MAX_TEXT_CHARS = 100;

let eventTeamNumbers = new Set();   // teams known to be at this event (empty = unknown)

ScoutOffline.registerServiceWorker();

const PIT_SCOUTING_COLUMNS = "B C D F G H J K L M Z AD AE AF AH".split(" ");

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

/* Fallback for a cached form that doesn't say which questions are yes/no. */
function isYesNoField(header) {
	return /^(can|does|do|is|are|would|has|have|did|will)\b/i.test(header) ||
		/^(shooter|shuttle|climber|defen[cs]e)$/i.test(header);
}

function isLongAnswerField(header) {
	return /coolest|describe|explain|notes|comments|anything else/i.test(header);
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

/* A header turned into something safe to use as an id. */
const idFor = header => `field-${header.replace(/[^a-z0-9]+/gi, "-").slice(0, 60)}`;

function fieldMarkup({ header, isBoolean }) {
	const safeHeader = escapeHtml(header);
	const name = header;
	const id = idFor(header);
	const isScoutName = isScoutNameField(header);

	/* "If strategy requires it, would you play defense?": yes / maybe / no. */
	if (/would you be open to playing defen[cs]e/i.test(header)) {
		return ScoutUI.radioGroup({
			name,
			label: header,
			wide: true,
			options: [{ value: "Yes", label: "Yes" }, { value: "Maybe", label: "Maybe" }, { value: "No", label: "No" }]
		});
	}

	if (isBoolean || isYesNoField(header)) {
		/* Left unanswered unless picked: "no answer" is different from "no". */
		return ScoutUI.radioGroup({
			name,
			label: header,
			options: [{ value: "TRUE", label: "Yes" }, { value: "FALSE", label: "No" }]
		});
	}

	if (isLongAnswerField(header)) {
		return `
      <div class="control-group full-width">
        <label for="${id}">${safeHeader}</label>
        <textarea id="${id}" name="${escapeHtml(name)}" rows="4" maxlength="${MAX_COMMENT_CHARS}"></textarea>
      </div>`;
	}

	if (isTeamNumberField(header)) {
		return `
      <div class="control-group">
        <label for="${id}">${safeHeader}</label>
        <input id="${id}" name="${escapeHtml(name)}" type="number" inputmode="numeric" min="1" max="99999" step="1" required>
      </div>`;
	}

	const readOnly = isTimestampField(header) ? "readonly" : "";
	const value = isTimestampField(header)
		? new Date().toISOString()
		: isScoutName
			? localStorage[SCOUT_NAME_STORAGE_KEY] || ""
			: "";

	return `
    <div class="control-group">
      <label for="${id}">${safeHeader}</label>
      <input id="${id}" name="${escapeHtml(name)}" type="text" maxlength="${isScoutName ? 40 : MAX_TEXT_CHARS}" value="${escapeHtml(value)}" ${isScoutName ? "required autocomplete=\"name\"" : ""} ${readOnly}>
    </div>`;
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

async function submitToServer(submission) {
	return fetchJson(`/api/pitscouting/${submission.eventKey}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ answers: submission.answers })
	});
}

async function updateQueueNote() {
	const queued = (await ScoutOffline.queuedSubmissions(FORM_TYPE).catch(() => [])).length;
	queueNote.hidden = !queued;
	queueNote.textContent = queued
		? `${queued} pit report${queued === 1 ? " is" : "s are"} saved on this device, waiting to upload. They send automatically when you're back online.`
		: "";
}

async function syncOfflineQueue() {
	const result = await ScoutOffline.sync(FORM_TYPE, submitToServer);

	if (result.synced) {
		ScoutUI.toast("success", `${result.synced} saved pit report${result.synced === 1 ? "" : "s"} uploaded`, "They're in Google Sheets now.");
	}

	updateQueueNote();
	return result;
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

/* Each load gets a number. If another event is picked while one is still loading,
   the older load must not draw its fields over the newer event's form. */
let formLoadCount = 0;

async function loadForm() {
	const thisLoad = ++formLoadCount;
	pitScoutingForm.hidden = true;
	formStatus.textContent = "Loading pit-scouting fields…";

	try {
		loadEventTeams();
		const { headers, fields, booleanColumnIndexes = [] } = await fetchJson(`/api/pitscouting/${eventKey.value}/schema`);
		if (thisLoad !== formLoadCount) return;
		ScoutOffline.saveSchema(FORM_TYPE, eventKey.value, { headers, fields, booleanColumnIndexes });
		renderForm(headers, false, fields, booleanColumnIndexes);
	} catch (error) {
		if (thisLoad !== formLoadCount) return;
		const cached = ScoutOffline.cachedSchema(FORM_TYPE, eventKey.value);

		if (cached) {
			renderForm(cached.headers, true, cached.fields, cached.booleanColumnIndexes ?? []);
			return;
		}

		formFields.innerHTML = "";
		formStatus.textContent = error.message;
	}
}

/* `fields` is the list of column positions the server says to show (every
   column of a simple sheet). Without it (an older cached copy), fall back to
   the fixed column letters of the original sheet. */
function renderForm(headers, offline, fields, booleanColumnIndexes = []) {
	const selectedColumns = fields
		? fields.map(index => ({ index })).filter(column => headers[column.index])
		: PIT_SCOUTING_COLUMNS
			.map(columnLetter => ({
				columnLetter: String(columnLetter).trim().toUpperCase(),
				index: columnLetterToIndex(columnLetter)
			}))
			.filter(column => column.index !== null && headers[column.index]);

	const selectedFields = selectedColumns.map(column => ({
		header: headers[column.index],
		isBoolean: booleanColumnIndexes.includes(column.index)
	}));

	const unavailableColumns = fields ? [] : PIT_SCOUTING_COLUMNS.filter(columnLetter => {
		const index = columnLetterToIndex(columnLetter);
		return index === null || !headers[index];
	});

	if (!selectedFields.length) {
		throw new Error("This sheet's header row has no pit-scouting columns.");
	}

	formFields.innerHTML = selectedFields.map(fieldMarkup).join("");
	messedUp.checked = false;
	pitScoutingForm.hidden = false;
	ScoutUI.addCounters(formFields);
	formStatus.textContent = offline
		? `Offline mode: ${selectedFields.length} cached fields loaded. New submissions will be saved on this device until connection returns.`
		: unavailableColumns.length
			? `Ready: ${selectedFields.length} configured fields loaded. ${unavailableColumns.join(", ")} could not be found in this sheet.`
			: `Ready: ${selectedFields.length} configured fields loaded.`;
}

/* Saves the report on screen on this device (if there is one), then opens the transfer
   page, which makes the QR codes by itself. */
document.getElementById("transferButton").addEventListener("click", async () => {
	const answers = {};
	for (const [key, value] of new FormData(pitScoutingForm).entries()) {
		answers[key] = String(value).trim();
	}

	const teamKey = Object.keys(answers).find(isTeamNumberField);

	if (teamKey && answers[teamKey]) {
		if (!pitScoutingForm.reportValidity()) {
			ScoutUI.toast("error", "Not saved", "Fill in the highlighted field first.");
			return;
		}

		const commentKey = Object.keys(answers).find(key => /^comments?$/i.test(key));
		if (messedUp.checked && commentKey) {
			answers[commentKey] = ScoutUI.applyFlag(answers[commentKey]);
		}

		await ScoutOffline.queueSubmission({ type: FORM_TYPE, eventKey: eventKey.value, answers });
		pitScoutingForm.reset();
	}

	location.href = `/transfer/?type=${FORM_TYPE}&event=${encodeURIComponent(eventKey.value)}`;
});

pitScoutingForm.addEventListener("submit", async event => {
	event.preventDefault();

	/* Highlights the first missing or out-of-range field. */
	if (!pitScoutingForm.reportValidity()) {
		ScoutUI.toast("error", "Not submitted", "Fill in the highlighted field first.");
		return;
	}

	const answers = {};
	for (const [key, value] of new FormData(pitScoutingForm).entries()) {
		answers[key] = String(value).trim();
	}

	const scouter = Object.keys(answers).find(isScoutNameField);
	if (scouter && answers[scouter]) {
		localStorage[SCOUT_NAME_STORAGE_KEY] = answers[scouter];
	}

	/* The "messed up" flag goes at the start of the comment. */
	const commentKey = Object.keys(answers).find(key => /^comments?$/i.test(key));
	if (messedUp.checked && commentKey) {
		answers[commentKey] = ScoutUI.applyFlag(answers[commentKey]);
	}

	/* A team that isn't at this event is probably a typo. */
	const teamKey = Object.keys(answers).find(isTeamNumberField);
	const team = answers[teamKey];
	if (teamKey && eventTeamNumbers.size && !eventTeamNumbers.has(String(Number(team)))
		&& !confirm(`Team ${team} isn't on this event's team list. Submit it anyway?`)) {
		return;
	}

	const submission = {
		type: FORM_TYPE,
		eventKey: eventKey.value,
		answers
	};

	submitButton.disabled = true;
	submitButton.textContent = "Submitting…";

	try {
		if (!navigator.onLine) {
			throw new TypeError("Device is offline");
		}

		await submitToServer(submission);

		pitScoutingForm.reset();
		ScoutUI.toast("success", "Submitted!", `Pit report for team ${team} is saved in Google Sheets.`);
		await loadForm();
	} catch (error) {
		if (error instanceof TypeError) {
			await ScoutOffline.queueSubmission(submission);
			pitScoutingForm.reset();
			ScoutUI.toast("warn", "Saved on this device (offline)", `The pit report for team ${team} will upload automatically when you're back online.`);
			await loadForm();
		} else {
			ScoutUI.toast("error", "NOT submitted", `${error.message} Your answers are still on the screen. Try again.`);
		}
	} finally {
		submitButton.disabled = false;
		submitButton.textContent = SUBMIT_LABEL;
		updateQueueNote();
	}
});

eventKey.addEventListener("change", loadForm);
window.addEventListener("online", syncOfflineQueue);

/* Pick today's event first (when the dates are known), then load its form. */
(async () => {
	await ScoutUI.pickEventByDate(eventKey);

	updateQueueNote();
	syncOfflineQueue();
	loadForm();
})();
