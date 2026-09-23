import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { resetRunArgentToolForTests, setRunArgentToolForTests } from "../argent/cli";
import { installBuildOnDevice } from "./application";

let toolCalls: Array<{ tool: string; args: string[] }> = [];

afterAll(() => {
	resetRunArgentToolForTests();
});

const BUILD = {
	id: "build_1",
	appId: "app_1",
	path: "./build/MyApp.app",
	platform: "ios" as const,
	name: "MyApp.app",
	bundleId: null,
	version: null,
	createdAt: 1,
};

beforeEach(() => {
	toolCalls = [];
	setRunArgentToolForTests(async (toolName: string, args: string[] = []) => {
		toolCalls.push({ tool: toolName, args: [...args] });
		return { ok: true };
	});
});

describe("installBuildOnDevice", () => {
	test("installs via argent reinstall-app with udid, bundleId, and appPath", async () => {
		await installBuildOnDevice({
			build: BUILD,
			deviceId: "sim-1",
			platform: "ios",
			bundleId: "com.example.app",
		});
		expect(toolCalls).toEqual([
			{
				tool: "reinstall-app",
				args: [
					"--udid",
					"sim-1",
					"--bundleId",
					"com.example.app",
					"--appPath",
					"./build/MyApp.app",
				],
			},
		]);
	});

	test("falls back to the build record bundleId", async () => {
		await installBuildOnDevice({
			build: { ...BUILD, bundleId: "com.example.record" },
			deviceId: "sim-1",
			platform: "ios",
		});
		expect(toolCalls[0]?.args).toContain("com.example.record");
	});

	test("throws an actionable error when no bundle id is known", async () => {
		await expect(
			installBuildOnDevice({ build: BUILD, deviceId: "sim-1", platform: "ios" }),
		).rejects.toThrow(/no bundle id is known/i);
		expect(toolCalls).toHaveLength(0);
	});
});
