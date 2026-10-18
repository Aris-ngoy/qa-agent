/**
 * Inject the Buy Me a Coffee widget on every docs page.
 * Mintlify loads *.js from the content directory globally; third-party
 * scripts must be appended from here (raw <script src> in MDX is unsupported).
 * @see https://www.mintlify.com/docs/customize/custom-scripts#custom-javascript
 */
function injectBuyMeACoffee() {
	if (document.querySelector('script[data-name="bmc-button"]')) return;

	const script = document.createElement("script");
	script.type = "text/javascript";
	script.src = "https://cdnjs.buymeacoffee.com/1.0.0/button.prod.min.js";
	script.async = true;
	script.dataset.name = "bmc-button";
	script.dataset.slug = "arisn";
	script.dataset.color = "#FFDD00";
	script.dataset.emoji = "☕";
	script.dataset.font = "Cookie";
	script.dataset.text = "Buy me a coffee";
	script.dataset.outlineColor = "#000000";
	script.dataset.fontColor = "#000000";
	script.dataset.coffeeColor = "#ffffff";
	document.head.appendChild(script);
}

injectBuyMeACoffee();
window.addEventListener("mintlify:navigate", injectBuyMeACoffee);
