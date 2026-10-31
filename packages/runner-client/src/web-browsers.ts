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

/** The browser a launched or Everyday device id names, or undefined for any other id. */
export function webBrowserOf(deviceId: string): (typeof WEB_BROWSERS)[number] | undefined {
	return WEB_BROWSERS.find(
		({ browser }) =>
			deviceId === installedBrowserId(browser) || deviceId === everydayBrowserId(browser),
	);
}

/** `remote debugging off · unverified`: a device's state, with `unverified` on a browser not yet checked. */
export function formatDeviceState(device: Pick<Device, "state" | "verified">): string | null {
	const parts = [device.state, device.verified === false ? "unverified" : null].filter(Boolean);
	return parts.length > 0 ? parts.join(" · ") : null;
}
