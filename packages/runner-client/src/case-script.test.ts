import { describe, expect, test } from "bun:test";
import { caseScriptSchema } from "./schemas";

describe("caseScriptSchema", () => {
	test("accepts coordinate taps", () => {
		const parsed = caseScriptSchema.parse({
			version: 1,
			savedAt: 1,
			actions: [{ type: "tap", x: 10, y: 20 }],
		});
		expect(parsed.actions[0]).toEqual({ type: "tap", x: 10, y: 20 });
	});

	test("accepts label taps and asserts", () => {
		const parsed = caseScriptSchema.parse({
			version: 1,
			savedAt: 1,
			actions: [
				{ type: "assert", text: "Home" },
				{ type: "tap", label: "Increment" },
			],
		});
		expect(parsed.actions).toEqual([
			{ type: "assert", assertion: "visible", text: "Home" },
			{ type: "tap", label: "Increment" },
		]);
	});

	test("rejects taps with no target", () => {
		const result = caseScriptSchema.safeParse({
			version: 1,
			savedAt: 1,
			actions: [{ type: "tap" }],
		});
		expect(result.success).toBe(false);
	});
});
