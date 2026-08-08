import { describe, expect, test } from "bun:test";
import { formatProviderHttpError, looksLikeHtmlResponse } from "../vision-model";
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

describe("OpenCode HTML error formatting", () => {
	test("detects SPA HTML bodies", () => {
		expect(
			looksLikeHtmlResponse(
				'<!doctype html> <html lang="en" style="background-color: var(--v2-background-bg-deep, #fafafa)">',
			),
		).toBe(true);
	});

	test("maps HTML 200 to Zen key guidance", () => {
		const message = formatProviderHttpError(
			"OpenCode",
			200,
			'<!doctype html> <html lang="en"><title>OpenCode</title>',
		);
		expect(message).toContain("Zen API key");
		expect(message).not.toContain("<!doctype");
	});

	test("maps text-only image_url 400 to vision model guidance", () => {
		const message = formatProviderHttpError(
			"OpenCode",
			400,
			'{"error":{"message":"unknown variant `image_url`, expected `text`"}}',
		);
		expect(message).toContain("mimo-v2.5-free");
		expect(message).toContain("text-only");
	});
});
