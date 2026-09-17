const eventKey = document.getElementById("eventKey");
const pitScoutingForm = document.getElementById("pitScoutingForm");
const formFields = document.getElementById("formFields");
const formStatus = document.getElementById("formStatus");
const submissionToken = document.getElementById("submissionToken");
const submitButton = document.getElementById("submitButton");

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
    formFields.innerHTML = headers.map(fieldMarkup).join("");
    pitScoutingForm.hidden = false;
    formStatus.textContent = `Ready — ${headers.length} fields loaded from this event’s pit-scouting sheet.`;
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
