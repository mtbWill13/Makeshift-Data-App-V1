/* FTC drive practice log: one run per entry (date, who drove, auto / tele / total points, notes). */

const $ = id => document.getElementById(id);
const els = {
	form: $("practiceForm"), date: $("runDate"), driver: $("driver"), operator: $("operator"), auto: $("autoPoints"), tele: $("telePoints"),
	total: $("totalPoints"), totalNote: $("totalNote"), notes: $("notes"), scout: $("scoutName"), season: $("seasonSelect"),
	event: $("eventSelect"), custom: $("customEvent"), sheetNote: $("sheetNote"), submit: $("submitButton"), queueNote: $("queueNote"), latest: $("latest"), driverNames: $("driverNames"), operatorNames: $("operatorNames")
};

const NAMES_KEY = { driver: "ftc-practice-driver-names", operator: "ftc-practice-operator-names" };
const readNames = role => { try { return JSON.parse(localStorage.getItem(NAMES_KEY[role])) ?? []; } catch { return []; } };

const today = () => {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const whole = input => input.value.trim() === "" ? null : Number(input.value);

/* With auto and tele both typed the total is just their sum; otherwise it's typed in. */
function syncTotal() {
	const auto = whole(els.auto);
	const tele = whole(els.tele);
	const both = Number.isFinite(auto) && Number.isFinite(tele);

	els.total.readOnly = both;
	els.total.closest(".clicker")?.classList.toggle("locked", both);
	if (both) els.total.value = auto + tele;
	els.totalNote.textContent = both ? "Auto + tele." : "Fill in auto and tele and this adds up for you, or type just the total.";
}

[els.auto, els.tele].forEach(input => input.addEventListener("input", syncTotal));

const nameLists = { driver: els.driverNames, operator: els.operatorNames };

function showNames() {
	for (const role of ["driver", "operator"]) nameLists[role].innerHTML = readNames(role).filter(Boolean).map(name => `<option value="${ftcEscape(name)}"></option>`).join("");
}

function rememberNames(run) {
	for (const role of ["driver", "operator"]) {
		const name = run[role];
		if (!name) continue;
		const names = [name, ...readNames(role).filter(other => other !== name)].slice(0, 12);
		try { localStorage.setItem(NAMES_KEY[role], JSON.stringify(names)); } catch { /* private mode */ }
	}
	showNames();
}

/* A + / − clicker beside every number box marked data-clicker, so scores can be tapped in. */
function addClickers() {
	for (const input of document.querySelectorAll("input[data-clicker]")) {
		const name = input.closest("label").firstChild.textContent.trim();
		const row = document.createElement("div");
		row.className = "clicker";
		input.replaceWith(row);

		const step = delta => {
			if (input.readOnly) return;
			const next = Math.min(Number(input.max), Math.max(Number(input.min), (whole(input) ?? 0) + delta));
			input.value = next;
			input.dispatchEvent(new Event("input", { bubbles: true }));
		};
		const button = (text, delta, label) => {
			const element = document.createElement("button");
			element.type = "button";
			element.className = "clicker-button";
			element.textContent = text;
			element.setAttribute("aria-label", `${label} ${name}`);
			element.addEventListener("click", () => step(delta));
			return element;
		};
		row.append(button("−", -1, "Subtract 1 from"), input, button("+", 1, "Add 1 to"), button("+20", 20, "Add 20 to"));
	}
}

function updateQueueNote() {
	const queued = FtcScout.queuedCount("practice");
	els.queueNote.hidden = !queued;
	els.queueNote.textContent = queued ? `${queued} practice run${queued === 1 ? " is" : "s are"} saved on this phone, waiting to upload. They send themselves when you're back online.` : "";
}

let picker = null;
let refreshSheetNote = null;

const currentEvent = () => picker?.current() ?? { season: els.season.value, code: "" };

async function showLatest() {
	try {
		const { season, code } = currentEvent();
		const { runs } = await ftcFetch(`/api/ftc/practice/${season}${code ? `?event=${encodeURIComponent(code)}` : ""}`);
		const recent = runs.slice(-6).reverse();
		els.latest.innerHTML = recent.length
			? `<ul class="latest-runs">${recent.map(run => `<li><b>${run.totalPoints}</b> pts <span>${ftcEscape(run.date)} · ${ftcEscape([run.driver, run.operator].filter(Boolean).join(" / "))}${run.autoPoints !== null && run.telePoints !== null ? ` · auto ${run.autoPoints} + tele ${run.telePoints}` : ""}</span></li>`).join("")}</ul>`
			: `<div class="empty-state">No runs logged yet.</div>`;
	} catch {
		els.latest.innerHTML = `<div class="empty-state">Couldn't load the latest runs.</div>`;
	}
}

els.form.addEventListener("submit", async event => {
	event.preventDefault();
	const problem = (message, element) => {
		FtcScout.toast("error", "Not logged", message);
		element?.focus();
	};

	if (!currentEvent().code) return problem("Pick an event first.", els.event);
	if (!els.scout.value.trim()) return problem("Enter your name first.", els.scout);
	if (!els.date.value) return problem("Pick the date.", els.date);
	if (!els.driver.value.trim()) return problem("Enter who drove.", els.driver);
	if (whole(els.auto) === null && whole(els.tele) === null && whole(els.total) === null) return problem("Enter the points: auto and tele, or just the total.", els.total);
	if (![els.auto, els.tele, els.total].every(input => input.checkValidity())) return problem("Points must be whole numbers from 0 to 999.", els.total);

	FtcScout.store.set(FtcScout.NAME_KEY, els.scout.value.trim());
	const payload = {
		season: currentEvent().season, event: currentEvent().code, date: els.date.value, driver: els.driver.value.trim(), operator: els.operator.value.trim(), scout: els.scout.value.trim(),
		autoPoints: whole(els.auto), telePoints: whole(els.tele), totalPoints: whole(els.total), notes: els.notes.value.trim()
	};

	els.submit.disabled = true;
	els.submit.textContent = "Logging…";

	try {
		const result = await FtcScout.submit("practice", payload);
		if (result.sheet === "failed") FtcScout.toast("warn", "Saved, but not on the Google Sheet", `The Practice tab couldn't be updated (${result.sheetError}). Use "Send logs to the sheet" on the practice tracker to retry; nothing is lost.`);
		FtcScout.toast(result.queued ? "warn" : "success", result.queued ? "Saved on this phone (offline)" : "Run logged!", `${[payload.driver, payload.operator].filter(Boolean).join(" / ")} · ${els.total.value} points${result.queued ? " will upload when you're back online." : "."}`);
		rememberNames(payload);
		for (const input of [els.auto, els.tele, els.total, els.notes]) input.value = "";
		syncTotal();
		showLatest();
	} catch (error) {
		FtcScout.toast("error", "NOT logged", `${error.message} Your answers are still on the screen. Try again.`);
	} finally {
		els.submit.disabled = false;
		els.submit.textContent = "Log this run";
		updateQueueNote();
	}
});


window.addEventListener("online", async () => {
	const sent = await FtcScout.syncQueue();
	if (sent) FtcScout.toast("success", `${sent} saved run${sent === 1 ? "" : "s"} uploaded`, "They're in the practice tracker now.");
	updateQueueNote();
	showLatest();
});

(async () => {
	els.date.value = today();
	els.scout.value = FtcScout.store.get(FtcScout.NAME_KEY);
	showNames();
	addClickers();
	syncTotal();
	updateQueueNote();
	FtcScout.syncQueue().then(updateQueueNote);
	picker = await FtcScout.eventPicker({ seasonSelect: els.season, eventSelect: els.event, customInput: els.custom, onChange: event => { refreshSheetNote(event); showLatest(); } });
	refreshSheetNote = FtcScout.trackSheetNote(els.sheetNote, picker);
	refreshSheetNote(currentEvent());
	showLatest();
})();
