import type { Device } from "./schemas";

/**
 * The Chromium-family browsers Yoqa drives, in listing order. Each is `web-<browser>` when
 * Yoqa launches it on a Kept profile and `web-<browser>-everyday` as the user's Everyday
 * browser (ADR-0007, ADR-0009). The runner lists them and the CLI takes its web ids from
 * here, so a browser the runner lists is never refused by the CLI. `name` is also the app
 * bundle's name. A browser is `verified` once a hands-on check has cleared it.
 */
export const WEB_BROWSERS = [
	{ browser: "chrome", name: "Google Chrome", verified: true },
	{ browser: "edge", name: "Microsoft Edge", verified: true },
	{ browser: "brave", name: "Brave Browser", verified: true },
	{ browser: "chromium", name: "Chromium", verified: true },
	{ browser: "dia", name: "Dia", verified: true },
	{ browser: "arc", name: "Arc", verified: false },
	{ browser: "opera", name: "Opera", verified: false },
	{ browser: "vivaldi", name: "Vivaldi", verified: false },
] as const;

/** A browser's short lowercase name in its device ids (`chrome`). */
export type WebBrowserKey = (typeof WEB_BROWSERS)[number]["browser"];

/** The device id of a browser Yoqa launches (`web-chrome`). */
export type InstalledBrowserId = `web-${WebBrowserKey}`;

/** The device id of a browser's Everyday browser (`web-chrome-everyday`). */
export type EverydayBrowserId = `web-${WebBrowserKey}-everyday`;

export function installedBrowserId(browser: WebBrowserKey): InstalledBrowserId {
	return `web-${browser}`;
}

export function everydayBrowserId(browser: WebBrowserKey): EverydayBrowserId {
	return `web-${browser}-everyday`;
}

/** Where Chrome 144+, Edge and Dia keep the remote-debugging toggle (ADR-0009). */
export const REMOTE_DEBUGGING_SETTING_URL = "chrome://inspect/#remote-debugging";

/** How long a connect to an Everyday browser waits for the user's Allow (ADR-0009). */
export const EVERYDAY_ALLOW_TIMEOUT_MS = 60_000;

/** One of the browsers in `WEB_BROWSERS`. */
export type WebBrowser = (typeof WEB_BROWSERS)[number];

/** The device id of a browser attached by its debug port (`chromium-cdp-9222`). */
export type AttachDeviceId = `chromium-cdp-${number}`;

/**
 * What a web device id names: one of a Browser device's three ways in (CONTEXT.md), or a
 * Firefox or Safari id the runner refuses with its reason (ADR-0010). `browser` is the
 * browser the id names, null when it names none of `WEB_BROWSERS`: an attached browser is
 * known only once it answers, and Firefox and Safari are not Chromium.
 */
export type WebDevice =
	/** A browser Yoqa launches on its App's Kept profile, and quits on disconnect (ADR-0007). */
	| { kind: "launched"; id: InstalledBrowserId; browser: WebBrowser }
	/** The user's own browser, attached by consent and left open (ADR-0009). */
	| { kind: "everyday"; id: EverydayBrowserId; browser: WebBrowser }
	/** A browser the user started with remote debugging, attached by naming its port. */
	| { kind: "port"; id: string; port: number; browser: null }
	/** Firefox or Safari, in either form: a web id with no way in (ADR-0010). */
	| { kind: "unsupported"; id: string; browser: null };

const ATTACH_ID = /^chromium-cdp-(\d{1,5})$/;
const UNSUPPORTED_ID = /^web-(firefox|safari)(-everyday)?$/;

/**
 * Classify a device id as a Browser device, or null when it names no web device (a phone,
 * a simulator, a typo). This is the one copy of the web id rules: the runner, the CLI and
 * the desktop all ask it, so none accepts an id another refuses.
 */
export function webDeviceOf(deviceId: string): WebDevice | null {
	for (const browser of WEB_BROWSERS) {
		const launched = installedBrowserId(browser.browser);
		if (deviceId === launched) return { kind: "launched", id: launched, browser };
		const everyday = everydayBrowserId(browser.browser);
		if (deviceId === everyday) return { kind: "everyday", id: everyday, browser };
	}
	const match = ATTACH_ID.exec(deviceId);
	const port = Number(match?.[1]);
	if (match && port >= 1 && port <= 65_535) {
		return { kind: "port", id: deviceId, port, browser: null };
	}
	if (UNSUPPORTED_ID.test(deviceId)) return { kind: "unsupported", id: deviceId, browser: null };
	return null;
}

/** The device id that attaches the browser listening on `port` (`chromium-cdp-9222`). */
export function attachDeviceId(port: number): AttachDeviceId {
	return `chromium-cdp-${port}`;
}

/** `remote debugging off · unverified`: a device's state, with `unverified` on a browser not yet checked. */
export function formatDeviceState(device: Pick<Device, "state" | "verified">): string | null {
	const parts = [device.state, device.verified === false ? "unverified" : null].filter(Boolean);
	return parts.length > 0 ? parts.join(" · ") : null;
}
