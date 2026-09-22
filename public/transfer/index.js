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

/* Smaller, high-error-correction frames scan more reliably from a phone screen. */
const QR_CHUNK_SIZE = 400;
let preparedPackage = null;
let frames = [];
let frameIndex = 0;
let autoPlayTimer = null;
let cameraStream = null;
let scanTimer = null;
let scannedFrames = new Map();
let receivedPackage = null;

function downloadFile(name, content, type = "application/json") {
	const url = URL.createObjectURL(new Blob([content], { type }));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function framePayloads(encodedPackage, id) {
	const chunks = [];
	for (let offset = 0; offset < encodedPackage.length; offset += QR_CHUNK_SIZE) {
		chunks.push(encodedPackage.slice(offset, offset + QR_CHUNK_SIZE));
	}

	const total = chunks.length;
	return chunks.map((chunk, index) =>
		`MSH1|${id}|${index + 1}|${total}|${ScoutOffline.checksum(chunk)}|${chunk}`
	);
}

async function showFrame() {
	if (!frames.length) return;

	await QRCode.toCanvas(qrCode, frames[frameIndex], {
		errorCorrectionLevel: "Q",
		margin: 1,
		width: 640,
		color: { dark: "#000000", light: "#ffffff" }
	});
	frameStatus.textContent = `Frame ${frameIndex + 1} of ${frames.length}`;
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
		frames = framePayloads(
			await ScoutOffline.encodeTransferPackage(preparedPackage),
			preparedPackage.transferId
		);
		frameIndex = 0;
		await showFrame();
		qrPanel.hidden = false;
		downloadButton.disabled = false;
		sendStatus.textContent = `${preparedPackage.reports.length} report${preparedPackage.reports.length === 1 ? "" : "s"} prepared. The passcode is not included.`;
	} catch (error) {
		sendStatus.textContent = error.message;
	} finally {
		prepareButton.disabled = false;
	}
}

function parseFrame(value) {
	const parts = String(value).split("|");
	if (parts.length !== 6 || parts[0] !== "MSH1") return null;
	const [, transferId, partNumber, totalParts, check, chunk] = parts;
	if (!Number.isInteger(Number(partNumber)) || !Number.isInteger(Number(totalParts)) || ScoutOffline.checksum(chunk) !== check) {
		return null;
	}
	return { transferId, partNumber: Number(partNumber), totalParts: Number(totalParts), chunk };
}

async function acceptFrame(value) {
	const frame = parseFrame(value);
	if (!frame) return;

	if (scannedFrames.size && !scannedFrames.has(frame.partNumber)) {
		const first = scannedFrames.values().next().value;
		if (first.transferId !== frame.transferId || first.totalParts !== frame.totalParts) return;
	}

	scannedFrames.set(frame.partNumber, frame);
	receiveStatus.textContent = `Received ${scannedFrames.size} of ${frame.totalParts} QR frames…`;

	if (scannedFrames.size !== frame.totalParts) return;

	const encoded = [...scannedFrames.values()]
		.sort((left, right) => left.partNumber - right.partNumber)
		.map(item => item.chunk)
		.join("");

	try {
		await acceptTransferPackage(await ScoutOffline.decodeTransferPackage(encoded));
		scannedFrames = new Map();
	} catch (error) {
		receiveStatus.textContent = `Transfer could not be verified: ${error.message}`;
	}
}

async function acceptTransferPackage(transferPackage) {
	if (transferPackage?.format !== "makeshift-scouting-transfer" || !Array.isArray(transferPackage.reports)) {
		throw new Error("This is not a MakeShift scouting backup.");
	}

	receivedPackage = transferPackage;
	await ScoutOffline.importTransferPackage(transferPackage);
	receivedActions.hidden = false;
	receiveStatus.textContent = `${transferPackage.reports.length} report${transferPackage.reports.length === 1 ? "" : "s"} received and verified for ${transferPackage.eventKey}.`;
}

function csvForPackage(transferPackage) {
	const headers = transferPackage.schema?.headers || [];
	const columnHeaders = headers.length
		? headers
		: [...new Set(transferPackage.reports.flatMap(report => Object.keys(report.answers || {})))];
	const csvCell = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
	const rows = transferPackage.reports.map(report => columnHeaders.map((header, index) => {
		const columnKey = `column-${index}`;
		return report.answers?.[columnKey] ?? report.answers?.[header] ?? "";
	}));

	return [columnHeaders, ...rows].map(row => row.map(csvCell).join(",")).join("\n");
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
		receiveStatus.textContent = "Point the camera at the first QR frame.";
		scanTimer = setInterval(async () => {
			if (camera.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
			try {
				const codes = await detector.detect(camera);
				if (codes[0]?.rawValue) await acceptFrame(codes[0].rawValue);
			} catch { /* Keep scanning after a temporary camera decode failure. */ }
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
	if (receivedPackage) downloadFile(`makeshift-${receivedPackage.eventKey}-reports.csv`, csvForPackage(receivedPackage), "text/csv");
});
downloadReceivedBackup.addEventListener("click", () => {
	if (receivedPackage) downloadFile(`makeshift-${receivedPackage.eventKey}-received-backup.json`, JSON.stringify(receivedPackage));
});
uploadToSheets.addEventListener("click", async () => {
	if (!receivedPackage) return;
	if (!receiverPasscode.value) {
		receiveStatus.textContent = "Enter the scout passcode before uploading to Google Sheets.";
		return;
	}

	uploadToSheets.disabled = true;
	let uploaded = 0;
	let alreadyUploaded = 0;
	const endpoint = receivedPackage.type === "pit-scouting" ? "/api/pitscouting" : "/api/scouting";
	const uploadKey = `makeshift-transfer-uploaded-${receivedPackage.transferId}`;
	const uploadedIndexes = new Set(JSON.parse(localStorage.getItem(uploadKey) || "[]"));

	try {
		for (const [index, report] of receivedPackage.reports.entries()) {
			if (uploadedIndexes.has(index)) {
				alreadyUploaded += 1;
				continue;
			}

			const response = await fetch(`${endpoint}/${receivedPackage.eventKey}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ submissionToken: receiverPasscode.value, answers: report.answers })
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(body.error || "Google Sheets upload failed.");
			uploaded += 1;
			uploadedIndexes.add(index);
			localStorage.setItem(uploadKey, JSON.stringify([...uploadedIndexes]));
		}
		receiveStatus.textContent = `${uploaded} verified report${uploaded === 1 ? "" : "s"} uploaded to Google Sheets${alreadyUploaded ? `; ${alreadyUploaded} already uploaded earlier.` : "."}`;
	} catch (error) {
		receiveStatus.textContent = `${uploaded} report${uploaded === 1 ? "" : "s"} uploaded before: ${error.message}`;
	} finally {
		uploadToSheets.disabled = false;
	}
});
window.addEventListener("beforeunload", stopScanner);
