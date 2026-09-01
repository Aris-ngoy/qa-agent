import { describe, expect, test } from "bun:test";
import { caseScriptActionSchema, caseScriptSchema, runStepSchema, runTestSchema } from "./schemas";

describe("caseScriptActionSchema", () => {
	test("accepts tap/type/wait in range", () => {
		expect(caseScriptActionSchema.parse({ type: "tap", x: 0, y: 1000 })).toMatchObject({
			type: "tap",
			x: 0,
			y: 1000,
		});
		expect(caseScriptActionSchema.parse({ type: "type", text: "hi" })).toMatchObject({
			type: "type",
			text: "hi",
		});
		expect(caseScriptActionSchema.parse({ type: "wait", ms: 10_000 })).toMatchObject({
			type: "wait",
			ms: 10_000,
		});
		expect(caseScriptActionSchema.parse({ type: "alert" })).toMatchObject({
			type: "alert",
			alertAction: "accept",
		});
		expect(caseScriptActionSchema.parse({ type: "alert", alertAction: "dismiss" })).toMatchObject({
			type: "alert",
			alertAction: "dismiss",
		});
		expect(
			caseScriptActionSchema.parse({ type: "swipe", x: 500, y: 800, x2: 500, y2: 200 }),
		).toMatchObject({
			type: "swipe",
			x: 500,
			y: 800,
			x2: 500,
			y2: 200,
		});
		expect(
			caseScriptActionSchema.parse({
				type: "drag",
				x: 10,
				y: 20,
				x2: 30,
				y2: 40,
			}),
		).toMatchObject({ type: "drag", x: 10, y: 20, x2: 30, y2: 40 });
		expect(
			caseScriptActionSchema.parse({ type: "restart-app", appId: "com.example.app" }),
		).toMatchObject({ type: "restart-app", appId: "com.example.app" });
	});

	test("rejects out-of-range coordinates and waits", () => {
		expect(caseScriptActionSchema.safeParse({ type: "tap", x: -1, y: 0 }).success).toBe(false);
		expect(caseScriptActionSchema.safeParse({ type: "tap", x: 0, y: 1001 }).success).toBe(false);
		expect(caseScriptActionSchema.safeParse({ type: "wait", ms: 10_001 }).success).toBe(false);
		expect(
			caseScriptActionSchema.safeParse({ type: "swipe", x: 0, y: 0, x2: 0, y2: 1001 }).success,
		).toBe(false);
	});
});

describe("caseScriptSchema", () => {
	test("requires version 1 and at least one action", () => {
		const ok = caseScriptSchema.safeParse({
			version: 1,
			savedAt: 1,
			actions: [{ type: "tap", x: 10, y: 20 }],
		});
		expect(ok.success).toBe(true);

		expect(
			caseScriptSchema.safeParse({
				version: 2,
				savedAt: 1,
				actions: [{ type: "tap", x: 10, y: 20 }],
			}).success,
		).toBe(false);

		expect(
			caseScriptSchema.safeParse({
				version: 1,
				savedAt: 1,
				actions: [],
			}).success,
		).toBe(false);
	});
});

describe("runStepSchema", () => {
	const baseStep = {
		id: "rstep_1",
		runTestId: "rtest_1",
		idx: 0,
		action: { type: "tap" },
		screenshotUri: null,
		ok: true,
		latencyMs: 12,
		detail: null,
		createdAt: 1,
	};

	test("parses payloads without command", () => {
		expect(runStepSchema.parse(baseStep).command).toBeUndefined();
	});

	test("parses null and string command", () => {
		expect(runStepSchema.parse({ ...baseStep, command: null }).command).toBeNull();
		expect(
			runStepSchema.parse({ ...baseStep, command: "yoqa action tap --label 'Allow'" }).command,
		).toBe("yoqa action tap --label 'Allow'");
	});
});

describe("runTestSchema", () => {
	const baseTest = {
		id: "rtest_1",
		runId: "run_1",
		caseId: "case_1",
		status: "running" as const,
		error: null,
		startedAt: 1,
		finishedAt: null,
	};

	test("parses payloads without currentCommand", () => {
		expect(runTestSchema.parse(baseTest).currentCommand).toBeUndefined();
	});

	test("parses null and string currentCommand", () => {
		expect(runTestSchema.parse({ ...baseTest, currentCommand: null }).currentCommand).toBeNull();
		expect(
			runTestSchema.parse({
				...baseTest,
				currentCommand: "yoqa action tap --x 50 --y 60",
			}).currentCommand,
		).toBe("yoqa action tap --x 50 --y 60");
	});
});
