import { describe, expect, test } from "bun:test";
import { appTargetFor, retargetsAfterRun } from "./session-app";

describe("appTargetFor", () => {
	const app = { iosBundleId: " com.example.app ", androidApplicationId: "com.example.android" };

	test("names the app by the id its platform uses: the bundle id on iOS, the package on Android", () => {
		expect(appTargetFor("ios", app)).toEqual({ bundleId: "com.example.app" });
		expect(appTargetFor("android", app)).toEqual({ appPackage: "com.example.android" });
	});

	test("names no app when the platform's id is blank or there is no app", () => {
		expect(appTargetFor("ios", { ...app, iosBundleId: "  " })).toEqual({});
		expect(appTargetFor("android", { ...app, androidApplicationId: "" })).toEqual({});
		expect(appTargetFor("ios", null)).toEqual({});
	});
});

const FREE = { deviceId: "dev-1", connectedAt: 10, heldByRun: false };
const HELD = { ...FREE, heldByRun: true, heldByRunId: "run_a" };

describe("retargetsAfterRun", () => {
	test("points the session back at the selected app when the Run that held it was for another", () => {
		expect(retargetsAfterRun(HELD, FREE, "app_run", "app_selected")).toBe(true);
	});

	test("points it back when the Run's app is not known", () => {
		expect(retargetsAfterRun(HELD, FREE, undefined, "app_selected")).toBe(true);
	});

	test("leaves it when the Run was for the selected app", () => {
		expect(retargetsAfterRun(HELD, FREE, "app_selected", "app_selected")).toBe(false);
	});

	test("does nothing while the Run still holds it, or when no Run held it", () => {
		expect(retargetsAfterRun(HELD, HELD, "app_run", "app_selected")).toBe(false);
		expect(retargetsAfterRun(FREE, FREE, "app_run", "app_selected")).toBe(false);
		expect(retargetsAfterRun(null, FREE, "app_run", "app_selected")).toBe(false);
	});

	test("does nothing when the session is gone or is a new connection, which uses the selected app", () => {
		expect(retargetsAfterRun(HELD, null, "app_run", "app_selected")).toBe(false);
		expect(retargetsAfterRun(HELD, { ...FREE, connectedAt: 11 }, "app_run", "app_selected")).toBe(
			false,
		);
		expect(retargetsAfterRun(HELD, { ...FREE, deviceId: "dev-2" }, "app_run", "app_selected")).toBe(
			false,
		);
	});

	test("does nothing without a selected app", () => {
		expect(retargetsAfterRun(HELD, FREE, "app_run", null)).toBe(false);
	});
});
