import { describe, expect, test } from "bun:test";
import { pathWithHostTools, prependPathEntries } from "./host-path";

describe("pathWithHostTools", () => {
	test("prepends Homebrew and local bins onto a GUI-like PATH", () => {
		const next = pathWithHostTools("/usr/bin:/bin:/usr/sbin:/sbin", "/Users/demo", "darwin");
		expect(next.split(":")).toEqual([
			"/opt/homebrew/bin",
			"/opt/homebrew/sbin",
			"/usr/local/bin",
			"/Users/demo/.local/bin",
			"/Users/demo/.bun/bin",
			"/Users/demo/.opencode/bin",
			"/Users/demo/.grok/bin",
			"/Users/demo/.antigravity/antigravity/bin",
			"/usr/bin",
			"/bin",
			"/usr/sbin",
			"/sbin",
		]);
	});

	test("does not duplicate dirs already on PATH", () => {
		const next = pathWithHostTools("/opt/homebrew/bin:/usr/bin:/bin", "/Users/demo", "darwin");
		const parts = next.split(":");
		expect(parts.filter((p) => p === "/opt/homebrew/bin")).toHaveLength(1);
		expect(parts).toContain("/opt/homebrew/bin");
		expect(parts.indexOf("/opt/homebrew/bin")).toBeLessThan(parts.indexOf("/usr/bin"));
	});
});

describe("pathWithHostTools on Windows", () => {
	test("keeps the Windows PATH intact with `;` and skips Homebrew dirs", () => {
		const current = String.raw`C:\Windows\system32;C:\Windows;C:\Android\sdk\platform-tools`;
		const next = pathWithHostTools(current, String.raw`C:\Users\demo`, "win32");
		expect(next.split(";")).toEqual([
			String.raw`C:\Users\demo\.local\bin`,
			String.raw`C:\Users\demo\.bun\bin`,
			String.raw`C:\Users\demo\.opencode\bin`,
			String.raw`C:\Users\demo\.grok\bin`,
			String.raw`C:\Users\demo\.antigravity\antigravity\bin`,
			String.raw`C:\Windows\system32`,
			String.raw`C:\Windows`,
			String.raw`C:\Android\sdk\platform-tools`,
		]);
	});
});

describe("prependPathEntries", () => {
	test("uses the platform delimiter and skips existing entries", () => {
		expect(prependPathEntries("/a:/b", ["/b", "/c"], "linux")).toBe("/c:/a:/b");
		expect(prependPathEntries("C:/a;C:/b", ["C:/b", "C:/c"], "win32")).toBe("C:/c;C:/a;C:/b");
	});
});
