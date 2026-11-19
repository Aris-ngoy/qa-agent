import { describe, expect, test } from "bun:test";
import { buildCommandLines } from "./command-snippets";
import { resetAppConfirmation, resetStepsIn, stepResultDetail } from "./reset-app";
import { caseScriptLinesFromShell } from "./script-text";

const point = {
	x: 500,
	y: 500,
	element: null,
	pointX: 500,
	pointY: 500,
	candidateIndex: 0,
	preferredLocator: "id" as const,
};

function dialogActions(lines: string[]) {
	return caseScriptLinesFromShell(lines, []).actions;
}

describe("resetStepsIn", () => {
	test("finds the Reset the dialog's resetApp command runs, keychain included", () => {
		const actions = dialogActions(
			buildCommandLines(point, "resetApp", "com.shop", undefined, { keychain: true }),
		);
		expect(resetStepsIn(actions)).toEqual([{ appId: "com.shop", keychain: true }]);
	});

	test("finds none for a Restart, so it runs without asking", () => {
		expect(resetStepsIn(dialogActions(buildCommandLines(point, "restartApp", "com.shop")))).toEqual(
			[],
		);
	});
});

describe("resetAppConfirmation", () => {
	test("names the App and says it cannot be undone", () => {
		expect(resetAppConfirmation({ appId: "com.shop", keychain: false })).toBe(
			"Reset ends com.shop and clears its data on this device, as a fresh install would leave it. It stays installed and is not launched again. This can't be undone.",
		);
	});

	test("warns that a keychain reset reaches every app on the simulator", () => {
		expect(resetAppConfirmation({ appId: "com.shop", keychain: true })).toBe(
			"Reset ends com.shop and clears its data on this device, as a fresh install would leave it. It stays installed and is not launched again. On an iOS simulator it also resets the whole keychain, which signs every app on it out. This can't be undone.",
		);
	});
});

describe("stepResultDetail", () => {
	test("says what a Reset cleared and kept on this Lane", () => {
		expect(
			stepResultDetail({
				ok: true,
				kind: "reset-app",
				reset: { cleared: ["data", "cache", "preferences"], kept: ["keychain"] },
			}),
		).toBe("cleared data, cache, preferences · kept keychain");
	});

	test("is empty for an Action with nothing to report", () => {
		expect(stepResultDetail({ ok: true, kind: "restart-app" })).toBeNull();
		expect(stepResultDetail(undefined)).toBeNull();
	});
});
