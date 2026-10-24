/* Pieces shared by the match and pit scouting forms. */

const ScoutUI = (() => {
	const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#39;"
	})[character]);

	/* ----- the big "submitted / saved offline / not submitted" message ----- */

	let toastElement = null;
	let toastTimer = 0;

	function ensureToast() {
		if (toastElement) return toastElement;

		toastElement = document.createElement("div");
		toastElement.className = "scout-toast";
		toastElement.hidden = true;
		toastElement.innerHTML = `
			<span class="toast-icon" aria-hidden="true"></span>
			<div><strong></strong><p></p></div>
			<button type="button" aria-label="Dismiss">OK</button>`;
		toastElement.querySelector("button").addEventListener("click", hideToast);
		document.body.append(toastElement);
		return toastElement;
	}

	function hideToast() {
		clearTimeout(toastTimer);
		if (toastElement) toastElement.hidden = true;
	}

	/* kind: "success" (fades after a few seconds), "warn" or "error" (stay until dismissed). */
	function toast(kind, title, detail = "") {
		const element = ensureToast();
		clearTimeout(toastTimer);

		element.className = `scout-toast ${kind}`;
		element.setAttribute("role", kind === "error" ? "alert" : "status");
		element.querySelector(".toast-icon").textContent = kind === "success" ? "✓" : kind === "warn" ? "!" : "✕";
		element.querySelector("strong").textContent = title;
		element.querySelector("p").textContent = detail;
		element.querySelector("p").hidden = !detail;
		element.hidden = false;

		if (kind === "success") toastTimer = setTimeout(hideToast, 6000);
		if (navigator.vibrate) navigator.vibrate(kind === "success" ? 60 : [80, 60, 80]);
	}

	/* ----- radio buttons ----- */

	/* options: [{ value, label, sub?, tone? }]. `sub` is a small line under the label.
	   perRow > 0 lays the buttons out in rows of that many (the six driver stations). */
	function radioGroup({ name, label, options, value = "", required = false, wide = false, perRow = 0 }) {
		const buttons = options.map(option => `
			<label class="radio-option${option.tone ? ` tone-${option.tone}` : ""}">
				<input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(option.value)}"${String(option.value) === String(value) ? " checked" : ""}${required ? " required" : ""}>
				<span>${escapeHtml(option.label)}<small data-sub="${escapeHtml(option.value)}">${escapeHtml(option.sub ?? "")}</small></span>
			</label>`);

		let content = `<div class="radio-row">${buttons.join("")}</div>`;

		if (perRow > 0) {
			const rows = [];
			for (let start = 0; start < buttons.length; start += perRow) {
				rows.push(`<div class="radio-row grid-3">${buttons.slice(start, start + perRow).join("")}</div>`);
			}
			content = `<div class="station-rows">${rows.join("")}</div>`;
		}

		return `
			<fieldset class="control-group${wide ? " full-width" : ""}">
				<legend>${escapeHtml(label)}</legend>
				${content}
			</fieldset>`;
	}

	function yesNoGroup({ name, label, value = "FALSE", wide = false }) {
		return radioGroup({
			name,
			label,
			wide,
			value,
			options: [{ value: "TRUE", label: "Yes" }, { value: "FALSE", label: "No" }]
		});
	}

	/* ----- score control: -5 -1 [number] +1 +5 ----- */

	function scoreControl({ id, name, label, max = 999 }) {
		const button = (delta, text, extra = "") => `<button class="score-button${delta < 0 ? " minus" : ""}" type="button" data-score-field="${id}" data-delta="${delta}" aria-label="${text} points"${extra}>${text}</button>`;

		return `
			<div class="control-group score-field">
				<label for="${id}">${escapeHtml(label)}</label>
				<div class="score-clicker">
					${button(-5, "−5")}${button(-1, "−1")}
					<input id="${id}" name="${escapeHtml(name)}" type="number" inputmode="numeric" value="0" min="0" max="${max}" step="1">
					${button(1, "+1")}${button(5, "+5")}
				</div>
			</div>`;
	}

	/* Wire the score buttons inside `root` (call once; it listens for clicks). */
	function bindScoreButtons(root) {
		root.addEventListener("click", event => {
			const button = event.target.closest("[data-score-field]");
			if (!button) return;

			const input = document.getElementById(button.dataset.scoreField);
			if (!input) return;

			const max = Number(input.max) || 999;
			const next = (Math.trunc(Number(input.value)) || 0) + Number(button.dataset.delta);
			input.value = Math.min(max, Math.max(0, next));
			input.dispatchEvent(new Event("input", { bubbles: true }));
		});
	}

	/* ----- text length counters ----- */

	function addCounters(root) {
		for (const field of root.querySelectorAll("textarea[maxlength]")) {
			if (field.nextElementSibling?.classList.contains("char-count")) continue;

			const counter = document.createElement("div");
			counter.className = "char-count";
			field.after(counter);

			const update = () => {
				const max = Number(field.maxLength);
				counter.textContent = `${field.value.length} / ${max}`;
				counter.classList.toggle("near-limit", field.value.length >= max * 0.9);
			};

			field.addEventListener("input", update);
			update();
		}
	}

	/* ----- "I think I messed this up" ----- */

	const FLAG_TEXT = "[CHECK THIS REPORT] ";

	function flagRow() {
		return `<label class="flag-row"><input type="checkbox" id="messedUp"><span>I think I messed this up, please double check.</span></label>`;
	}

	/* Marks a report for review by starting its comment with a tag. */
	function applyFlag(comment) {
		return `${FLAG_TEXT}${comment ?? ""}`.trimEnd();
	}

	/* ----- start on the event that's happening today ----- */

	const todayLocal = () => {
		const now = new Date();
		return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
	};

	async function pickEventByDate(select) {
		const keys = [...select.options].map(option => option.value).filter(value => /^\d{4}[a-z0-9]{2,20}$/.test(value) && !/test/i.test(value));
		if (!keys.length) return null;

		let dates = [];
		try {
			const response = await Promise.race([
				fetch(`/api/event-dates?keys=${keys.join(",")}`),
				new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), 2500))
			]);
			dates = await response.json();
			localStorage.setItem("makeshift-event-dates", JSON.stringify(dates));
		} catch {
			try {
				dates = JSON.parse(localStorage.getItem("makeshift-event-dates") || "[]");
			} catch {
				dates = [];
			}
		}

		const today = todayLocal();
		const happening = dates.find(event => event.start && event.end && event.start <= today && today <= event.end);

		if (happening && [...select.options].some(option => option.value === happening.key)) {
			select.value = happening.key;
			return happening.key;
		}

		return null;
	}

	return { addCounters, applyFlag, bindScoreButtons, escapeHtml, flagRow, pickEventByDate, radioGroup, scoreControl, toast, hideToast, yesNoGroup };
})();
