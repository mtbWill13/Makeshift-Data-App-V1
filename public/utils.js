function saveTeamsInUrl(...teams) {
	const url = new URL(window.location);

	if (teams.length == 1) {
		url.searchParams.set("team", teams[0]);
	} else {
		for (let i = 0; i < teams.length; i++) {
			url.searchParams.set(`team${i + 1}`, teams[i]);
		}
	}

	window.history.replaceState({}, "", url);
}

function getTeamsFromUrl() {
	const url = new URL(window.location);

	if (url.searchParams.has("team")) {
		return [Number(url.searchParams.get("team"))];
	}

	let teams = [];

	for (let i = 0; i > -1; i++) {
		if (url.searchParams.has(`team${i + 1}`)) {
			teams.push(Number(url.searchParams.get(`team${i + 1}`)));
		} else {
			break;
		}
	}

	return teams;
}
