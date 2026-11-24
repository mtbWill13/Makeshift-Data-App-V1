/* =================================
   FTC OFFLINE TRANSFER
   Reports saved on a phone (see FtcScout's offline queue) become one QR code each, scanned on the
   strategy computer and uploaded there. A QR code holds the answers by position (in the order of
   the questions in ftc-game.js), so it stays small.
================================= */

const $ = id => document.getElementById(id);
const sendStatus = $("sendStatus");
const qrPanel = $("qrPanel");
const qrCode = $("qrCode");
const frameStatus = $("frameStatus");
const receiveStatus = $("receiveStatus");
const receivedList = $("receivedList");
const receivedActions = $("receivedActions");
const camera = $("camera");

const QUEUE_KEY = "ftc-scout-queue";
const UPLOADED_KEY = "ftc-uploaded-submissions";
const TAG = "FTC1";

let game = null;
let frames = [];
let frameLabels = [];
let frameIndex = 0;
let autoPlayTimer = null;
let cameraStream = null;
let scanTimer = null;
let queued = [];
const received = new Map();     // submissionId -> { kind, payload }

const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const fieldsOf = kind => game[kind].sections.flatMap(section => section.fields);
const cell = value => encodeURIComponent(value ?? "");
const uncell = value => decodeURIComponent(value);

/* ----- one report as a short line of text ----- */

const answerText = (field, value) => {
	if (value === undefined || value === null || value === "") return "";
	if (field.type === "multi") return [].concat(value).join("+");
	return String(value);
};

function encodeReport({ kind, payload }) {
	const fields = fieldsOf(kind);
	const head = [TAG, kind, payload.submissionId, payload.season, payload.event, payload.matchNumber ?? "", payload.team, payload.alliance ?? "", payload.scout, payload.noShow ?? "", payload.flagged ? "1" : "", fields.length];
	return [...head, ...fields.map(field => answerText(field, payload.answers?.[field.id]))].map(cell).join("|");
}

function decodeReport(text) {
	const parts = String(text).split("|").map(part => { try { return uncell(part); } catch { return ""; } });
	if (parts[0] !== TAG || !["match", "pit"].includes(parts[1])) return null;

	const [, kind, submissionId, season, event, matchNumber, team, alliance, scout, noShow, flagged, count] = parts;
	const fields = fieldsOf(kind);
	if (Number(count) !== fields.length) return { error: "These reports were made with a different version of the questions. Update both devices and scan again." };

	const answers = {};
	fields.forEach((field, index) => {
		const value = parts[12 + index];
		if (value === "" || value === undefined) return;
		answers[field.id] = field.type === "multi" ? value.split("+") : value;
	});

	const payload = { season, event, team: Number(team), scout, flagged: flagged === "1", submissionId, answers };
	if (kind === "match") Object.assign(payload, { matchNumber: Number(matchNumber), alliance: alliance || null, noShow: noShow || "no" });
	return { kind, payload };
}

const label = ({ kind, payload }) => `${kind === "pit" ? "Pit" : `Match ${payload.matchNumber}`} · team ${payload.team} · ${payload.event} · ${payload.scout}`;

/* ----- send ----- */

async function showFrame() {
	if (!frames.length) return;
	await QRCode.toCanvas(qrCode, frames[frameIndex], { errorCorrectionLevel: "M", margin: 1, width: 360, color: { dark: "#000000", light: "#ffffff" } });
	frameStatus.textContent = `Report ${frameIndex + 1} of ${frames.length} • ${frameLabels[frameIndex]}`;
}

function stopAutoPlay() {
	clearInterval(autoPlayTimer);
	autoPlayTimer = null;
	$("autoFrame").textContent = "Auto-play";
}

async function prepare() {
	stopAutoPlay();
	queued = readJson(QUEUE_KEY, []);

	if (!queued.length) {
		sendStatus.textContent = "There are no reports saved on this device to send.";
		qrPanel.hidden = true;
		$("downloadButton").disabled = true;
		return;
	}

	frames = queued.map(encodeReport);
	frameLabels = queued.map(label);
	frameIndex = 0;
	await showFrame();
	qrPanel.hidden = false;
	$("downloadButton").disabled = false;
	sendStatus.textContent = `${queued.length} report${queued.length === 1 ? "" : "s"} prepared, one QR code each.`;
}

/* ----- receive ----- */

function renderReceived(latest = "") {
	const uploaded = new Set(readJson(UPLOADED_KEY, []));
	receivedActions.hidden = !received.size;
	receivedList.hidden = !received.size;
	receivedList.innerHTML = [...received.values()].map(item => `<li>${ftcEscape(label(item))}${uploaded.has(item.payload.submissionId) ? " • uploaded" : ""}</li>`).join("");
	receiveStatus.textContent = `${received.size} report${received.size === 1 ? "" : "s"} received.${latest ? ` Latest: ${latest}.` : ""}`;
}

function accept(items) {
	let latest = "";
	for (const item of items) {
		if (!item) continue;
		if (item.error) {
			receiveStatus.textContent = item.error;
			continue;
		}
		if (received.has(item.payload.submissionId)) continue;
		received.set(item.payload.submissionId, item);
		latest = label(item);
	}
	if (latest) renderReceived(latest);
}

async function startScanner() {
	if (!("BarcodeDetector" in window)) {
		receiveStatus.textContent = "This browser can't scan QR codes here. Use Chrome, or import the backup file.";
		return;
	}

	try {
		cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
		camera.srcObject = cameraStream;
		camera.hidden = false;
		await camera.play();
		const detector = new BarcodeDetector({ formats: ["qr_code"] });
		$("startCamera").disabled = true;
		$("stopCamera").disabled = false;
		receiveStatus.textContent = "Point the camera at one or more report QR codes.";
		scanTimer = setInterval(async () => {
			if (camera.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
			try {
				const codes = await detector.detect(camera);
				accept(codes.map(code => decodeReport(code.rawValue)));
			} catch { /* keep scanning after a temporary decode failure */ }
		}, 400);
	} catch (error) {
		receiveStatus.textContent = `Camera could not start: ${error.message}`;
	}
}

function stopScanner() {
	clearInterval(scanTimer);
	cameraStream?.getTracks().forEach(track => track.stop());
	cameraStream = null;
	camera.hidden = true;
	$("startCamera").disabled = false;
	$("stopCamera").disabled = true;
}

function downloadFile(name, content) {
	const link = document.createElement("a");
	link.href = URL.createObjectURL(new Blob([content], { type: "application/json" }));
	link.download = name;
	link.click();
	setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/* ----- buttons ----- */

$("prepareButton").addEventListener("click", prepare);
$("previousFrame").addEventListener("click", async () => { frameIndex = (frameIndex + frames.length - 1) % frames.length; stopAutoPlay(); await showFrame(); });
$("nextFrame").addEventListener("click", async () => { frameIndex = (frameIndex + 1) % frames.length; stopAutoPlay(); await showFrame(); });
$("autoFrame").addEventListener("click", () => {
	if (autoPlayTimer) return stopAutoPlay();
	autoPlayTimer = setInterval(async () => { frameIndex = (frameIndex + 1) % frames.length; await showFrame(); }, 2200);
	$("autoFrame").textContent = "Stop auto-play";
});
$("startCamera").addEventListener("click", startScanner);
$("stopCamera").addEventListener("click", stopScanner);

$("downloadButton").addEventListener("click", () => {
	if (queued.length) downloadFile(`makeshift-ftc-reports-${Date.now()}.json`, JSON.stringify({ format: "makeshift-ftc-transfer", version: 1, reports: queued }));
});
$("downloadReceived").addEventListener("click", () => {
	if (received.size) downloadFile(`makeshift-ftc-received-${Date.now()}.json`, JSON.stringify({ format: "makeshift-ftc-transfer", version: 1, reports: [...received.values()] }));
});

$("fileInput").addEventListener("change", async () => {
	const file = $("fileInput").files[0];
	$("fileInput").value = "";
	if (!file) return;

	try {
		const data = JSON.parse(await file.text());
		if (data?.format !== "makeshift-ftc-transfer" || !Array.isArray(data.reports)) throw new Error("This is not an FTC scouting backup.");
		accept(data.reports.filter(item => item?.payload?.submissionId && ["match", "pit"].includes(item.kind)));
		renderReceived();
	} catch (error) {
		receiveStatus.textContent = error.message;
	}
});

$("uploadReports").addEventListener("click", async () => {
	const uploaded = new Set(readJson(UPLOADED_KEY, []));
	let sent = 0;
	let skipped = 0;
	$("uploadReports").disabled = true;

	try {
		for (const item of received.values()) {
			if (uploaded.has(item.payload.submissionId)) {
				skipped += 1;
				continue;
			}

			const response = await fetch(`/api/ftc/scouting/${item.kind}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ...item.payload, confirmDuplicate: true })
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(body.error || "The upload failed.");

			uploaded.add(item.payload.submissionId);
			localStorage.setItem(UPLOADED_KEY, JSON.stringify([...uploaded]));
			sent += 1;
		}

		renderReceived();
		receiveStatus.textContent = `${sent} report${sent === 1 ? "" : "s"} uploaded${skipped ? `; ${skipped} already uploaded earlier` : ""}.`;
	} catch (error) {
		renderReceived();
		receiveStatus.textContent = `${sent} uploaded before: ${error.message}`;
	} finally {
		$("uploadReports").disabled = false;
	}
});

window.addEventListener("beforeunload", stopScanner);

(async () => {
	try {
		game = await ftcFetch("/api/ftc/game");
	} catch (error) {
		sendStatus.textContent = `Couldn't load the questions: ${error.message}`;
	}
})();
