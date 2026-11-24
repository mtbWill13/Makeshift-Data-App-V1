/* Colour schemes for team accounts, shared by the signup and settings pages.
   The rule below matches the server's (teams.js), which is what decides. */

const TEAM_PRESETS = [
	{ name: "MakeShift", primary: "#eb4e3f", accent: "#59a8d7" },
	{ name: "Ocean", primary: "#3fa7e8", accent: "#7ed3c4" },
	{ name: "Forest", primary: "#5cc36a", accent: "#e8d44d" },
	{ name: "Sunset", primary: "#f08a3c", accent: "#f2c14e" },
	{ name: "Violet", primary: "#a78bfa", accent: "#f472b6" },
	{ name: "Crimson", primary: "#e5484d", accent: "#f5c542" },
	{ name: "Teal", primary: "#2dd4bf", accent: "#60a5fa" },
	{ name: "Silver", primary: "#e5e7eb", accent: "#9ca3af" }
];

function colorLuminance(hex) {
	const channels = [1, 3, 5].map(index => {
		const value = parseInt(hex.slice(index, index + 2), 16) / 255;
		return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function colorContrast(a, b) {
	const [high, low] = [colorLuminance(a), colorLuminance(b)].sort((x, y) => y - x);
	return (high + 0.05) / (low + 0.05);
}

/* Returns a message if the pair can't be used, or "" if it's fine. */
function colorProblem(primary, accent) {
	if (colorContrast(primary, "#0a0b0d") < 4.5) return "The main colour is too dark for buttons. Pick a brighter one.";
	if (colorContrast(accent, "#0f1115") < 4.5) return "The accent colour is too dark to read on the dark background. Pick a brighter one.";
	return "";
}

/* Shows a colour scheme on this page right now (before it is saved). */
function previewColors(primary, accent) {
	document.documentElement.style.setProperty("--brand", primary);
	document.documentElement.style.setProperty("--brand-2", accent);
}

/* Draws the preset swatches + two colour pickers into `container` and keeps
   `state` ({ primary, accent }) up to date. Calls onChange after every change. */
function mountColorPicker(container, state, onChange = () => {}) {
	container.innerHTML = `
		<div class="preset-row" role="group" aria-label="Colour presets">
			${TEAM_PRESETS.map((preset, index) => `
				<button type="button" class="preset" data-preset="${index}" title="${preset.name}" aria-label="${preset.name} colours">
					<i style="background:${preset.primary}"></i><i style="background:${preset.accent}"></i>
				</button>`).join("")}
		</div>
		<div class="color-inputs">
			<label class="color-field"><span>Main colour <small>buttons</small></span><input type="color" data-color="primary"></label>
			<label class="color-field"><span>Accent colour <small>links &amp; highlights</small></span><input type="color" data-color="accent"></label>
		</div>
		<p class="color-message" role="alert"></p>`;

	const message = container.querySelector(".color-message");

	function refresh() {
		for (const input of container.querySelectorAll("[data-color]")) input.value = state[input.dataset.color];
		container.querySelectorAll("[data-preset]").forEach(button => {
			const preset = TEAM_PRESETS[button.dataset.preset];
			button.setAttribute("aria-pressed", String(preset.primary === state.primary && preset.accent === state.accent));
		});

		const problem = colorProblem(state.primary, state.accent);
		message.textContent = problem;
		if (!problem) previewColors(state.primary, state.accent);
		onChange(problem);
	}

	container.addEventListener("click", event => {
		const button = event.target.closest("[data-preset]");
		if (!button) return;
		const preset = TEAM_PRESETS[button.dataset.preset];
		state.primary = preset.primary;
		state.accent = preset.accent;
		refresh();
	});

	container.addEventListener("input", event => {
		const input = event.target.closest("[data-color]");
		if (!input) return;
		state[input.dataset.color] = input.value.toLowerCase();
		refresh();
	});

	refresh();
}
