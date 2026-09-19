import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	readDesktopIosSigning,
	resetDesktopIosSigningCacheForTests,
	withDesktopIosSigningEnv,
} from "./desktop-settings";

let dir = "";

beforeEach(async () => {
	resetDesktopIosSigningCacheForTests();
	dir = await mkdtemp(join(tmpdir(), "yoqa-desktop-settings-"));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

async function writeSettings(body: unknown): Promise<string> {
	const file = join(dir, "settings.json");
	await writeFile(file, JSON.stringify(body));
	return file;
}

describe("readDesktopIosSigning", () => {
	test("returns team and bundle from desktop settings", async () => {
		const file = await writeSettings({
			ios: { teamId: "26Z9S479TB", agentDeviceBundleId: "com.justdice.agentdevice.runner" },
		});
		await expect(readDesktopIosSigning(file)).resolves.toEqual({
			teamId: "26Z9S479TB",
			bundleId: "com.justdice.agentdevice.runner",
		});
	});

	test("returns {} when the file is missing or invalid", async () => {
		await expect(readDesktopIosSigning(join(dir, "missing.json"))).resolves.toEqual({});
		const bad = await writeSettings({ ios: "nope" });
		await expect(readDesktopIosSigning(bad)).resolves.toEqual({});
	});
});

describe("withDesktopIosSigningEnv", () => {
	test("fills unset keys from desktop settings", async () => {
		const file = await writeSettings({
			ios: { teamId: "26Z9S479TB", agentDeviceBundleId: "com.justdice.agentdevice.runner" },
		});
		const env = await withDesktopIosSigningEnv({}, file);
		expect(env.AGENT_DEVICE_IOS_TEAM_ID).toBe("26Z9S479TB");
		expect(env.AGENT_DEVICE_IOS_BUNDLE_ID).toBe("com.justdice.agentdevice.runner");
	});

	test("never overrides explicit env", async () => {
		const file = await writeSettings({
			ios: { teamId: "26Z9S479TB", agentDeviceBundleId: "com.justdice.agentdevice.runner" },
		});
		const env = await withDesktopIosSigningEnv(
			{
				AGENT_DEVICE_IOS_TEAM_ID: "Y2D96HYLU2",
				AGENT_DEVICE_IOS_BUNDLE_ID: "com.example.runner",
			},
			file,
		);
		expect(env.AGENT_DEVICE_IOS_TEAM_ID).toBe("Y2D96HYLU2");
		expect(env.AGENT_DEVICE_IOS_BUNDLE_ID).toBe("com.example.runner");
	});
});
