import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import * as actualCli from "./cli";

let listDevicesPayload: unknown = { devices: [] };

// Stub the Argent backend so no `argent` binary is needed.
mock.module("./cli", () => ({
	...actualCli,
	runArgentTool: async (toolName: string, _args: string[] = []) => {
		if (toolName === "list-devices") return listDevicesPayload;
		return { ok: true };
	},
}));

const { listArgentDevices } = await import("./devices");

// `mock.module` leaks across test files on Bun versions with a global mock
// registry (CI pins 1.2.x) — restore this file's stubs when done so later
// files resolve real modules.
afterAll(() => {
	mock.restore();
});

beforeEach(() => {
	listDevicesPayload = { devices: [] };
});

describe("listArgentDevices", () => {
	test("maps iOS sims (udid, runtime OS, booted-first)", async () => {
		listDevicesPayload = {
			devices: [
				{
					platform: "ios",
					udid: "shut-1",
					name: "iPhone 17",
					state: "Shutdown",
					runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-2",
				},
				{
					platform: "ios",
					udid: "boot-1",
					name: "iPhone 17 Pro",
					state: "Booted",
					runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-2",
				},
			],
		};

		const devices = await listArgentDevices("ios");
		expect(devices.map((d) => d.id)).toEqual(["boot-1", "shut-1"]);
		expect(devices[0]).toMatchObject({
			name: "iPhone 17 Pro",
			osVersion: "iOS 26.2",
			platform: "ios",
			kind: "simulator",
			state: "Booted",
		});
	});

	test("maps physical iPhones (kind device, model, paired stays listed)", async () => {
		listDevicesPayload = {
			devices: [
				{
					platform: "ios",
					kind: "device",
					udid: "00008150-abc",
					name: "Aristote's iPhone",
					state: "paired",
					runtime: "iOS 26.2 (physical device)",
					model: "iPhone 17 Pro",
				},
			],
		};

		const devices = await listArgentDevices("ios");
		expect(devices).toHaveLength(1);
		expect(devices[0]).toMatchObject({
			id: "00008150-abc",
			kind: "physical",
			model: "iPhone 17 Pro",
		});
	});

	test("includeUnavailable=false drops shutdown/paired targets", async () => {
		listDevicesPayload = {
			devices: [
				{ platform: "ios", udid: "a", name: "Booted One", state: "Booted" },
				{ platform: "ios", udid: "b", name: "Shut One", state: "Shutdown" },
				{
					platform: "ios",
					kind: "device",
					udid: "c",
					name: "Paired Phone",
					state: "paired",
				},
			],
		};

		const devices = await listArgentDevices("ios", { includeUnavailable: false });
		expect(devices.map((d) => d.id)).toEqual(["a"]);
	});

	test("drops non-phone platforms and entries without id/name", async () => {
		listDevicesPayload = {
			devices: [
				{ platform: "chromium", id: "c1", name: "App", state: "running" },
				{ platform: "android", serial: "emulator-5554", name: "", state: "online" },
				{
					platform: "android",
					kind: "emulator",
					serial: "emulator-5554",
					name: "Pixel",
					state: "online",
				},
			],
		};

		const devices = await listArgentDevices("android");
		expect(devices).toHaveLength(1);
		expect(devices[0]).toMatchObject({
			id: "emulator-5554",
			kind: "emulator",
			platform: "android",
		});
	});
});
