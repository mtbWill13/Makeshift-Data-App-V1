/* Printable QR codes for scouts: scan to open a page of the site. */

const baseUrl = document.getElementById("baseUrl");
const baseNote = document.getElementById("baseNote");
const cards = document.getElementById("cards");
const STORAGE_KEY = "makeshift-qr-base-url";

const PAGES = [
	{ path: "/scouting/", title: "Match Scouting", hint: "Scan to scout a match" },
	{ path: "/pitScouting/", title: "Pit Scouting", hint: "Scan to scout a robot in the pits" },
	{ path: "/", title: "Data Hub", hint: "Scan to open the scouting site" }
];

function savedBase() {
	try {
		return localStorage.getItem(STORAGE_KEY);
	} catch {
		return null;
	}
}

function cleanBase(value) {
	try {
		const url = new URL(value.trim());
		return /^https?:$/.test(url.protocol) ? url.origin : null;
	} catch {
		return null;
	}
}

/* A QR code for "localhost" only works on the computer showing it. */
function describeBase(origin) {
	const host = new URL(origin).hostname;

	if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
		return { kind: "warn", text: "This address only works on this computer. Type the address scouts will use (your website's public address, or this computer's address on the venue wifi)." };
	}

	if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
		return { kind: "warn", text: "This is a local-network address, so phones must be on the same wifi to use it." };
	}

	return { kind: "ok", text: "Scouts will need to log in with the team password after scanning." };
}

async function draw() {
	const origin = cleanBase(baseUrl.value);
	cards.replaceChildren();

	if (!origin) {
		baseNote.textContent = "Enter a full web address, like https://example.com";
		baseNote.className = "status bad";
		return;
	}

	const { kind, text } = describeBase(origin);
	baseNote.textContent = text;
	baseNote.className = `status ${kind === "warn" ? "warn" : ""}`;
	try {
		localStorage.setItem(STORAGE_KEY, origin);
	} catch {
		/* printing still works */
	}

	for (const page of PAGES) {
		const card = document.createElement("article");
		card.className = "qr-card";

		const title = document.createElement("h2");
		title.textContent = page.title;
		const canvas = document.createElement("canvas");
		const hint = document.createElement("p");
		hint.textContent = page.hint;
		const link = document.createElement("code");
		link.textContent = `${origin}${page.path}`;
		card.append(title, canvas, hint, link);
		cards.append(card);

		await QRCode.toCanvas(canvas, `${origin}${page.path}`, {
			errorCorrectionLevel: "M",
			margin: 2,
			width: 360,
			color: { dark: "#000000", light: "#ffffff" }
		});
	}
}

baseUrl.value = savedBase() ?? window.location.origin;
baseUrl.addEventListener("input", draw);
document.getElementById("printButton").addEventListener("click", () => window.print());
draw();
