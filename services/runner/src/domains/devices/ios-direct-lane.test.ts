import { describe, expect, test } from "bun:test";
import { encodeRgbaPng } from "../runs/coord-grid";
import { settleScreen } from "./action-result";
import type { IdbExec, IdbResult } from "./ios-direct-lane";
import { createIosDirectSession } from "./ios-direct-lane";
import type { SessionOptions } from "./lane";

const SIM_UDID = "B75001FB-B91D-4F94-80A7-3E371A641D27";
const PHONE_UDID = "00008120-000E6D813E2A601E";

const DESCRIBE = JSON.stringify({
	udid: SIM_UDID,
	target_type: "simulator",
	screen_dimensions: {
		width: 1206,
		height: 2622,
		density: 3,
		width_points: 402,
		height_points: 874,
	},
});

function ok(stdout = "", stdoutBytes?: Uint8Array): IdbResult {
	return { stdout, stderr: "", exitCode: 0, stdoutBytes };
}

function tinyPng(): Uint8Array {
	const rgba = new Uint8Array([0, 0, 0, 255]);
	return new Uint8Array(encodeRgbaPng({ width: 1, height: 1, rgba }));
}

function options(overrides: Partial<SessionOptions> = {}): SessionOptions {
	return {
		platform: "ios",
		deviceId: SIM_UDID,
		appCaps: [],
		caseCaps: [],
		...overrides,
	};
}

function recordingIdb(): { idb: IdbExec; calls: string[][] } {
	const calls: string[][] = [];
	const png = tinyPng();
	const idb: IdbExec = async (args) => {
		calls.push(args);
		if (args[0] === "describe") return ok(DESCRIBE);
		if (args[0] === "screenshot") return ok("", png);
		if (args[0] === "ui" && args[1] === "describe-all") {
			return ok(
				JSON.stringify({
					backend: "axbridge-exclusive",
					modal: {
						kind: "system",
						label: "Allow “Maps” to use your location?",
					},
					elements: [
						{
							type: "Button",
							label: "Allow While Using App",
							frame: { x: 24, y: 420, width: 354, height: 44 },
							enabled: true,
						},
					],
				}),
			);
		}
		return ok();
	};
	return { idb, calls };
}

describe("createIosDirectSession", () => {
	test("rejects Android so connect can fall back to Appium", async () => {
		await expect(
			createIosDirectSession(options({ platform: "android", deviceId: "emulator-5554" }), {
				idb: async () => ok(),
			}),
		).rejects.toThrow(/iOS simulators only/);
	});

	test("rejects a physical iOS UDID so connect stays on Appium", async () => {
		await expect(
			createIosDirectSession(options({ deviceId: PHONE_UDID }), { idb: async () => ok() }),
		).rejects.toThrow(/physical iOS stays on Appium/);
	});

	test("connects over idb and names the Direct lane", async () => {
		const { idb } = recordingIdb();
		const session = await createIosDirectSession(options(), { idb });
		expect(session.lane).toBe("direct");
		expect(session.stream).toBeNull();
		expect(await session.getWindowSize()).toEqual({ width: 402, height: 874 });
		await session.quit();
	});

	test("tap, swipe, type, and lifecycle go through idb", async () => {
		const { idb, calls } = recordingIdb();
		const session = await createIosDirectSession(options({ bundleId: "com.demo" }), { idb });
		await session.tap(500, 500);
		await session.swipe(100, 100, 200, 400);
		await session.drag(100, 100, 300, 300);
		await session.type("hello");
		await session.activateApp("com.demo");
		await session.terminateApp("com.demo");
		await session.openUrl("https://yoqa.arisn.dev");
		expect(calls.some((c) => c[0] === "ui" && c[1] === "tap" && c.includes("hid"))).toBe(true);
		expect(calls.some((c) => c[0] === "ui" && c[1] === "swipe")).toBe(true);
		expect(calls.some((c) => c[0] === "ui" && c[1] === "text" && c.includes("hello"))).toBe(true);
		expect(calls.some((c) => c[0] === "launch" && c.includes("com.demo"))).toBe(true);
		expect(calls.some((c) => c[0] === "terminate" && c.includes("com.demo"))).toBe(true);
		expect(calls.some((c) => c[0] === "open" && c.includes("https://yoqa.arisn.dev"))).toBe(true);
		await session.quit();
	});

	test("captureFrame reads the companion PNG", async () => {
		const { idb } = recordingIdb();
		const session = await createIosDirectSession(options(), { idb });
		const frame = await session.captureFrame();
		expect(frame.mime).toBe("image/png");
		expect(frame.base64.length).toBeGreaterThan(0);
		await session.quit();
	});

	test("pageSource returns the axbridge complete document", async () => {
		const { idb } = recordingIdb();
		const session = await createIosDirectSession(options(), { idb });
		const tree = await session.pageSource();
		expect(tree).toContain("axbridge-exclusive");
		await session.quit();
	});

	test("pageSource fails clearly when describe-all is empty", async () => {
		const { idb } = recordingIdb();
		const wrapped: IdbExec = async (args) => {
			if (args[0] === "ui" && args[1] === "describe-all") return ok("quiet (pid 1)\n");
			return idb(args);
		};
		const session = await createIosDirectSession(options(), { idb: wrapped });
		await expect(session.pageSource()).rejects.toThrow(/no tree/);
		await session.quit();
	});

	test("adaptive Settle uses the companion screenshot frame", async () => {
		const { idb } = recordingIdb();
		const session = await createIosDirectSession(options(), { idb });
		const result = await settleScreen(() => session.captureFrame(), {
			capMs: 400,
			pollMs: 20,
			stableWindowMs: 40,
		});
		expect(result.settled).toBe(true);
		expect(result.base64.length).toBeGreaterThan(0);
		await session.quit();
	});

	test("captureFrame falls back to simctl when companion screenshot fails", async () => {
		const png = tinyPng();
		const { idb } = recordingIdb();
		const wrapped: IdbExec = async (args) => {
			if (args[0] === "screenshot") {
				return { stdout: "", stderr: "Failed to capture a screenshot", exitCode: 1 };
			}
			return idb(args);
		};
		const session = await createIosDirectSession(options(), {
			idb: wrapped,
			screenshotFallback: async () => png,
		});
		const frame = await session.captureFrame();
		expect(frame.mime).toBe("image/png");
		expect(frame.base64.length).toBeGreaterThan(0);
		await session.quit();
	});

	test("acceptAlert taps Allow from the axbridge tree", async () => {
		const { idb, calls } = recordingIdb();
		const session = await createIosDirectSession(options(), { idb });
		await session.acceptAlert();
		expect(calls.some((c) => c[0] === "ui" && c[1] === "tap")).toBe(true);
		await session.quit();
	});
});
