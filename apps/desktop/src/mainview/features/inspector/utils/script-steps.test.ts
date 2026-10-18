import { describe, expect, test } from "bun:test";
import { buildScriptStepsView, runProgress } from "./script-steps";

const script = [
	"version: 1",
	"name: Discover",
	"actions:",
	"  # Open Discover",
	"  - tap: { label: Discover, x: 100, y: 925 }",
	"  # Check",
	"  - assert: Profile",
	"  - wait: 2000",
].join("\n");

describe("buildScriptStepsView", () => {
	test("reads actions into steps and keeps mid-script comments as groups", () => {
		const view = buildScriptStepsView(script, null, false);
		expect(view.steps.map((step) => step.verb)).toEqual(["Tap", "Assert", "Wait"]);
		expect(view.steps[0]).toMatchObject({
			lineNumber: 5,
			text: "“Discover”",
			meta: "100, 925",
			status: "idle",
		});
		expect(view.steps[1]?.text).toBe("“Profile” is visible");
		expect(view.steps[2]?.text).toBe("2 s");
		expect(view.groups).toEqual([{ beforeLineNumber: 6, text: "Check" }]);
	});

	test("shows a key with its modifiers", () => {
		const view = buildScriptStepsView(
			"version: 1\nactions:\n  - key: { key: Tab, modifiers: [Shift] }\n",
			null,
			false,
		);
		expect(view.steps[0]).toMatchObject({ verb: "Press", text: "Shift+Tab" });
	});

	test("comments before the first step are not groups", () => {
		const view = buildScriptStepsView(script, null, false);
		expect(view.groups.some((group) => group.text === "Open Discover")).toBe(false);
	});

	test("splits steps around the active line while running", () => {
		const view = buildScriptStepsView(script, 7, true);
		expect(view.steps.map((step) => step.status)).toEqual(["passed", "running", "queued"]);
		expect(runProgress(view)).toEqual({ total: 3, passed: 1, currentIndex: 2 });
	});

	test("ignores the active line once the run is over", () => {
		const view = buildScriptStepsView(script, 7, false);
		expect(view.steps.every((step) => step.status === "idle")).toBe(true);
	});

	test("an empty Case Script file has no steps and no errors", () => {
		const view = buildScriptStepsView("version: 1\nactions:\n", null, false);
		expect(view).toEqual({ groups: [], steps: [], errors: [] });
	});

	test("reports invalid actions with their line", () => {
		const view = buildScriptStepsView("version: 1\nactions:\n  - tapp: Home\n", null, false);
		expect(view.steps).toEqual([]);
		expect(view.errors[0]?.lineNumber).toBe(3);
		expect(view.errors[0]?.message).toStartWith("action 1: unknown action");
	});

	test("shows a Branch as one row", () => {
		const view = buildScriptStepsView(
			[
				"version: 1",
				"actions:",
				"  - if:",
				"      text: Allow notifications",
				"      then:",
				"        - tap: Allow",
				"      else:",
				"        - wait: 500",
				"        - tap: Skip",
				"  - tap: Home",
			].join("\n"),
			null,
			false,
		);
		expect(view.steps.map((step) => [step.lineNumber, step.verb, step.text, step.meta])).toEqual([
			[3, "If", "“Allow notifications” visible", "→ 1 step, else 2 steps"],
			[10, "Tap", "“Home”", ""],
		]);
	});

	test("names where an error sits inside a Branch", () => {
		const view = buildScriptStepsView(
			"version: 1\nactions:\n  - if:\n      text: A\n      then:\n        - tapp: Home\n",
			null,
			false,
		);
		expect(view.errors[0]?.lineNumber).toBe(6);
		expect(view.errors[0]?.message).toStartWith("action 1 → then → action 1: unknown action");
	});
});
