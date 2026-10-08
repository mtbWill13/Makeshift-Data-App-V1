document.addEventListener("wheel", event => {
	if (document.activeElement.type == "number") {
		document.activeElement.blur();
	}
});
