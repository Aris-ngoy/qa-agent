import { describe, expect, test } from "bun:test";
import { ArgentError, isSupportedArgentVersion } from "./cli";

describe("isSupportedArgentVersion", () => {
	test("accepts minimum and newer", () => {
		expect(isSupportedArgentVersion("0.25.0")).toBe(true);
		expect(isSupportedArgentVersion("0.25.2")).toBe(true);
		expect(isSupportedArgentVersion("1.0.0")).toBe(true);
		expect(isSupportedArgentVersion("argent 0.26.1")).toBe(true);
	});

	test("rejects older and unparsable", () => {
		expect(isSupportedArgentVersion("0.24.9")).toBe(false);
		expect(isSupportedArgentVersion("0.21.6")).toBe(false);
		expect(isSupportedArgentVersion("not-a-version")).toBe(false);
	});
});

describe("ArgentError", () => {
	test("carries code and hint", () => {
		const error = new ArgentError("nope", "TOOL_MISSING", "install it");
		expect(error.code).toBe("TOOL_MISSING");
		expect(error.hint).toBe("install it");
		expect(error.name).toBe("ArgentError");
	});
});
