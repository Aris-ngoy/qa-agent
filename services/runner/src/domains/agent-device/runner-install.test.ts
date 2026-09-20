import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_YOQA_RUNNER_BUNDLE_ID,
	YOQA_RUNNER_DISPLAY_NAME,
	loadRunnerPrep,
	prepMatches,
	readAppBundleId,
} from "./runner-install";

describe("YoqaADRunner branding", () => {
	test("uses the YoqaADRunner display name", () => {
		expect(YOQA_RUNNER_DISPLAY_NAME).toBe("YoqaADRunner");
	});

	test("falls back to the yoqa runner bundle id", () => {
		expect(DEFAULT_YOQA_RUNNER_BUNDLE_ID).toBe("com.yoqa.agentdevice.runner");
	});
});

describe("loadRunnerPrep", () => {
	test("returns null when no prep was recorded", async () => {
		await expect(loadRunnerPrep("definitely-not-a-device-12345")).resolves.toBeNull();
	});
});

describe("prepMatches", () => {
	const base = {
		deviceId: "device-1",
		platform: "ios" as const,
		bundleId: "com.yoqa.agentdevice.runner",
		teamId: "TEAM1234567",
		appPath: "/tmp/AgentDeviceRunner.app",
		derivedDataPath: null,
		branded: true,
		installedAt: new Date().toISOString(),
	};

	test("matches identical signing", () => {
		expect(prepMatches(base, "TEAM1234567", "com.yoqa.agentdevice.runner")).toBe(true);
	});

	test("rejects team or bundle mismatch", () => {
		expect(prepMatches(base, "OTHERTEAM99", "com.yoqa.agentdevice.runner")).toBe(false);
		expect(prepMatches(base, "TEAM1234567", "com.other.bundle")).toBe(false);
	});

	test("never crashes on legacy records without a team id", () => {
		const legacy = { ...base, teamId: undefined as unknown as string };
		expect(() => prepMatches(legacy, "TEAM1234567", "com.yoqa.agentdevice.runner")).not.toThrow();
		expect(prepMatches(legacy, "TEAM1234567", "com.yoqa.agentdevice.runner")).toBe(false);
	});
});

describe("readAppBundleId", () => {
	let dirs: string[] = [];
	afterEach(async () => {
		await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
		dirs = [];
	});

	test("reads the built bundle id (not the expected one)", async () => {
		const dir = await mkdtemp(join(tmpdir(), "yoqa-runner-bid-"));
		dirs.push(dir);
		const appPath = join(dir, "AgentDeviceRunner.app");
		await Bun.spawn(["mkdir", "-p", appPath]).exited;
		await writeFile(
			join(appPath, "Info.plist"),
			'<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.arisngoy.agentdevice.runner</string></dict></plist>',
			"utf8",
		);
		await expect(readAppBundleId(appPath)).resolves.toBe("com.arisngoy.agentdevice.runner");
	});

	test("returns null when the plist is missing", async () => {
		await expect(readAppBundleId("/definitely/not/an-app")).resolves.toBeNull();
	});
});
