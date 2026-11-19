import { describe, expect, test } from "bun:test";
import { type ReleaseBuild, collectReleaseFiles, releaseBuildFor } from "./release-artifacts";

describe("releaseBuildFor", () => {
	test("a stable v* tag builds stable and requires the patch", () => {
		expect(releaseBuildFor("refs/tags/v1.0.9")).toEqual({
			channel: "stable",
			requirePatch: true,
			buildScript: "build:release",
		});
	});

	test("a prerelease v*-* tag builds canary and needs no patch", () => {
		expect(releaseBuildFor("refs/tags/v1.1.0-beta.1")).toEqual({
			channel: "canary",
			requirePatch: false,
			buildScript: "build:release:canary",
		});
	});

	test("pull-request and branch runs build stable without requiring the patch", () => {
		const stableBuild: ReleaseBuild = {
			channel: "stable",
			requirePatch: false,
			buildScript: "build:release",
		};
		expect(releaseBuildFor("refs/pull/12/merge")).toEqual(stableBuild);
		expect(releaseBuildFor("refs/heads/main")).toEqual(stableBuild);
	});
});

describe("collectReleaseFiles", () => {
	test("stable macOS: the DMG, archive, update.json and the patch from the previous release", () => {
		const result = collectReleaseFiles({
			channel: "stable",
			platform: "macos-arm64",
			requirePatch: true,
			artifacts: [
				"stable-macos-arm64-yoqa.dmg",
				"stable-macos-arm64-yoqa.app.tar.zst",
				"stable-macos-arm64-update.json",
				"stable-macos-arm64-9f2c1e.patch",
			],
		});
		expect(result).toEqual({
			ok: true,
			files: [
				"stable-macos-arm64-yoqa.dmg",
				"stable-macos-arm64-yoqa.app.tar.zst",
				"stable-macos-arm64-update.json",
				"stable-macos-arm64-9f2c1e.patch",
			],
			patch: "stable-macos-arm64-9f2c1e.patch",
			installer: "stable-macos-arm64-yoqa.dmg",
			launch: "yoqa.app",
			warnings: [],
		});
	});

	const stableMacFiles = [
		"stable-macos-arm64-yoqa.dmg",
		"stable-macos-arm64-yoqa.app.tar.zst",
		"stable-macos-arm64-update.json",
	];

	test("a stable tag build without the patch fails", () => {
		const result = collectReleaseFiles({
			channel: "stable",
			platform: "macos-arm64",
			requirePatch: true,
			artifacts: stableMacFiles,
		});
		expect(result.ok).toBe(false);
		expect(!result.ok && result.error).toContain("No stable-macos-arm64 patch");
	});

	test("a build-only run without the patch still uploads its files, with a warning", () => {
		const result = collectReleaseFiles({
			channel: "stable",
			platform: "macos-arm64",
			requirePatch: false,
			artifacts: stableMacFiles,
		});
		expect(result.ok && result.files).toEqual(stableMacFiles);
		expect(result.ok && result.patch).toBeNull();
		expect(result.ok && result.warnings).toHaveLength(1);
	});

	test("stable Windows: the Setup zip, archive, update.json and patch", () => {
		const result = collectReleaseFiles({
			channel: "stable",
			platform: "win-x64",
			requirePatch: true,
			artifacts: [
				"stable-win-x64-yoqa-Setup.zip",
				"stable-win-x64-yoqa.tar.zst",
				"stable-win-x64-update.json",
				"stable-win-x64-4a7b.patch",
			],
		});
		expect(result).toMatchObject({
			ok: true,
			files: [
				"stable-win-x64-yoqa-Setup.zip",
				"stable-win-x64-yoqa.tar.zst",
				"stable-win-x64-update.json",
				"stable-win-x64-4a7b.patch",
			],
			installer: "stable-win-x64-yoqa-Setup.zip",
			launch: "yoqa-Setup.exe",
		});
	});

	test("canary builds use the canary file names and need no patch", () => {
		const mac = collectReleaseFiles({
			channel: "canary",
			platform: "macos-arm64",
			requirePatch: false,
			artifacts: [
				"canary-macos-arm64-yoqa-canary.dmg",
				"canary-macos-arm64-yoqa-canary.app.tar.zst",
				"canary-macos-arm64-update.json",
			],
		});
		expect(mac).toEqual({
			ok: true,
			files: [
				"canary-macos-arm64-yoqa-canary.dmg",
				"canary-macos-arm64-yoqa-canary.app.tar.zst",
				"canary-macos-arm64-update.json",
			],
			patch: null,
			installer: "canary-macos-arm64-yoqa-canary.dmg",
			launch: "yoqa-canary.app",
			warnings: [],
		});

		const win = collectReleaseFiles({
			channel: "canary",
			platform: "win-x64",
			requirePatch: false,
			artifacts: [
				"canary-win-x64-yoqa-Setup-canary.zip",
				"canary-win-x64-yoqa-canary.tar.zst",
				"canary-win-x64-update.json",
			],
		});
		expect(win).toMatchObject({
			ok: true,
			installer: "canary-win-x64-yoqa-Setup-canary.zip",
			launch: "yoqa-Setup-canary.exe",
			warnings: [],
		});
	});

	test("a missing installer, archive or update.json always fails", () => {
		const result = collectReleaseFiles({
			channel: "stable",
			platform: "win-x64",
			requirePatch: false,
			artifacts: ["stable-win-x64-yoqa-Setup.zip", "stable-win-x64-update.json"],
		});
		expect(result).toEqual({
			ok: false,
			error: "Missing stable-win-x64 release files: stable-win-x64-yoqa.tar.zst",
		});
	});

	test("ignores the other platform's files", () => {
		const result = collectReleaseFiles({
			channel: "stable",
			platform: "macos-arm64",
			requirePatch: true,
			artifacts: [...stableMacFiles, "stable-macos-arm64-aa.patch", "stable-win-x64-bb.patch"],
		});
		expect(result.ok && result.patch).toBe("stable-macos-arm64-aa.patch");
	});
});
