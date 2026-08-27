import { describe, expect, test } from "bun:test";
import { caseScriptActionSchema, caseScriptSchema } from "./schemas";

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
	});

	test("rejects out-of-range coordinates and waits", () => {
		expect(caseScriptActionSchema.safeParse({ type: "tap", x: -1, y: 0 }).success).toBe(false);
		expect(caseScriptActionSchema.safeParse({ type: "tap", x: 0, y: 1001 }).success).toBe(false);
		expect(caseScriptActionSchema.safeParse({ type: "wait", ms: 10_001 }).success).toBe(false);
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
