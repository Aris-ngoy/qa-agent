import { describe, expect, test } from "bun:test";
import { pathWithHostTools } from "./host-path";

describe("pathWithHostTools", () => {
	test("prepends Homebrew and local bins onto a GUI-like PATH", () => {
		const next = pathWithHostTools("/usr/bin:/bin:/usr/sbin:/sbin", "/Users/demo");
		expect(next.split(":")).toEqual([
			"/opt/homebrew/bin",
			"/opt/homebrew/sbin",
			"/usr/local/bin",
			"/Users/demo/.local/bin",
			"/Users/demo/.bun/bin",
			"/usr/bin",
			"/bin",
			"/usr/sbin",
			"/sbin",
		]);
	});

	test("does not duplicate dirs already on PATH", () => {
		const next = pathWithHostTools("/opt/homebrew/bin:/usr/bin:/bin", "/Users/demo");
		const parts = next.split(":");
		expect(parts.filter((p) => p === "/opt/homebrew/bin")).toHaveLength(1);
		expect(parts).toContain("/opt/homebrew/bin");
		expect(parts.indexOf("/opt/homebrew/bin")).toBeLessThan(parts.indexOf("/usr/bin"));
	});
});
