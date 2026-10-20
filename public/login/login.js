const form = document.getElementById("loginForm");
const teamInput = document.getElementById("team");
const password = document.getElementById("password");
const message = document.getElementById("message");
const submit = document.getElementById("submit");

const params = new URL(window.location).searchParams;
/* Where to go after logging in (the page they were trying to open). */
const next = params.get("next") || "/";

function readStorage(key) {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

/* Pre-fill the team this browser used last. */
teamInput.value = params.get("team") || readStorage("makeshift-last-team") || "";
(teamInput.value ? password : teamInput).focus();

form.addEventListener("submit", async event => {
	event.preventDefault();

	if (!teamInput.value.trim() || !password.value) {
		message.textContent = "Enter your team number and password.";
		(teamInput.value.trim() ? password : teamInput).focus();
		return;
	}

	submit.disabled = true;
	message.textContent = "";

	try {
		const response = await fetch("/api/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ team: teamInput.value.trim(), password: password.value, next })
		});
		const data = await response.json().catch(() => ({}));

		if (!response.ok) throw new Error(data.error || "Couldn't log in. Try again.");

		try {
			localStorage.setItem("makeshift-last-team", data.team.number);
			localStorage.setItem("makeshift-team", JSON.stringify(data.team));
		} catch {
			/* Private mode: pages ask the server instead. */
		}
		window.location.replace(data.next || "/");
	} catch (error) {
		message.textContent = error.message;
		password.select();
		submit.disabled = false;
	}
});
