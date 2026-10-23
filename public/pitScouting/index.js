const eventKey = document.getElementById("eventKey");
const pitScoutingForm = document.getElementById("pitScoutingForm");
const formFields = document.getElementById("formFields");
const formStatus = document.getElementById("formStatus");
const submitButton = document.getElementById("submitButton");
const SCOUT_NAME_STORAGE_KEY = "makeshift-scout-name";
const FORM_TYPE = "pit-scouting";

ScoutOffline.registerServiceWorker();

const PIT_SCOUTING_COLUMNS = "B C D F G H J K L M Z AD AE AF AH".split(" ");

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

function isYesNoField(header) {
	return /^(can|does|is|would|has)\b/i.test(header);
}

function isLongAnswerField(header) {
	return /coolest|describe|explain|notes|comments|anything else|strategy/i.test(header);
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

function fieldMarkup(header) {
	const safeHeader = escapeHtml(header);
	const required = isTeamNumberField(header) ? "required" : "";

	if (isYesNoField(header)) {
		return `
      <div class="control-group">
        <label for="field-${safeHeader}">${safeHeader}</label>
        <select id="field-${safeHeader}" name="${safeHeader}" ${required}>
          <option value="">Select an answer</option>
          <option value="TRUE">Yes</option>
          <option value="FALSE">No</option>
        </select>
      </div>`;
	}

	if (isLongAnswerField(header)) {
		return `
      <div class="control-group full-width">
        <label for="field-${safeHeader}">${safeHeader}</label>
        <textarea id="field-${safeHeader}" name="${safeHeader}" rows="4" ${required}></textarea>
      </div>`;
	}

	const type = isTeamNumberField(header) ? "number" : "text";
	const readOnly = isTimestampField(header) ? "readonly" : "";
	let value = isTimestampField(header) ? new Date().toISOString() : "";

	if (safeHeader == "Pit Scouter Name") {
		if (localStorage[SCOUT_NAME_STORAGE_KEY]) {
			value = localStorage[SCOUT_NAME_STORAGE_KEY];
		}
	}

	console.log(safeHeader);

	return `
    <div class="control-group">
      <label for="field-${safeHeader}">${safeHeader}</label>
      <input id="field-${safeHeader}" name="${safeHeader}" type="${type}" value="${value}" ${readOnly} ${required}>
    </div>`;
}

async function fetchJson(url, options) {
	const response = await fetch(url, options);
	const data = await response.json().catch(() => ({}));

	if (!response.ok) {
		throw new Error(data.error || "Could not complete the request.");
	}

	return data;
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
	return fetchJson(`/api/pitscouting/${submission.eventKey}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ answers: submission.answers })
	});
}

async function syncOfflineQueue() {
	const result = await ScoutOffline.sync(FORM_TYPE, submitToServer);

	if (result.synced) {
		formStatus.textContent = `${result.synced} offline pit-scouting response${result.synced === 1 ? "" : "s"} synced to Google Sheets.`;
	}

	return result;
}

/* Each load gets a number. If another event is picked while one is still loading,
   the older load must not draw its fields over the newer event's form. */
let formLoadCount = 0;

async function loadForm() {
	const thisLoad = ++formLoadCount;
	pitScoutingForm.hidden = true;
	formStatus.textContent = "Loading pit-scouting fields…";

	try {
		const { headers, fields } = await fetchJson(`/api/pitscouting/${eventKey.value}/schema`);
		if (thisLoad !== formLoadCount) return;
		ScoutOffline.saveSchema(FORM_TYPE, eventKey.value, { headers, fields });
		renderForm(headers, false, fields);
	} catch (error) {
		if (thisLoad !== formLoadCount) return;
		const cached = ScoutOffline.cachedSchema(FORM_TYPE, eventKey.value);

		if (cached) {
			renderForm(cached.headers, true, cached.fields);
			return;
		}

		formFields.innerHTML = "";
		formStatus.textContent = error.message;
	}
}

/* `fields` is the list of column positions the server says to show (every
   column of a simple sheet). Without it (an older cached copy), fall back to
   the fixed column letters of the original sheet. */
function renderForm(headers, offline, fields) {
	const selectedColumns = fields
		? fields.map(index => ({ index })).filter(column => headers[column.index])
		: PIT_SCOUTING_COLUMNS
			.map(columnLetter => ({
				columnLetter: String(columnLetter).trim().toUpperCase(),
				index: columnLetterToIndex(columnLetter)
			}))
			.filter(column => column.index !== null && headers[column.index]);

	const selectedHeaders = selectedColumns.map(column => headers[column.index]);

	const unavailableColumns = fields ? [] : PIT_SCOUTING_COLUMNS.filter(columnLetter => {
		const index = columnLetterToIndex(columnLetter);
		return index === null || !headers[index];
	});

	if (!selectedHeaders.length) {
		throw new Error("This sheet's header row has no pit-scouting columns.");
	}

	formFields.innerHTML = selectedHeaders.map(fieldMarkup).join("");
	pitScoutingForm.hidden = false;
	formStatus.textContent = offline
		? `Offline mode: ${selectedHeaders.length} cached fields loaded. New submissions will be saved on this device until connection returns.`
		: unavailableColumns.length
			? `Ready: ${selectedHeaders.length} configured fields loaded. ${unavailableColumns.join(", ")} could not be found in this sheet.`
			: `Ready: ${selectedHeaders.length} configured fields loaded.`;
}

pitScoutingForm.addEventListener("submit", async event => {
	event.preventDefault();

	const answers = Object.fromEntries(new FormData(pitScoutingForm).entries());
	submitButton.disabled = true;
	formStatus.textContent = "Submitting pit-scouting response…";

	if (answers["Pit Scouter Name"]) {
		localStorage[SCOUT_NAME_STORAGE_KEY] = answers["Pit Scouter Name"];
	}

	console.log(event);

	console.log(answers);

	const submission = {
		type: FORM_TYPE,
		eventKey: eventKey.value,
		answers
	};

	try {
		if (!navigator.onLine) {
			throw new TypeError("Device is offline");
		}

		await submitToServer(submission);

		pitScoutingForm.reset();
		formStatus.textContent = "Pit-scouting response submitted successfully.";
		await loadForm();
	} catch (error) {
		if (error instanceof TypeError) {
			await ScoutOffline.queueSubmission(submission);
			pitScoutingForm.reset();
			formStatus.textContent = "Offline pit-scouting response saved on this device and will sync automatically when online.";
		} else {
			formStatus.textContent = error.message;
		}
	} finally {
		submitButton.disabled = false;
	}
});

eventKey.addEventListener("change", loadForm);
window.addEventListener("online", syncOfflineQueue);
syncOfflineQueue();
loadForm();
