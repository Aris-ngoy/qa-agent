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
