// Field definitions
//
// A sheet can have a "Match Field Definitions" tab and a "Pit Field Definitions" tab that
// say, for each column of the match or pit tab, what kind of answer it takes: a counter, yes/no buttons, a dropdown of
// options, a rating, a number between two limits, and so on. The forms are drawn from it,
// the server refuses answers that break it, and a "Role" lets the stats pages find the
// right column in a game they weren't written for.
//
// No tab (or no row for a column) is fine: that column behaves as it always did.
//
// Columns of each tab (the first row is the heading row; order doesn't matter):
//   Header    the column heading, exactly as on the match (or pit) tab
//   Type      number, decimal, counter, yesno, choice, multi, scale, text, longtext
//   Min, Max  limits for number/decimal/counter/scale (and the length for text)
//   Options   for choice and multi, separated by ";"  (write value=Label to store a value
//             that differs from what scouts see)
//   Required  yes/no
//   Role      what the column means to the stats pages (see ROLES)
//   Help      a short line shown under the question
// Rows starting with # in the Header column are notes and are ignored.
// (An older single "Field Definitions" tab, with a Form column saying match or pit, still works
// for any form that doesn't have its own tab.)

export const DEFINITION_TABS = { match: "Match Field Definitions", pit: "Pit Field Definitions" };
export const DEFINITION_TAB = "Field Definitions";   // the older tab holding both forms

export const TYPES = ["number", "decimal", "counter", "yesno", "choice", "multi", "scale", "text", "longtext"];

/* A role makes a column look like the column the stats pages already use. The stats pages
   ask for these heading names, so a new game only has to say which of its columns is which. */
export const ROLES = {
	auto_points: "Auto Scoring Points",
	teleop_points: "Teleop Scoring Points",
	endgame_points: "Endgame Scoring Points",
	climb_points: "Climb points",
	auto_climb_points: "Auto Climb",
	defense_rating: "Defense Rating from 1 (incredible) to 5 (poor)",
	driver_skill: "Driver Skill (1 best, 6 worst)",
	breakdown: "Robot died/had breakdown in functionality",
	tipped: "Robot tipped/fell over",
	fouls: "Robot received fouls or a yellow/red card",
	defended: "Robot was defended",
	no_show: "No Show",
	comments: "Comments"
};

const normal = value => String(value ?? "").trim();
const key = value => normal(value).toLowerCase();

function parseOptions(text) {
	return normal(text).split(/[;\n]/).map(part => part.trim()).filter(Boolean).map(part => {
		const split = part.indexOf("=");
		return split > 0 ? { value: part.slice(0, split).trim(), label: part.slice(split + 1).trim() || part.slice(0, split).trim() } : { value: part, label: part };
	});
}

const optionalNumber = value => {
	const text = normal(value);
	if (text === "") return null;
	const number = Number(text);
	return Number.isFinite(number) ? number : NaN;
};

/* Reads a tab's rows. A tab for one form has no Form column: pass that form as `onlyForm`.
   Returns { match: Map, pit: Map, problems: [] } where each Map goes from lower-cased heading
   to a definition. Rows that don't make sense are left out and reported. */
export function parseDefinitions(values, onlyForm = null, tabName = DEFINITION_TAB) {
	const result = { match: new Map(), pit: new Map(), problems: [] };
	const [headings, ...rows] = values ?? [];
	if (!headings) return result;

	const column = name => headings.findIndex(heading => key(heading) === name);
	const at = Object.fromEntries(["form", "header", "type", "min", "max", "options", "required", "role", "help"].map(name => [name, column(name)]));

	if ((!onlyForm && at.form < 0) || at.header < 0 || at.type < 0) {
		result.problems.push(`The "${tabName}" tab needs ${onlyForm ? "" : "Form, "}Header and Type columns in its first row.`);
		return result;
	}

	rows.forEach((row, index) => {
		const cell = name => at[name] < 0 ? "" : normal(row[at[name]]);
		const line = index + 2;
		if (!row.some(value => normal(value)) || cell("form").startsWith("#") || cell("header").startsWith("#")) return;

		const form = onlyForm ?? key(cell("form"));
		const header = cell("header");
		const type = key(cell("type"));
		const problem = message => result.problems.push(`${tabName} row ${line} (${header || "no header"}): ${message}`);

		if (form !== "match" && form !== "pit") return problem(`Form must be "match" or "pit", not "${cell("form")}".`);
		if (!header) return problem("Header is empty.");
		if (!TYPES.includes(type)) return problem(`Type "${cell("type")}" isn't one of ${TYPES.join(", ")}.`);

		const min = optionalNumber(cell("min"));
		const max = optionalNumber(cell("max"));
		if (Number.isNaN(min) || Number.isNaN(max)) return problem("Min and Max must be numbers.");
		if (min !== null && max !== null && min > max) return problem("Min is bigger than Max.");

		const options = parseOptions(cell("options"));
		if ((type === "choice" || type === "multi") && options.length < 2) return problem(`${type} needs at least two Options separated by ";".`);

		const role = key(cell("role")).replace(/[\s-]+/g, "_");
		if (role && !ROLES[role]) return problem(`Role "${cell("role")}" isn't one of ${Object.keys(ROLES).join(", ")}.`);

		result[form].set(key(header), {
			header, type, min, max, options,
			required: /^(yes|true|y|1)$/i.test(cell("required")),
			role: role || null,
			help: cell("help") || null
		});
	});

	return result;
}

/* The limits that apply when the sheet doesn't give any. */
export function limitsFor(definition) {
	switch (definition.type) {
		case "counter": return { min: definition.min ?? 0, max: definition.max ?? 999 };
		case "scale": return { min: definition.min ?? 1, max: definition.max ?? 5 };
		case "number":
		case "decimal": return { min: definition.min ?? 0, max: definition.max ?? 100000 };
		case "text": return { min: 0, max: definition.max ?? 100 };
		case "longtext": return { min: 0, max: definition.max ?? 500 };
		default: return { min: null, max: null };
	}
}

/* Checks one answer against its definition. Returns { value } (cleaned, ready for the sheet) or
   { error } in plain English. Empty answers are fine unless the question is required. */
export function checkAnswer(definition, raw) {
	const label = definition.header;
	const text = Array.isArray(raw) ? raw.map(normal).filter(Boolean).join("; ") : normal(raw);

	if (text === "") return definition.required ? { error: `${label} is required.` } : { value: "" };

	const { min, max } = limitsFor(definition);

	switch (definition.type) {
		case "number":
		case "decimal":
		case "counter":
		case "scale": {
			const number = Number(text);
			const whole = definition.type !== "decimal";
			if (!Number.isFinite(number) || (whole && !Number.isInteger(number))) return { error: `${label} must be a ${whole ? "whole " : ""}number.` };
			if (number < min || number > max) return { error: `${label} must be from ${min} to ${max}.` };
			return { value: String(number) };
		}
		case "yesno": {
			if (/^(true|yes|y)$/i.test(text)) return { value: "TRUE" };
			if (/^(false|no|n)$/i.test(text)) return { value: "FALSE" };
			return { error: `${label} must be Yes or No.` };
		}
		case "choice": {
			const option = definition.options.find(item => item.value.toLowerCase() === text.toLowerCase());
			return option ? { value: option.value } : { error: `${label} must be one of: ${definition.options.map(item => item.label).join(", ")}.` };
		}
		case "multi": {
			const picked = text.split(";").map(part => part.trim()).filter(Boolean);
			const chosen = picked.map(item => definition.options.find(option => option.value.toLowerCase() === item.toLowerCase()));
			if (chosen.some(option => !option)) return { error: `${label} has an answer that isn't on the list.` };
			return { value: [...new Set(chosen.map(option => option.value))].join("; ") };
		}
		default:
			return text.length > max ? { error: `${label} is too long (${text.length} of ${max} characters).` } : { value: text };
	}
}

/* Checks a whole report. `headers` are the tab's column headings, `answerFor(index)` reads an answer, and
   `defs` is the Map for this form. Returns { errors: [], values: Map(index -> cleaned) }. */
export function checkReport(headers, answerFor, defs) {
	const errors = [];
	const values = new Map();

	headers.forEach((header, index) => {
		const definition = defs.get(key(header));
		if (!definition) return;

		const result = checkAnswer(definition, answerFor(index));
		if (result.error) errors.push(result.error);
		else values.set(index, result.value);
	});

	return { errors, values };
}

/* For the stats pages: gives each row the headings they expect, copied from whichever column the
   sheet marked with that role. A column that already has the expected heading is left alone. */
export function applyRoles(rows, headers, defs) {
	const have = new Set(headers.map(key));
	const copies = [];

	for (const definition of defs.values()) {
		const wanted = definition.role && ROLES[definition.role];
		if (wanted && !have.has(key(wanted)) && key(wanted) !== key(definition.header)) copies.push([wanted, definition.header]);
	}

	if (!copies.length) return rows;
	return rows.map(row => {
		const copy = { ...row };
		for (const [wanted, from] of copies) copy[wanted] = row[from] ?? "";
		return copy;
	});
}

/* What the forms get for each column: its definition, or null to keep the old behaviour. */
export function definitionsForHeaders(headers, defs) {
	return headers.map(header => {
		const definition = defs.get(key(header));
		return definition ? { ...definition, ...limitsFor(definition) } : null;
	});
}

/* Puts the two forms' definitions together: each form uses its own tab, or the older combined tab
   if it has none. `tabs` is { match: values|null, pit: values|null, combined: values|null }. */
export function combineDefinitions({ match = null, pit = null, combined = null }) {
	const result = { match: new Map(), pit: new Map(), problems: [] };
	const older = combined ? parseDefinitions(combined) : null;

	for (const [form, values] of [["match", match], ["pit", pit]]) {
		if (values) {
			const parsed = parseDefinitions(values, form, DEFINITION_TABS[form]);
			result[form] = parsed[form];
			result.problems.push(...parsed.problems);
		} else if (older) {
			result[form] = older[form];
		}
	}

	if (older && (match === null || pit === null)) result.problems.push(...older.problems);
	return result;
}
