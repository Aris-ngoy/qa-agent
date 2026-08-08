import { describe, expect, test } from "bun:test";
import {
	listOpenCodeModelsFromCli,
	openCodeServerAuthHeaders,
	stripOpenCodeModelSlug,
} from "./opencode";

describe("stripOpenCodeModelSlug", () => {
	test("strips provider prefix", () => {
		expect(stripOpenCodeModelSlug("opencode/deepseek-v4-flash-free")).toBe(
			"deepseek-v4-flash-free",
		);
	});

	test("leaves bare ids alone", () => {
		expect(stripOpenCodeModelSlug("big-pickle")).toBe("big-pickle");
	});
});

describe("openCodeServerAuthHeaders", () => {
	test("uses Basic opencode:password like t3code", () => {
		const headers = openCodeServerAuthHeaders("secret");
		expect(headers.Authorization).toBe(
			`Basic ${Buffer.from("opencode:secret").toString("base64")}`,
		);
	});

	test("omits header when password empty", () => {
		expect(openCodeServerAuthHeaders("")).toEqual({});
		expect(openCodeServerAuthHeaders(null)).toEqual({});
	});
});

describe("listOpenCodeModelsFromCli", () => {
	test("lists models when opencode is installed", async () => {
		const result = await listOpenCodeModelsFromCli(null);
		if (result.models.length === 0) {
			// Environment without CLI — skip asserting catalog size.
			expect(result.detail.length).toBeGreaterThan(0);
			return;
		}
		expect(result.models.some((m) => m.id === "deepseek-v4-flash-free")).toBe(true);
		expect(result.models.every((m) => !m.id.includes("/"))).toBe(true);
	});
});
