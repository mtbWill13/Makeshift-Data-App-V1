const eventKey = document.getElementById("eventKey");
const pitScoutingForm = document.getElementById("pitScoutingForm");
const formFields = document.getElementById("formFields");
const formStatus = document.getElementById("formStatus");
const submissionToken = document.getElementById("submissionToken");
const submitButton = document.getElementById("submitButton");

/*
  Pit-scouting columns shown to scouts.
  Add or remove names here to change the form. Each name must exactly match
  a column heading in the "Pit Scouting Raw Data" sheet.
*/
const PIT_SCOUTING_FIELDS = [
  "Team Number of Team Being Scouted",
  "What type of drive base does your robot have?",
  "Preferred Starting Location",
  "Can your robot drive under the trench?",
  "Can your robot drive over the bump?",
  "If strategy required; would you be open to playing defense?",
  "What language is your robot programmed in?",
  "What is the coolest thing about your robot or robot cart?"
];

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
    const selectedHeaders = headers.filter(header =>
      PIT_SCOUTING_FIELDS.includes(header)
    );

    const unavailableFields = PIT_SCOUTING_FIELDS.filter(header =>
      !headers.includes(header)
    );

    if (!selectedHeaders.length) {
      throw new Error("None of the column names in PIT_SCOUTING_FIELDS match this sheet's header row.");
    }

    formFields.innerHTML = selectedHeaders.map(fieldMarkup).join("");
    pitScoutingForm.hidden = false;
    formStatus.textContent = unavailableFields.length
      ? `Ready — ${selectedHeaders.length} configured fields loaded. ${unavailableFields.length} configured field name(s) were not found in this sheet.`
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
