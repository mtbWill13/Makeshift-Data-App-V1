const eventKey = document.getElementById("eventKey");
const pitScoutingForm = document.getElementById("pitScoutingForm");
const formFields = document.getElementById("formFields");
const formStatus = document.getElementById("formStatus");
const submissionToken = document.getElementById("submissionToken");
const submitButton = document.getElementById("submitButton");

/*
  Pit-scouting columns shown to scouts.
  Add or remove Google Sheets column letters here to change the form.
  For example, ["A", "C", "F"] shows only columns A, C, and F.
*/
const PIT_SCOUTING_COLUMNS = ["A", "B", "C", "D", "E", "F", "G", "H"];

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
  const value = isTimestampField(header) ? new Date().toISOString() : "";
  const readOnly = isTimestampField(header) ? "readonly" : "";

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

async function loadForm() {
  pitScoutingForm.hidden = true;
  formStatus.textContent = "Loading pit-scouting fields…";

  try {
    const { headers } = await fetchJson(`/api/pitscouting/${eventKey.value}/schema`);
    const selectedColumns = PIT_SCOUTING_COLUMNS
      .map(columnLetter => ({
        columnLetter: String(columnLetter).trim().toUpperCase(),
        index: columnLetterToIndex(columnLetter)
      }))
      .filter(column => column.index !== null && headers[column.index]);

    const selectedHeaders = selectedColumns.map(column => headers[column.index]);

    const unavailableColumns = PIT_SCOUTING_COLUMNS.filter(columnLetter => {
      const index = columnLetterToIndex(columnLetter);
      return index === null || !headers[index];
    });

    if (!selectedHeaders.length) {
      throw new Error("None of the column letters in PIT_SCOUTING_COLUMNS match this sheet's header row.");
    }

    formFields.innerHTML = selectedHeaders.map(fieldMarkup).join("");
    pitScoutingForm.hidden = false;
    formStatus.textContent = unavailableColumns.length
      ? `Ready — ${selectedHeaders.length} configured fields loaded. ${unavailableColumns.join(", ")} could not be found in this sheet.`
      : `Ready — ${selectedHeaders.length} configured fields loaded.`;
  } catch (error) {
    formFields.innerHTML = "";
    formStatus.textContent = error.message;
  }
}

pitScoutingForm.addEventListener("submit", async event => {
  event.preventDefault();

  const answers = Object.fromEntries(new FormData(pitScoutingForm).entries());
  submitButton.disabled = true;
  formStatus.textContent = "Submitting pit-scouting response…";

  try {
    await fetchJson(`/api/pitscouting/${eventKey.value}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        submissionToken: submissionToken.value,
        answers
      })
    });

    pitScoutingForm.reset();
    formStatus.textContent = "Pit-scouting response submitted successfully.";
    await loadForm();
  } catch (error) {
    formStatus.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

eventKey.addEventListener("change", loadForm);
loadForm();
