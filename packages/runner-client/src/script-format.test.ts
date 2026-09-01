import { describe, expect, test } from "bun:test";
import type { CaseScript } from "./schemas";
import {
	formatCaseScriptJson,
	formatCaseScriptShell,
	suggestedScriptBasename,
} from "./script-format";

const script: CaseScript = {
	version: 1,
	savedAt: 1_700_000_000_000,
	actions: [
		{ type: "tap", x: 100, y: 200 },
		{ type: "type", text: "it's ok" },
		{ type: "wait", ms: 1500 },
	],
};

describe("formatCaseScriptJson", () => {
	test("pretty-prints JSON with trailing newline", () => {
		const out = formatCaseScriptJson(script);
		expect(out.endsWith("\n")).toBe(true);
		expect(JSON.parse(out)).toEqual(script);
	});
});

describe("formatCaseScriptShell", () => {
	test("emits bash replay lines with escaped quotes", () => {
		const out = formatCaseScriptShell(script, {
			caseNumber: 3,
			caseName: "Login",
		});
		expect(out).toContain("# Yoqa exported script — #3 Login");
		expect(out).toContain("yoqa action tap --x 100 --y 200");
		expect(out).toContain("yoqa action input --text 'it'\\''s ok'");
		expect(out).toContain("sleep 1.5");
	});

	test("emits label taps and asserts", () => {
		const out = formatCaseScriptShell({
			version: 1,
			savedAt: 1,
			actions: [
				{ type: "assert", assertion: "visible", text: "Yoqa Demo", timeoutMs: 60_000 },
				{ type: "tap", label: "Increment" },
			],
		});
		expect(out).toContain("yoqa assert visible --text 'Yoqa Demo' --timeout 60");
		expect(out).toContain("yoqa action tap --label 'Increment'");
	});

	test("emits swipe coordinates", () => {
		const out = formatCaseScriptShell({
			version: 1,
			savedAt: 1,
			actions: [{ type: "swipe", x: 500, y: 800, x2: 500, y2: 200, durationMs: 400 }],
		});
		expect(out).toContain("yoqa action swipe --x 500 --y 800 --x2 500 --y2 200 --duration 400");
	});

	test("emits drag, app lifecycle, open-url, and double-tap", () => {
		const out = formatCaseScriptShell({
			version: 1,
			savedAt: 1,
			actions: [
				{ type: "tap", x: 10, y: 20, double: true },
				{ type: "drag", x: 100, y: 500, x2: 800, y2: 500, durationMs: 300 },
				{ type: "restart-app", appId: "com.example.app" },
				{ type: "background-app", seconds: 2 },
				{ type: "open-url", url: "https://example.com" },
			],
		});
		expect(out).toContain("yoqa action tap --x 10 --y 20 --double");
		expect(out).toContain("yoqa action drag --x 100 --y 500 --x2 800 --y2 500 --duration 300");
		expect(out).toContain("yoqa action restart-app --app-id 'com.example.app'");
		expect(out).toContain("yoqa action background-app --seconds 2");
		expect(out).toContain("yoqa action open-url --url 'https://example.com'");
	});

	test("emits accept alert", () => {
		const out = formatCaseScriptShell({
			version: 1,
			savedAt: 1,
			actions: [{ type: "alert", alertAction: "accept" }],
		});
		expect(out).toContain("yoqa action alert");
		expect(out).not.toContain("--dismiss");
	});
});

describe("suggestedScriptBasename", () => {
	test("slugs metadata and falls back", () => {
		expect(
			suggestedScriptBasename({
				appPrefix: "Demo App",
				caseNumber: 12,
				caseName: "Sign In!",
			}),
		).toBe("demo-app-12-sign-in");
		expect(suggestedScriptBasename({})).toBe("yoqa-script");
	});
});
