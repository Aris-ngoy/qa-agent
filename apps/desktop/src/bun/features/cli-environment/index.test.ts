import { describe, expect, test } from "bun:test";
import { shouldUseRepoCliSource } from "./index";

describe("shouldUseRepoCliSource", () => {
	test("prefers repo source during electrobun dev", () => {
		expect(shouldUseRepoCliSource(false, true)).toBe(true);
	});

	test("uses the packaged binary when YOQA_CLI_SOURCE=packaged", () => {
		expect(shouldUseRepoCliSource(true, true)).toBe(false);
	});

	test("uses the packaged binary when no repo checkout is present", () => {
		expect(shouldUseRepoCliSource(false, false)).toBe(false);
	});
});
