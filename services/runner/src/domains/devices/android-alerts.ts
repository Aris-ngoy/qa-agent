/**
 * Accept / dismiss native alerts, including Android runtime permission sheets
 * that are not WebDriver Alert objects (`acceptAlert` → "no such alert").
 */

import { isAndroidDriver } from "./android-gestures";

export type AlertBrowser = {
	capabilities?: { platformName?: unknown };
	execute: (command: string, params?: object) => Promise<unknown>;
	acceptAlert: () => Promise<void>;
	dismissAlert: () => Promise<void>;
	$: (selector: string) => {
		isExisting: () => Promise<boolean>;
		click: () => Promise<unknown>;
	};
};

export const ANDROID_ACCEPT_BUTTON_LABELS = [
	"Allow",
	"ALLOW",
	"While using the app",
	"While using this app",
	"Allow all the time",
	"Allow only while using the app",
	"OK",
] as const;

export const ANDROID_DISMISS_BUTTON_LABELS = [
	"Don't allow",
	"Don’t allow",
	"Don't Allow",
	"Deny",
	"DENY",
	"No thanks",
] as const;

export const ANDROID_ACCEPT_RESOURCE_IDS = [
	"com.android.permissioncontroller:id/permission_allow_button",
	"com.android.permissioncontroller:id/permission_allow_foreground_only_button",
	"com.android.permissioncontroller:id/permission_allow_one_time_button",
	"com.android.packageinstaller:id/permission_allow_button",
	"com.samsung.android.permissioncontroller:id/permission_allow_button",
] as const;

export const ANDROID_DISMISS_RESOURCE_IDS = [
	"com.android.permissioncontroller:id/permission_deny_button",
	"com.android.permissioncontroller:id/permission_deny_and_dont_ask_again_button",
	"com.android.packageinstaller:id/permission_deny_button",
	"com.samsung.android.permissioncontroller:id/permission_deny_button",
] as const;

export type AlertAttempt =
	| { method: "mobile-acceptAlert"; buttonLabel?: string }
	| { method: "mobile-dismissAlert"; buttonLabel?: string }
	| { method: "resource-id"; id: string }
	| { method: "text"; text: string }
	| { method: "w3c-acceptAlert" }
	| { method: "w3c-dismissAlert" }
	| { method: "mobile-alert"; action: "accept" | "dismiss" };

export function androidAlertAttempts(action: "accept" | "dismiss"): AlertAttempt[] {
	const labels = action === "accept" ? ANDROID_ACCEPT_BUTTON_LABELS : ANDROID_DISMISS_BUTTON_LABELS;
	const ids = action === "accept" ? ANDROID_ACCEPT_RESOURCE_IDS : ANDROID_DISMISS_RESOURCE_IDS;
	const mobile = action === "accept" ? "mobile-acceptAlert" : "mobile-dismissAlert";
	const attempts: AlertAttempt[] = [];
	for (const buttonLabel of labels) {
		attempts.push({ method: mobile, buttonLabel });
	}
	attempts.push({ method: mobile });
	for (const id of ids) {
		attempts.push({ method: "resource-id", id });
	}
	for (const text of labels) {
		attempts.push({ method: "text", text });
	}
	return attempts;
}

export function iosAlertAttempts(action: "accept" | "dismiss"): AlertAttempt[] {
	return [
		action === "accept" ? { method: "w3c-acceptAlert" } : { method: "w3c-dismissAlert" },
		{ method: "mobile-alert", action },
	];
}

export function alertAttemptsFor(
	browser: { capabilities?: { platformName?: unknown } },
	action: "accept" | "dismiss",
): AlertAttempt[] {
	return isAndroidDriver(browser) ? androidAlertAttempts(action) : iosAlertAttempts(action);
}

async function tryClickSelector(browser: AlertBrowser, selector: string): Promise<boolean> {
	try {
		const el = browser.$(selector);
		if (await el.isExisting()) {
			await el.click();
			return true;
		}
	} catch {
		return false;
	}
	return false;
}

function xpathExactText(text: string): string {
	if (text.includes("'") && text.includes('"')) {
		const parts = text.split("'").map((part) => `'${part}'`);
		return `//*[@text=concat(${parts.join(`, "'", `)})]`;
	}
	if (text.includes("'")) {
		return `//*[@text="${text}"]`;
	}
	return `//*[@text='${text}']`;
}

async function runAttempt(browser: AlertBrowser, attempt: AlertAttempt): Promise<boolean> {
	try {
		switch (attempt.method) {
			case "mobile-acceptAlert": {
				const args = attempt.buttonLabel ? { buttonLabel: attempt.buttonLabel } : {};
				await browser.execute("mobile: acceptAlert", args);
				return true;
			}
			case "mobile-dismissAlert": {
				const args = attempt.buttonLabel ? { buttonLabel: attempt.buttonLabel } : {};
				await browser.execute("mobile: dismissAlert", args);
				return true;
			}
			case "resource-id":
				return await tryClickSelector(
					browser,
					`android=new UiSelector().resourceId("${attempt.id}")`,
				);
			case "text":
				return await tryClickSelector(browser, xpathExactText(attempt.text));
			case "w3c-acceptAlert":
				await browser.acceptAlert();
				return true;
			case "w3c-dismissAlert":
				await browser.dismissAlert();
				return true;
			case "mobile-alert":
				await browser.execute("mobile: alert", { action: attempt.action });
				return true;
		}
	} catch {
		return false;
	}
}

export async function resolveNativeAlert(
	browser: AlertBrowser,
	action: "accept" | "dismiss",
): Promise<AlertAttempt> {
	const attempts = alertAttemptsFor(browser, action);
	for (const attempt of attempts) {
		if (await runAttempt(browser, attempt)) {
			return attempt;
		}
	}
	throw new Error(
		action === "accept"
			? "Could not accept the system alert (no Allow / permission button found)"
			: "Could not dismiss the system alert (no Don't allow / Deny button found)",
	);
}
