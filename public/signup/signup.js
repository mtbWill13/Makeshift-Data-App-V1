const form = document.getElementById("signupForm");
const numberInput = document.getElementById("number");
const numberNote = document.getElementById("numberNote");
const nameInput = document.getElementById("name");
const eventSelect = document.getElementById("event");
const customRow = document.getElementById("customEventRow");
const customEvent = document.getElementById("customEvent");
const sheetInput = document.getElementById("sheet");
const sheetNote = document.getElementById("sheetNote");
const checkButton = document.getElementById("checkSheet");
const message = document.getElementById("message");
const submit = document.getElementById("submit");

const colors = { primary: "#eb4e3f", accent: "#59a8d7" };
let colorProblemText = "";
let lookupTimer = 0;
let lookupId = 0;
let numberTaken = false;

mountColorPicker(document.getElementById("colorPicker"), colors, problem => {
	colorProblemText = problem;
});

function setNote(element, text, kind = "") {
	element.textContent = text;
	element.className = `field-note${kind ? ` ${kind}` : ""}`;
}

async function postJson(url, body) {
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body)
	});
	const data = await response.json().catch(() => ({}));
	return { ok: response.ok, data };
}


/* =================================
   TEAM LOOKUP (name + events from The Blue Alliance)
================================= */

function showEvents(events) {
	const options = events.map(event => new Option(`${event.name} (${event.key})`, event.key));
	options.push(new Option(events.length ? "Another event…" : "Enter an event key…", "__other"));
	eventSelect.replaceChildren(...options);
	updateCustomEvent();
}

function updateCustomEvent() {
	customRow.hidden = eventSelect.value !== "__other";
}

async function lookupTeam() {
	const number = numberInput.value.trim();
	const thisLookup = ++lookupId;

	if (!/^\d{1,5}$/.test(number)) {
		setNote(numberNote, "");
		return;
	}

	setNote(numberNote, "Checking…");

	try {
		const response = await fetch(`/api/signup/info?team=${encodeURIComponent(number)}`);
		const info = await response.json().catch(() => ({}));
		if (thisLookup !== lookupId) return;

		if (!response.ok) return setNote(numberNote, info.error || "Couldn't check that number.", "bad");

		numberTaken = Boolean(info.taken);

		if (info.taken) {
			setNote(numberNote, `Team ${number} already has an account. Log in instead.`, "bad");
		} else if (info.notFound) {
			setNote(numberNote, `FRC team ${number} wasn't found on The Blue Alliance.`, "bad");
		} else if (info.nickname) {
			setNote(numberNote, `Found: ${info.nickname}`, "good");
			if (!nameInput.value.trim()) nameInput.value = info.nickname;
		} else {
			setNote(numberNote, "");
		}

		if (info.events) showEvents(info.events);
	} catch {
		if (thisLookup === lookupId) setNote(numberNote, "Couldn't check that number right now.", "bad");
	}
}

numberInput.addEventListener("input", () => {
	clearTimeout(lookupTimer);
	lookupTimer = setTimeout(lookupTeam, 500);
});
numberInput.addEventListener("blur", () => {
	clearTimeout(lookupTimer);
	lookupTeam();
});
eventSelect.addEventListener("change", updateCustomEvent);


/* =================================
   SHEET INSTRUCTIONS + CHECK
================================= */

(async function loadFacts() {
	try {
		const info = await (await fetch("/api/signup/info")).json();

		document.getElementById("serviceEmail").textContent = info.serviceAccountEmail || "(not available, ask the site owner)";

		if (info.templateUrl) {
			const link = document.createElement("a");
			link.href = info.templateUrl;
			link.target = "_blank";
			link.rel = "noopener noreferrer";
			link.textContent = "Open the template ↗";
			document.getElementById("templateLink").replaceChildren(link);
		}
	} catch {
		/* The form still works; the facts just stay blank. */
	}
})();

document.getElementById("copyEmail").addEventListener("click", async event => {
	const button = event.currentTarget;
	try {
		await navigator.clipboard.writeText(document.getElementById("serviceEmail").textContent);
		button.textContent = "Copied";
	} catch {
		button.textContent = "Select and copy it";
	}
	setTimeout(() => { button.textContent = "Copy"; }, 2000);
});

checkButton.addEventListener("click", async () => {
	if (!sheetInput.value.trim()) return setNote(sheetNote, "Paste your sheet's link first.", "bad");

	checkButton.disabled = true;
	setNote(sheetNote, "Checking your sheet…");

	try {
		const { ok, data } = await postJson("/api/signup/check-sheet", { sheet: sheetInput.value });
		setNote(sheetNote, ok ? "Your sheet looks good." : data.error || "Couldn't check that sheet.", ok ? "good" : "bad");
	} catch {
		setNote(sheetNote, "Couldn't reach the server.", "bad");
	}

	checkButton.disabled = false;
});
sheetInput.addEventListener("input", () => setNote(sheetNote, ""));


/* =================================
   CREATE THE ACCOUNT
================================= */

function showError(text, field) {
	message.className = "form-message bad";
	message.textContent = text;
	field?.focus();
}

form.addEventListener("submit", async event => {
	event.preventDefault();
	message.textContent = "";

	const eventKey = eventSelect.value === "__other" ? customEvent.value.trim() : eventSelect.value;
	const password = document.getElementById("password").value;

	if (!numberInput.value.trim()) return showError("Enter your FRC team number.", numberInput);
	if (numberTaken) return showError(`Team ${numberInput.value.trim()} already has an account. Log in instead.`, numberInput);
	if (nameInput.value.trim().length < 2) return showError("Enter your team name.", nameInput);
	if (colorProblemText) return showError(colorProblemText);
	/* The sheet is optional; if there is one, it needs an event. */
	if (sheetInput.value.trim() && !eventKey) return showError("Pick the event your sheet is for.", eventSelect);
	if (password.length < 8) return showError("The team password needs at least 8 characters.", document.getElementById("password"));
	if (password !== document.getElementById("confirm").value) return showError("The two passwords don't match.", document.getElementById("confirm"));

	submit.disabled = true;
	submit.textContent = "Creating your account…";

	try {
		const { ok, data } = await postJson("/api/signup", {
			number: numberInput.value.trim(),
			name: nameInput.value.trim(),
			colors,
			event: eventKey,
			sheet: sheetInput.value,
			password,
			scoutPasscode: document.getElementById("scoutPasscode").value
		});

		if (!ok) throw new Error(data.error || "Couldn't create the account. Try again.");

		try {
			localStorage.setItem("makeshift-last-team", data.team.number);
			localStorage.setItem("makeshift-team", JSON.stringify(data.team));
		} catch {
			/* Private mode: pages ask the server instead. */
		}
		window.location.replace("/");
	} catch (error) {
		showError(error.message);
		submit.disabled = false;
		submit.textContent = "Create team account";
	}
});
