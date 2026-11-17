/* =================================
   FTC SCOUTING FORMS (shared by the match and pit pages)
   The questions come from the server (/api/ftc/game, defined in ftc-game.js), so a new
   season never needs changes here. Needs ftc-common.js first.
================================= */

const FtcScout = (() => {
	const NAME_KEY = "ftc-scout-name";
	const EVENT_KEY = "ftc-scout-event";
	const QUEUE_KEY = "ftc-scout-queue";

	let game = null;

	async function loadGame() {
		game ??= await ftcFetch("/api/ftc/game");
		return game;
	}

	const store = {
		get(key, fallback = "") {
			try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
		},
		set(key, value) {
			try { localStorage.setItem(key, value); } catch { /* private mode: nothing remembered */ }
		}
	};

	/* ----- result message ----- */

	let toastElement = null;
	let toastTimer = 0;

	function toast(kind, title, detail = "") {
		if (!toastElement) {
			toastElement = document.createElement("div");
			toastElement.className = "scout-toast";
			toastElement.hidden = true;
			toastElement.innerHTML = `<span class="toast-icon" aria-hidden="true"></span><div><strong></strong><p></p></div><button type="button" aria-label="Dismiss">OK</button>`;
			toastElement.querySelector("button").addEventListener("click", () => { toastElement.hidden = true; });
			document.body.append(toastElement);
		}

		clearTimeout(toastTimer);
		toastElement.className = `scout-toast ${kind}`;
		toastElement.setAttribute("role", kind === "error" ? "alert" : "status");
		toastElement.querySelector(".toast-icon").textContent = kind === "success" ? "✓" : kind === "warn" ? "!" : "✕";
		toastElement.querySelector("strong").textContent = title;
		toastElement.querySelector("p").textContent = detail;
		toastElement.querySelector("p").hidden = !detail;
		toastElement.hidden = false;
		if (kind === "success") toastTimer = setTimeout(() => { toastElement.hidden = true; }, 5000);
		if (navigator.vibrate) navigator.vibrate(kind === "success" ? 60 : [80, 60, 80]);
	}

	/* ----- building the questions ----- */

	const choiceButton = ({ type, name, value, label, hint, tone = "", checked = false }) => `
      <label class="choice ${tone}${type === "checkbox" ? " checkbox" : ""}">
        <input type="${type}" name="${ftcEscape(name)}" value="${ftcEscape(value)}"${checked ? " checked" : ""}>
        <span>${ftcEscape(label)}${hint ? `<small>${ftcEscape(hint)}</small>` : ""}</span>
      </label>`;

	function fieldHtml(field, { defaultNo }) {
		const id = ftcEscape(field.id);
		const show = field.showIf ? ` data-show-field="${ftcEscape(field.showIf.field)}" data-show-value="${ftcEscape(field.showIf.value)}" hidden` : "";
		const legend = `${ftcEscape(field.label)}${field.hint ? ` <span class="field-hint">${ftcEscape(field.hint)}</span>` : ""}`;

		switch (field.type) {
			case "count": {
				const tone = /Scored$/.test(field.id) ? " scored" : "";
				return `
      <div class="field count-tile${tone}${field.wide ? " wide" : ""}" data-field="${id}" data-max="${field.max ?? 999}"${show}>
        <span class="count-label">${ftcEscape(field.label)}</span>
        <div class="count-controls">
          <button type="button" class="count-button minus" data-delta="-1" aria-label="One less: ${ftcEscape(field.label)}">−</button>
          <input type="number" name="${id}" inputmode="numeric" min="0" max="${field.max ?? 999}" step="1" value="0" aria-label="${ftcEscape(field.label)}">
          <button type="button" class="count-button" data-delta="1" aria-label="One more: ${ftcEscape(field.label)}">+</button>
        </div>
      </div>`;
			}
			case "yesno":
				return `
      <fieldset class="field" data-field="${id}"${show}><legend>${legend}</legend>
        <div class="choice-row">
          ${choiceButton({ type: "radio", name: field.id, value: "yes", label: "Yes", tone: "yes" })}
          ${choiceButton({ type: "radio", name: field.id, value: "no", label: "No", tone: "no", checked: defaultNo })}
        </div>
      </fieldset>`;
			case "choice":
				return `
      <fieldset class="field wide" data-field="${id}"${show}><legend>${legend}</legend>
        <div class="choice-row">${field.options.map(option => choiceButton({ type: "radio", name: field.id, value: option.value, label: option.label, hint: option.hint })).join("")}</div>
      </fieldset>`;
			case "multi":
				return `
      <fieldset class="field wide" data-field="${id}"${show}><legend>${legend}</legend>
        <div class="choice-row">${field.options.map(option => choiceButton({ type: "checkbox", name: field.id, value: option.value, label: option.label, hint: option.hint })).join("")}</div>
      </fieldset>`;
			case "scale":
				return `
      <fieldset class="field wide" data-field="${id}"${show}><legend>${legend}</legend>
        <div class="choice-row scale-row">${[1, 2, 3, 4, 5].map(value => choiceButton({ type: "radio", name: field.id, value, label: value })).join("")}</div>
      </fieldset>`;
			case "number":
				return `
      <div class="field" data-field="${id}"${show}>
        <label>${legend}${field.unit ? ` <span class="field-hint">(${ftcEscape(field.unit)})</span>` : ""}
          <input type="number" name="${id}" inputmode="decimal" min="${field.min ?? 0}" max="${field.max ?? 9999}" step="any">
        </label>
      </div>`;
			case "longtext":
				return `
      <div class="field wide" data-field="${id}"${show}>
        <label>${legend}<textarea name="${id}" rows="4" maxlength="${field.max ?? 500}"></textarea></label>
      </div>`;
			default:
				return `
      <div class="field wide" data-field="${id}"${show}>
        <label>${legend}<input type="text" name="${id}" maxlength="${field.max ?? 200}" autocomplete="off"></label>
      </div>`;
		}
	}

	/* Draws the sections into `container`. Counts sit two to a row (shot | scored). */
	function render(container, sections, { defaultNo = false } = {}) {
		container.innerHTML = sections.map(section => {
			const counts = section.fields.every(field => field.type === "count");
			return `
      <section class="scout-section" data-section="${ftcEscape(section.id)}">
        <h2>${ftcEscape(section.title)}</h2>
        ${section.help ? `<p class="section-help">${ftcEscape(section.help)}</p>` : ""}
        <div class="field-grid${counts ? " counts" : ""}">${section.fields.map(field => fieldHtml(field, { defaultNo })).join("")}</div>
      </section>`;
		}).join("");

		bind(container);
		for (const area of container.querySelectorAll("textarea[maxlength]")) addCounter(area);
	}

	function addCounter(area) {
		const counter = document.createElement("div");
		counter.className = "char-count";
		area.after(counter);
		const update = () => { counter.textContent = `${area.value.length} / ${area.maxLength}`; };
		area.addEventListener("input", update);
		update();
	}

	function bind(container) {
		container.addEventListener("click", event => {
			const button = event.target.closest(".count-button");
			if (!button) return;

			const tile = button.closest(".count-tile");
			const input = tile.querySelector("input");
			const next = (Math.trunc(Number(input.value)) || 0) + Number(button.dataset.delta);
			input.value = Math.min(Number(tile.dataset.max), Math.max(0, next));
			keepShotAtLeastScored(container, tile.dataset.field);
			input.dispatchEvent(new Event("input", { bubbles: true }));
		});

		container.addEventListener("change", () => showConditional(container));
		showConditional(container);
	}

	/* A scored element was also a shot: scoring one raises "shot" to match, and lowering "shot"
	   below "scored" lowers "scored". Pairs are ...Shot and ...Scored. */
	function keepShotAtLeastScored(container, fieldId) {
		const pair = /^(.*)(Shot|Scored)$/.exec(fieldId);
		if (!pair) return;

		const shot = container.querySelector(`[data-field="${pair[1]}Shot"] input`);
		const scored = container.querySelector(`[data-field="${pair[1]}Scored"] input`);
		if (!shot || !scored) return;

		if (pair[2] === "Scored" && Number(scored.value) > Number(shot.value)) shot.value = scored.value;
		if (pair[2] === "Shot" && Number(scored.value) > Number(shot.value)) scored.value = shot.value;
	}

	/* Questions that only appear once another one has a given answer. */
	function showConditional(container) {
		for (const element of container.querySelectorAll("[data-show-field]")) {
			const source = container.querySelector(`input[name="${element.dataset.showField}"]:checked`);
			element.hidden = source?.value !== element.dataset.showValue;
		}
	}

	/* Reads every visible answer back out of the form. */
	function collect(container, sections) {
		const answers = {};

		for (const field of sections.flatMap(section => section.fields)) {
			const element = container.querySelector(`[data-field="${field.id}"]`);
			if (!element || element.hidden || element.closest("[hidden]")) continue;

			if (field.type === "multi") {
				const picked = [...element.querySelectorAll("input:checked")].map(input => input.value);
				if (picked.length) answers[field.id] = picked;
			} else if (["yesno", "choice", "scale"].includes(field.type)) {
				const picked = element.querySelector("input:checked");
				if (picked) answers[field.id] = picked.value;
			} else {
				const value = element.querySelector("input, textarea")?.value.trim();
				if (value !== "" && value !== undefined) answers[field.id] = value;
			}
		}

		return answers;
	}

	/* ----- which event ----- */

	/* Season + event dropdowns plus a box for an event code that isn't listed. */
	async function eventPicker({ seasonSelect, eventSelect, customInput, onChange }) {
		const saved = (() => { try { return JSON.parse(store.get(EVENT_KEY, "{}")); } catch { return {}; } })();
		const wanted = ftcParams().get("season") ?? saved.season ?? game?.season ?? FTC_DEFAULT_SEASON;
		ftcFillSeasons(seasonSelect, FTC_SEASONS.some(season => season.year === wanted) ? wanted : FTC_DEFAULT_SEASON);
		seasonSelect.value = FTC_SEASONS.some(season => season.year === wanted) ? wanted : FTC_DEFAULT_SEASON;

		const fillEvents = async () => {
			await ftcFillEvents(eventSelect, seasonSelect.value);
			const choice = ftcParams().get("event") ?? saved.event;
			if (choice && [...eventSelect.options].some(option => option.value === choice)) eventSelect.value = choice;
		};

		const current = () => {
			const typed = customInput.value.trim().toUpperCase();
			return { season: seasonSelect.value, code: /^[A-Z0-9]{2,20}$/.test(typed) ? typed : eventSelect.value };
		};

		const changed = () => {
			const event = current();
			store.set(EVENT_KEY, JSON.stringify({ season: event.season, event: event.code }));
			if (onChange) onChange(event);
		};

		seasonSelect.addEventListener("change", async () => { await fillEvents(); changed(); });
		eventSelect.addEventListener("change", () => { customInput.value = ""; changed(); });
		customInput.addEventListener("change", changed);

		await fillEvents();
		return { current };
	}

	/* ----- saving, with a queue for when there's no signal ----- */

	const readQueue = () => { try { return JSON.parse(store.get(QUEUE_KEY, "[]")); } catch { return []; } };
	const writeQueue = queue => store.set(QUEUE_KEY, JSON.stringify(queue));
	const newId = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`).slice(0, 36);

	async function post(kind, payload) {
		const response = await fetch(`/api/ftc/scouting/${kind}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload)
		});
		const data = await response.json().catch(() => ({}));
		if (!response.ok) {
			const error = new Error(data.error || "The report wasn't saved.");
			error.status = response.status;
			error.data = data;
			throw error;
		}
		return data;
	}

	/* Saves a report. Resolves { saved: true } or { queued: true } (no signal). A duplicate
	   asks the scout first. Throws for anything else, so the form keeps their answers. */
	async function submit(kind, payload) {
		payload = { ...payload, submissionId: newId() };

		for (let confirmed = false; ;) {
			try {
				if (!navigator.onLine) throw new TypeError("offline");
				await post(kind, { ...payload, confirmDuplicate: confirmed });
				return { saved: true };
			} catch (error) {
				if (error.status === 409 && error.data?.duplicate && !confirmed) {
					if (confirm(`${error.message}\n\nSubmit another report for it anyway?`)) {
						confirmed = true;
						continue;
					}
					return { cancelled: true, message: error.message };
				}

				if (error instanceof TypeError) {
					writeQueue([...readQueue(), { kind, payload }]);
					return { queued: true };
				}
				throw error;
			}
		}
	}

	/* Sends reports saved while offline. Returns how many went. */
	async function syncQueue() {
		let sent = 0;

		for (const item of readQueue()) {
			try {
				await post(item.kind, { ...item.payload, confirmDuplicate: true });
			} catch (error) {
				if (error instanceof TypeError) break;               // still offline: keep the rest
				if (error.status && error.status < 500) {             // the server refused it: don't retry forever
					writeQueue(readQueue().filter(other => other.payload.submissionId !== item.payload.submissionId));
					toast("error", "A saved report was refused", error.message);
					continue;
				}
				break;
			}

			writeQueue(readQueue().filter(other => other.payload.submissionId !== item.payload.submissionId));
			sent += 1;
		}

		return sent;
	}

	const queuedCount = kind => readQueue().filter(item => item.kind === kind).length;

	return { loadGame, render, collect, eventPicker, submit, syncQueue, queuedCount, toast, store, NAME_KEY };
})();
