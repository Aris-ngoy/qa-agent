import { describe, expect, test } from "bun:test";
import { encodeRgbaPng } from "../runs/coord-grid";
import { settleScreen } from "./action-result";
import type { AdbExec, AdbResult } from "./android-direct-lane";
import { createAndroidDirectSession } from "./android-direct-lane";
import type { SessionOptions } from "./lane";

function ok(stdout = "", stdoutBytes?: Uint8Array): AdbResult {
	return { stdout, stderr: "", exitCode: 0, stdoutBytes };
}

function tinyPng(): Uint8Array {
	const rgba = new Uint8Array([0, 0, 0, 255]);
	return new Uint8Array(encodeRgbaPng({ width: 1, height: 1, rgba }));
}

function options(overrides: Partial<SessionOptions> = {}): SessionOptions {
	return {
		platform: "android",
		deviceId: "emulator-5554",
		appCaps: [],
		caseCaps: [],
		...overrides,
	};
}

function recordingAdb(): { adb: AdbExec; calls: string[][] } {
	const calls: string[][] = [];
	const png = tinyPng();
	const dump = `<?xml version="1.0"?><hierarchy><node bounds="[100,200][300,280]" resource-id="com.android.permissioncontroller:id/permission_allow_button" text="Allow" /></hierarchy>`;
	const adb: AdbExec = async (args) => {
		calls.push(args);
		const joined = args.join(" ");
		if (joined.includes("get-state")) return ok("device\n");
		if (joined.includes("wm size")) return ok("Physical size: 1000x2000\n");
		if (joined.includes("screencap")) return ok("", png);
		if (joined.includes("uiautomator dump"))
			return ok("UI hierchary dumped to: /sdcard/yoqa-window.xml\n");
		if (joined.includes("cat") && joined.includes("yoqa-window.xml")) return ok(`${dump}\n`);
		return ok();
	};
	return { adb, calls };
}

describe("createAndroidDirectSession", () => {
	test("rejects iOS so connect can fall back to Appium", async () => {
		await expect(
			createAndroidDirectSession(options({ platform: "ios" }), {
				adb: async () => ok(),
				resolveSerial: async () => "x",
			}),
		).rejects.toThrow(/Android only/);
	});

	test("connects over adb and names the Direct lane", async () => {
		const { adb } = recordingAdb();
		const session = await createAndroidDirectSession(options(), {
			adb,
			resolveSerial: async () => "emulator-5554",
		});
		expect(session.lane).toBe("direct");
		expect(session.stream).toBeNull();
		await session.quit();
	});

	test("refuses to start when the device is not online", async () => {
		const adb: AdbExec = async (args) => {
			if (args.includes("get-state")) return ok("offline\n");
			return ok();
		};
		await expect(
			createAndroidDirectSession(options(), { adb, resolveSerial: async () => "emulator-5554" }),
		).rejects.toThrow(/offline/);
	});

	test("tap and type go through input, lifecycle through am/monkey", async () => {
		const { adb, calls } = recordingAdb();
		const session = await createAndroidDirectSession(options({ appPackage: "com.demo" }), {
			adb,
			resolveSerial: async () => "emulator-5554",
		});
		await session.tap(500, 500);
		await session.swipe(100, 100, 200, 400);
		await session.drag(100, 100, 300, 300);
		await session.type("hi there");
		await session.activateApp("com.demo");
		await session.terminateApp("com.demo");
		await session.openUrl("https://yoqa.arisn.dev");
		expect(calls.some((c) => c.includes("input") && c.includes("tap"))).toBe(true);
		expect(calls.some((c) => c.includes("input") && c.includes("swipe"))).toBe(true);
		expect(
			calls.some((c) => c.includes("input") && c.includes("text") && c.includes("hi%sthere")),
		).toBe(true);
		expect(calls.some((c) => c.includes("monkey") && c.includes("com.demo"))).toBe(true);
		expect(calls.some((c) => c.includes("force-stop"))).toBe(true);
		expect(calls.some((c) => c.includes("android.intent.action.VIEW"))).toBe(true);
		await session.quit();
	});

	test("a new target app is the one backgrounding resumes, and setting it launches nothing", async () => {
		const { adb, calls } = recordingAdb();
		const session = await createAndroidDirectSession(options({ appPackage: "com.app.a" }), {
			adb,
			resolveSerial: async () => "emulator-5554",
		});
		session.setTargetApp("com.app.b");
		expect(calls.some((c) => c.includes("monkey"))).toBe(false);
		await session.backgroundApp(0);
		const launches = calls.filter((c) => c.includes("monkey"));
		expect(launches).toHaveLength(1);
		expect(launches[0]).toContain("com.app.b");
		await session.quit();
	});

	test("acceptAlert taps the Allow node from the dump", async () => {
		const { adb, calls } = recordingAdb();
		const session = await createAndroidDirectSession(options(), {
			adb,
			resolveSerial: async () => "emulator-5554",
		});
		await session.acceptAlert();
		expect(calls.some((c) => c.includes("input") && c.includes("tap") && c.includes("200"))).toBe(
			true,
		);
		await session.quit();
	});

	test("pageSource returns the uiautomator XML without the dump banner", async () => {
		const { adb } = recordingAdb();
		const session = await createAndroidDirectSession(options(), {
			adb,
			resolveSerial: async () => "emulator-5554",
		});
		const xml = await session.pageSource();
		expect(xml).toContain("<hierarchy");
		expect(xml).not.toContain("UI hierchary");
		await session.quit();
	});

	test("adaptive Settle uses the Direct screencap frame", async () => {
		const { adb } = recordingAdb();
		const session = await createAndroidDirectSession(options(), {
			adb,
			resolveSerial: async () => "emulator-5554",
		});
		const result = await settleScreen(() => session.captureFrame(), {
			capMs: 400,
			pollMs: 20,
			stableWindowMs: 40,
		});
		expect(result.settled).toBe(true);
		expect(result.base64.length).toBeGreaterThan(0);
		await session.quit();
	});

	test("pageSource fails clearly when the dump has no XML", async () => {
		const adb: AdbExec = async (args) => {
			const joined = args.join(" ");
			if (joined.includes("get-state")) return ok("device\n");
			if (joined.includes("wm size")) return ok("Physical size: 1000x2000\n");
			if (joined.includes("uiautomator dump")) return ok("ERROR: null root node\n");
			if (joined.includes("cat") && joined.includes("yoqa-window.xml"))
				return ok("ERROR: null root node\n");
			return ok();
		};
		const session = await createAndroidDirectSession(options(), {
			adb,
			resolveSerial: async () => "emulator-5554",
		});
		await expect(session.pageSource()).rejects.toThrow(/no tree/);
		await session.quit();
	});
});
