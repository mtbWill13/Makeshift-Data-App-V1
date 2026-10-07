const sendType = document.getElementById("sendType");
const sendEvent = document.getElementById("sendEvent");
const prepareButton = document.getElementById("prepareButton");
const downloadButton = document.getElementById("downloadButton");
const sendStatus = document.getElementById("sendStatus");
const qrPanel = document.getElementById("qrPanel");
const qrCode = document.getElementById("qrCode");
const frameStatus = document.getElementById("frameStatus");
const previousFrame = document.getElementById("previousFrame");
const nextFrame = document.getElementById("nextFrame");
const autoFrame = document.getElementById("autoFrame");
const startCamera = document.getElementById("startCamera");
const stopCamera = document.getElementById("stopCamera");
const camera = document.getElementById("camera");
const receiveStatus = document.getElementById("receiveStatus");
const fileInput = document.getElementById("fileInput");
const receivedActions = document.getElementById("receivedActions");
const downloadCsv = document.getElementById("downloadCsv");
const downloadReceivedBackup = document.getElementById("downloadReceivedBackup");
const receiverPasscode = document.getElementById("receiverPasscode");
const uploadToSheets = document.getElementById("uploadToSheets");
const receivedList = document.getElementById("receivedList");

const UPLOADED_STORAGE_KEY = "makeshift-uploaded-report-keys";
let preparedPackage = null;
let frames = [];
let frameLabels = [];
let frameIndex = 0;
let autoPlayTimer = null;
let cameraStream = null;
let scanTimer = null;
let receivedReports = new Map();

function downloadFile(name, content, type = "application/json") {
	const url = URL.createObjectURL(new Blob([content], { type }));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeHtml(value) {
	return String(value ?? "").replace(/[&<>"']/g, character => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#39;"
	})[character]);
}

/* "2026oncmp2 • Match 12 • Team 4039" when the cached sheet headers are known. */
function reportLabel(report) {
	const headers = ScoutOffline.cachedSchema(report.type, report.eventKey)?.headers || [];
	const answerFor = expression => {
		const index = headers.findIndex(header => expression.test(header));
		return index < 0 ? "" : report.answers?.[`column-${index}`] ?? report.answers?.[headers[index]] ?? "";
	};
	const match = answerFor(/^match number$/i);
	const team = answerFor(/team number/i);
	return [
		report.type === "pit-scouting" ? "Pit scouting" : "",
		report.eventKey,
		match && `Match ${match}`,
		team && `Team ${team}`
	].filter(Boolean).join(" • ");
}

async function showFrame() {
	if (!frames.length) return;

	await QRCode.toCanvas(qrCode, frames[frameIndex], {
		errorCorrectionLevel: "M",
		margin: 1,
		width: 360,
		color: { dark: "#000000", light: "#ffffff" }
	});
	frameStatus.textContent = `Report ${frameIndex + 1} of ${frames.length} • ${frameLabels[frameIndex]}`;
}

function stopAutoPlay() {
	clearInterval(autoPlayTimer);
	autoPlayTimer = null;
	autoFrame.textContent = "Auto-play";
}

async function prepareTransfer() {
	stopAutoPlay();
	prepareButton.disabled = true;
	sendStatus.textContent = "Preparing saved reports…";

	try {
		preparedPackage = await ScoutOffline.createTransferPackage(sendType.value, sendEvent.value.trim());
		const headers = preparedPackage.schema?.headers || [];
		frames = preparedPackage.reports.map(report => ScoutOffline.encodeReportQr(report, headers));
		frameLabels = preparedPackage.reports.map(reportLabel);
		frameIndex = 0;
		await showFrame();
		qrPanel.hidden = false;
		downloadButton.disabled = false;
		sendStatus.textContent = `${frames.length} report${frames.length === 1 ? "" : "s"} prepared, one QR code each. The passcode is not included.`;
	} catch (error) {
		sendStatus.textContent = error.message;
	} finally {
		prepareButton.disabled = false;
	}
}

function uploadedKeys() {
	try {
		return new Set(JSON.parse(localStorage.getItem(UPLOADED_STORAGE_KEY) || "[]"));
	} catch {
		return new Set();
	}
}

function renderReceived(latest = "") {
	const uploaded = uploadedKeys();
	const reports = [...receivedReports.values()];

	receivedActions.hidden = !reports.length;
	receivedList.hidden = !reports.length;
	receivedList.innerHTML = reports
		.sort((left, right) => left.createdAt - right.createdAt)
		.map(report => `<li>${escapeHtml(reportLabel(report))}${uploaded.has(ScoutOffline.reportKey(report)) ? " • uploaded" : ""}</li>`)
		.join("");
	receiveStatus.textContent = `${reports.length} report${reports.length === 1 ? "" : "s"} received.${latest ? ` Latest: ${latest}.` : ""}`;
}

async function acceptReports(reports) {
	let latest = "";

	for (const report of reports) {
		const key = ScoutOffline.reportKey(report);
		if (receivedReports.has(key)) continue;

		receivedReports.set(key, report);
		await ScoutOffline.importReport(report);
		latest = reportLabel(report);
	}

	if (latest) renderReceived(latest);
}

/* Every QR code in view is read, so several reports can be scanned at once. */
async function acceptCodes(values) {
	await acceptReports(values.map(ScoutOffline.decodeReportQr).filter(Boolean));
}

async function acceptTransferPackage(transferPackage) {
	if (transferPackage?.format !== "makeshift-scouting-transfer" || !Array.isArray(transferPackage.reports)) {
		throw new Error("This is not a MakeShift scouting backup.");
	}

	const { reports } = await ScoutOffline.importTransferPackage(transferPackage);
	await acceptReports(reports);
	renderReceived();
}

function columnLetter(index) {
	let result = "";
	for (let current = index + 1; current > 0; current = Math.floor((current - 1) / 26)) {
		result = String.fromCharCode(65 + (current - 1) % 26) + result;
	}
	return result;
}

function receivedCsv() {
	const reports = [...receivedReports.values()].sort((left, right) => left.createdAt - right.createdAt);
	const groups = new Set(reports.map(report => `${report.type}|${report.eventKey}`));
	const headers = groups.size === 1
		? ScoutOffline.cachedSchema(reports[0].type, reports[0].eventKey)?.headers || []
		: [];
	const columnCount = Math.max(
		headers.length,
		...reports.flatMap(report => Object.keys(report.answers || {})
			.map(key => /^column-(\d+)$/.exec(key))
			.filter(Boolean)
			.map(match => Number(match[1]) + 1))
	);
	const columnHeaders = Array.from({ length: columnCount }, (_, index) => headers[index] || `Column ${columnLetter(index)}`);
	const csvCell = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
	const rows = reports.map(report => [
		report.type,
		report.eventKey,
		...columnHeaders.map((header, index) => report.answers?.[`column-${index}`] ?? report.answers?.[header] ?? "")
	]);

	return [["Type", "Event", ...columnHeaders], ...rows].map(row => row.map(csvCell).join(",")).join("\n");
}

async function startScanner() {
	if (!("BarcodeDetector" in window)) {
		receiveStatus.textContent = "This browser cannot scan QR codes here. Use Chrome or import the backup file.";
		return;
	}

	try {
		cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
		camera.srcObject = cameraStream;
		camera.hidden = false;
		await camera.play();
		const detector = new BarcodeDetector({ formats: ["qr_code"] });
		startCamera.disabled = true;
		stopCamera.disabled = false;
		receiveStatus.textContent = "Point the camera at one or more report QR codes.";
		scanTimer = setInterval(async () => {
			if (camera.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
			try {
				const codes = await detector.detect(camera);
				await acceptCodes(codes.map(code => code.rawValue).filter(Boolean));
			} catch { /* Keep scanning after a temporary camera decode failure. */ }
		}, 400);
	} catch (error) {
		console.log(error);
		receiveStatus.textContent = `Camera could not start: ${error.message}`;
	}
}

function stopScanner() {
	clearInterval(scanTimer);
	cameraStream?.getTracks().forEach(track => track.stop());
	cameraStream = null;
	camera.hidden = true;
	startCamera.disabled = false;
	stopCamera.disabled = true;
}

prepareButton.addEventListener("click", prepareTransfer);
downloadButton.addEventListener("click", () => {
	if (preparedPackage) downloadFile(`makeshift-${preparedPackage.eventKey}-${preparedPackage.transferId}.json`, JSON.stringify(preparedPackage));
});
previousFrame.addEventListener("click", async () => { frameIndex = (frameIndex + frames.length - 1) % frames.length; stopAutoPlay(); await showFrame(); });
nextFrame.addEventListener("click", async () => { frameIndex = (frameIndex + 1) % frames.length; stopAutoPlay(); await showFrame(); });
autoFrame.addEventListener("click", () => {
	if (autoPlayTimer) return stopAutoPlay();
	autoPlayTimer = setInterval(async () => { frameIndex = (frameIndex + 1) % frames.length; await showFrame(); }, 2200);
	autoFrame.textContent = "Stop auto-play";
});
startCamera.addEventListener("click", startScanner);
stopCamera.addEventListener("click", stopScanner);
fileInput.addEventListener("change", async () => {
	const file = fileInput.files[0];
	if (!file) return;
	try { await acceptTransferPackage(JSON.parse(await file.text())); } catch (error) { receiveStatus.textContent = error.message; }
});
downloadCsv.addEventListener("click", () => {
	if (receivedReports.size) downloadFile("makeshift-received-reports.csv", receivedCsv(), "text/csv");
});
downloadReceivedBackup.addEventListener("click", () => {
	const reports = [...receivedReports.values()];
	if (!reports.length) return;

	downloadFile("makeshift-received-backup.json", JSON.stringify({
		format: "makeshift-scouting-transfer",
		version: 1,
		transferId: `received-${Date.now()}`,
		createdAt: new Date().toISOString(),
		type: reports[0].type,
		eventKey: reports[0].eventKey,
		reports
	}));
});
uploadToSheets.addEventListener("click", async () => {
	if (!receivedReports.size) return;
	if (!receiverPasscode.value) {
		receiveStatus.textContent = "Enter the scout passcode before uploading to Google Sheets.";
		return;
	}

	uploadToSheets.disabled = true;
	let uploaded = 0;
	let alreadyUploaded = 0;
	const uploadedReportKeys = uploadedKeys();

	try {
		for (const report of receivedReports.values()) {
			const key = ScoutOffline.reportKey(report);
			if (uploadedReportKeys.has(key)) {
				alreadyUploaded += 1;
				continue;
			}

			const endpoint = report.type === "pit-scouting" ? "/api/pitscouting" : "/api/scouting";
			const response = await fetch(`${endpoint}/${report.eventKey}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ submissionToken: receiverPasscode.value, answers: report.answers })
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(body.error || "Google Sheets upload failed.");
			uploaded += 1;
			uploadedReportKeys.add(key);
			localStorage.setItem(UPLOADED_STORAGE_KEY, JSON.stringify([...uploadedReportKeys]));
		}
		renderReceived();
		receiveStatus.textContent = `${uploaded} report${uploaded === 1 ? "" : "s"} uploaded to Google Sheets${alreadyUploaded ? `; ${alreadyUploaded} already uploaded earlier.` : "."}`;
	} catch (error) {
		renderReceived();
		receiveStatus.textContent = `${uploaded} report${uploaded === 1 ? "" : "s"} uploaded before: ${error.message}`;
	} finally {
		uploadToSheets.disabled = false;
	}
});
window.addEventListener("beforeunload", stopScanner);
