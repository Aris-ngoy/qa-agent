import { describe, expect, test } from "bun:test";
import type { ScreenElement } from "./schemas";
import {
	elementCenterNorm,
	findElementById,
	findElementByLabel,
	formatActionShellLine,
	formatAssertShellLine,
	formatScreenshotShellLine,
	formatSleepShellLine,
	parseYoqaShellScript,
	screenHasText,
	shellToCaseScript,
	tokenizeShellLine,
} from "./shell-script";

const button: ScreenElement = {
	type: "Button",
	label: "Get Bonus",
	id: "com.app:id/get_bonus",
	x: 100,
	y: 200,
	width: 200,
	height: 80,
};

const smallerButton: ScreenElement = {
	type: "Button",
	label: "Get Bonus",
	id: "com.app:id/get_bonus_small",
	x: 400,
	y: 200,
	width: 50,
	height: 40,
};

describe("tokenizeShellLine", () => {
	test("splits on whitespace", () => {
		expect(tokenizeShellLine("yoqa action tap --x 10")).toEqual([
			"yoqa",
			"action",
			"tap",
			"--x",
			"10",
		]);
	});

	test("keeps single-quoted text intact", () => {
		expect(tokenizeShellLine("yoqa action input --text 'hello world'")).toEqual([
			"yoqa",
			"action",
			"input",
			"--text",
			"hello world",
		]);
	});

	test("supports escaped characters in double quotes", () => {
		expect(tokenizeShellLine('yoqa action input --text "say \\"hi\\""')).toEqual([
			"yoqa",
			"action",
			"input",
			"--text",
			'say "hi"',
		]);
	});

	test("throws on unclosed quotes", () => {
		expect(() => tokenizeShellLine("yoqa action input --text 'oops")).toThrow("Unclosed quote");
	});
});

describe("parseYoqaShellScript", () => {
	test("parses sleep, tap, assert, screenshot, and ignores comments", () => {
		const result = parseYoqaShellScript(`
# comment
set -euo pipefail
sleep 1.5
yoqa action tap --x 100 --y 200 --double
yoqa assert visible --text 'Welcome' --timeout 3
yoqa screenshot
yoqa screenshot '/tmp/shot.png'
`);
		expect(result.errors).toEqual([]);
		expect(result.steps).toHaveLength(5);
		expect(result.steps[0]).toMatchObject({ kind: "sleep", seconds: 1.5 });
		expect(result.steps[1]).toMatchObject({
			kind: "action",
			action: { kind: "tap", x: 100, y: 200, double: true },
		});
		expect(result.steps[2]).toMatchObject({
			kind: "assert",
			assertion: "visible",
			text: "Welcome",
			timeoutSeconds: 3,
		});
		expect(result.steps[3]).toMatchObject({ kind: "screenshot", path: null });
		expect(result.steps[4]).toMatchObject({ kind: "screenshot", path: "/tmp/shot.png" });
	});

	test("collects parse errors without aborting later lines", () => {
		const result = parseYoqaShellScript(`
echo hi
yoqa action tap --x 10 --y 20
`);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]?.message).toContain("Unsupported command");
		expect(result.steps).toHaveLength(1);
	});
});

describe("format helpers", () => {
	test("formatActionShellLine quotes text and emits flags", () => {
		expect(
			formatActionShellLine({
				kind: "input",
				text: "it's fine",
				x: 10.6,
				y: 20.2,
			}),
		).toBe("yoqa action input --x 11 --y 20 --text 'it'\\''s fine'");
	});

	test("formatSleepShellLine and formatAssertShellLine", () => {
		expect(formatSleepShellLine(1.25)).toBe("sleep 1.25");
		expect(formatAssertShellLine({ assertion: "not-visible", text: " Error " })).toBe(
			"yoqa assert not-visible --text 'Error'",
		);
		expect(formatAssertShellLine({ assertion: "visible", text: "OK", timeoutSeconds: 8 })).toBe(
			"yoqa assert visible --text 'OK' --timeout 8",
		);
		expect(formatScreenshotShellLine()).toBe("yoqa screenshot");
		expect(formatScreenshotShellLine("/tmp/a.png")).toBe("yoqa screenshot '/tmp/a.png'");
	});
});

describe("element helpers", () => {
	test("screenHasText matches label or type", () => {
		expect(screenHasText([button], "bonus")).toBe(true);
		expect(screenHasText([button], "button")).toBe(true);
		expect(screenHasText([button], "missing")).toBe(false);
		expect(screenHasText(undefined, "bonus")).toBe(false);
	});

	test("findElementByLabel prefers exact then smallest box", () => {
		expect(findElementByLabel([button, smallerButton], "Get Bonus")).toEqual(smallerButton);
		expect(findElementByLabel([button], "Bonus")?.id).toBe("com.app:id/get_bonus");
		expect(findElementByLabel([button], "")).toBeNull();
	});

	test("findElementById supports suffix matching", () => {
		expect(findElementById([button], "com.app:id/get_bonus")).toEqual(button);
		expect(findElementById([button], "get_bonus")).toEqual(button);
		expect(findElementById([button], "other")).toBeNull();
	});

	test("elementCenterNorm", () => {
		expect(elementCenterNorm(button)).toEqual({ x: 200, y: 240 });
	});
});

describe("shellToCaseScript", () => {
	test("converts tap/input/sleep and skips assert with warning", () => {
		const result = shellToCaseScript(
			`
yoqa action tap --x 100 --y 200
yoqa action input --text 'hello'
sleep 2
yoqa assert visible --text 'Done'
sleep 15
`,
			{ savedAt: 1_700_000_000_000 },
		);

		expect(result.errors).toEqual([]);
		expect(result.script).toEqual({
			version: 1,
			savedAt: 1_700_000_000_000,
			actions: [
				{ type: "tap", x: 100, y: 200 },
				{ type: "type", text: "hello" },
				{ type: "wait", ms: 2000 },
				{ type: "wait", ms: 10_000 },
			],
		});
		expect(result.warnings.some((w) => w.includes("assert not supported"))).toBe(true);
		expect(result.warnings.some((w) => w.includes("clamped to 10s"))).toBe(true);
	});

	test("resolves tap by id against live elements", () => {
		const result = shellToCaseScript("yoqa action tap --id get_bonus", {
			elements: [button],
			savedAt: 42,
		});
		expect(result.script?.actions).toEqual([{ type: "tap", x: 200, y: 240 }]);
	});

	test("returns null script when nothing convertible remains", () => {
		const result = shellToCaseScript(`yoqa assert visible --text 'Nope'`);
		expect(result.script).toBeNull();
		expect(result.warnings.length).toBeGreaterThan(0);
	});

	test("skips screenshot steps when converting to CaseScript", () => {
		const result = shellToCaseScript(`
yoqa screenshot
yoqa action tap --x 10 --y 20
yoqa screenshot '/tmp/x.png'
`);
		expect(result.script?.actions).toEqual([{ type: "tap", x: 10, y: 20 }]);
		expect(result.warnings.filter((w) => w.includes("screenshot")).length).toBe(2);
	});

	test("tap with id and x/y converts without a live element tree", () => {
		const result = shellToCaseScript("yoqa action tap --id Note --x 120 --y 340", {
			elements: [],
			savedAt: 7,
		});
		expect(result.errors).toEqual([]);
		expect(result.script?.actions).toEqual([{ type: "tap", x: 120, y: 340 }]);
		expect(result.warnings).toEqual([]);
	});

	test("tap with id only cannot convert when the element is gone from the tree", () => {
		const result = shellToCaseScript("yoqa action tap --id Note", { elements: [] });
		expect(result.script).toBeNull();
		expect(result.warnings.some((w) => w.includes("tap needs"))).toBe(true);
	});

	test("inspector-style tap lines with id and coordinates convert for Save as test case", () => {
		const line = formatActionShellLine({
			kind: "tap",
			id: "Note",
			label: "All iCloud",
			x: 180,
			y: 420,
		});
		const result = shellToCaseScript(line, { elements: [], savedAt: 99 });
		expect(line).toContain("--id");
		expect(line).toContain("--x");
		expect(line).toContain("--y");
		expect(result.script?.actions).toEqual([{ type: "tap", x: 180, y: 420 }]);
	});
});
