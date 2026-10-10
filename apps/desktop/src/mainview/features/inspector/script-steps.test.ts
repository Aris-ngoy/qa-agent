import { describe, expect, test } from "bun:test";
import { buildScriptStepsView, runProgress } from "./script-steps";

const script = [
	"#!/usr/bin/env bash",
	"# Yoqa inspector script",
	"set -euo pipefail",
	"",
	"# Discover",
	"yoqa action tap --label 'Discover' --x 100 --y 925",
	"yoqa assert visible --text 'Profile'",
	"sleep 2",
].join("\n");

describe("buildScriptStepsView", () => {
	test("parses runnable lines into steps and keeps mid-script comments as groups", () => {
		const view = buildScriptStepsView(script, null, false);
		expect(view.steps.map((step) => step.verb)).toEqual(["Tap", "Assert", "Wait"]);
		expect(view.steps[0]).toMatchObject({ text: "“Discover”", meta: "100, 925", status: "idle" });
		expect(view.steps[1]?.text).toBe("“Profile” is visible");
	});

	test("header comments before the first step are not groups", () => {
		const view = buildScriptStepsView(script, null, false);
		expect(view.groups).toEqual([]);
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

	test("reports unparseable lines", () => {
		const view = buildScriptStepsView("rm -rf /", null, false);
		expect(view.errors).toHaveLength(1);
	});
});
