const eventKey = document.getElementById("eventKey");
const scoutingForm = document.getElementById("scoutingForm");
const formFields = document.getElementById("formFields");
const formStatus = document.getElementById("formStatus");
const submissionToken = document.getElementById("submissionToken");
const submitButton = document.getElementById("submitButton");

/*
  Match-scouting columns shown to scouts.
  Add or remove Google Sheets column letters here to change the form.
*/
const SCOUTING_COLUMNS = "B C D G H K L M N R T".split(" ");

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
	let value = isTimestampField(header) ? new Date().toISOString() : "";

	return `
    <div class="control-group">
      <label for="${fieldId}">${safeHeader}</label>
      <input id="${fieldId}" name="${fieldName}" type="${type}" value="${value}" ${readOnly} ${required}>
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

async function loadForm() {
	scoutingForm.hidden = true;
	formStatus.textContent = "Loading scouting fields…";

	try {
		const { headers, booleanColumnIndexes = [] } = await fetchJson(`/api/scouting/${eventKey.value}/schema`);
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
		formStatus.textContent = unavailableColumns.length
			? `Ready — ${selectedFields.length} configured fields loaded. ${unavailableColumns.join(", ")} could not be found in this sheet.`
			: `Ready — ${selectedFields.length} configured fields loaded.`;
	} catch (error) {
		formFields.innerHTML = "";
		formStatus.textContent = error.message;
	}
}

scoutingForm.addEventListener("submit", async event => {
	event.preventDefault();

	const answers = Object.fromEntries(new FormData(scoutingForm).entries());
	submitButton.disabled = true;
	formStatus.textContent = "Submitting scouting response…";

	try {
		await fetchJson(`/api/scouting/${eventKey.value}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				submissionToken: submissionToken.value,
				answers
			})
		});

		scoutingForm.reset();
		submissionToken.value = "";
		formStatus.textContent = "Scouting response submitted successfully.";
		await loadForm();
	} catch (error) {
		formStatus.textContent = error.message;
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
loadForm();
