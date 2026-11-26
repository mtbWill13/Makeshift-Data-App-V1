/* The hub's slide-out Menu on the right: opens from the Menu button, closes on ✕, Escape or a click outside. */
(() => {
	const button = document.getElementById("menuButton");
	const menu = document.getElementById("siteMenu");
	const scrim = document.getElementById("menuScrim");
	if (!button || !menu || !scrim) return;

	function setOpen(open) {
		menu.classList.toggle("open", open);
		menu.inert = !open;
		menu.setAttribute("aria-hidden", String(!open));
		button.setAttribute("aria-expanded", String(open));
		scrim.hidden = !open;
		document.body.classList.toggle("menu-open", open);
		(open ? menu.querySelector("a") : button).focus({ preventScroll: true });
	}

	button.addEventListener("click", () => setOpen(!menu.classList.contains("open")));
	document.getElementById("menuClose").addEventListener("click", () => setOpen(false));
	scrim.addEventListener("click", () => setOpen(false));
	document.addEventListener("keydown", event => {
		if (event.key === "Escape" && menu.classList.contains("open")) setOpen(false);
	});
})();
