import { describe, expect, test } from "bun:test";
import {
	appMainProcess,
	idleWiredUdids,
	parseDevicectlAppUrl,
	parseDevicectlApps,
	parseDevicectlDevices,
	parseDevicectlProcesses,
} from "./devicectl";
import apps from "./fixtures/devicectl-apps.json";
import processes from "./fixtures/devicectl-processes.json";
import wifi from "./fixtures/devicectl-wifi.json";
import devModeOff from "./fixtures/devicectl-wired-devmode-off.json";
import wiredLegacy from "./fixtures/devicectl-wired-legacy.json";
import wired from "./fixtures/devicectl-wired.json";

// `devicectl-wifi.json` is captured from `xcrun devicectl list devices --json-output` (Xcode 27)
// with serials and hostnames removed: a watch, two Wi-Fi-paired iPhones (one with its tunnel
// up) and a booted simulator. The `wired` fixtures are its iPhone 15 on a cable.
// `devicectl-apps.json` is the shape of `xcrun devicectl device info apps --json-output`.
// `devicectl-processes.json` is cut down from `xcrun devicectl device info processes
// --json-output` on that iPhone 15 (Xcode 27), with its apps renamed to the ones in
// `devicectl-apps.json`: Shop is running with a widget extension, testemall is not, and the
// Shop app clip has only an extension running.

describe("parseDevicectlDevices", () => {
	test("a cabled phone with Developer Mode on is a target", () => {
		expect(parseDevicectlDevices(wired)).toEqual([
			{
				id: "00008120-000E6D813E2A601E",
				name: "iPhone 15",
				owner: "Test’s iPhone",
				osVersion: "iOS 27.0.1",
				platform: "ios",
				kind: "physical",
				state: "connected",
				model: "iPhone15,4",
			},
		]);
	});

	test("the older devicectl shape without `properties` reads the same", () => {
		expect(parseDevicectlDevices(wiredLegacy)).toEqual(parseDevicectlDevices(wired));
	});

	test("Wi-Fi-paired phones are not targets, and say why", () => {
		const phones = parseDevicectlDevices(wifi);
		expect(phones.map((phone) => phone.name)).toEqual(["iPhone 15", "iPhone 17 Pro"]);
		for (const phone of phones) {
			expect(phone.state).toBe("paired");
			expect(phone.unavailableReason).toMatch(/Wi-Fi/);
			expect(phone.unavailableReason).toMatch(/cable/);
		}
	});

	test("a cabled phone with Developer Mode off is not a target, and says how to fix it", () => {
		const [phone] = parseDevicectlDevices(devModeOff);
		expect(phone?.unavailableReason).toMatch(/Developer Mode/);
	});

	test("simulators and watches are not physical iPhones", () => {
		const ids = parseDevicectlDevices(wifi).map((phone) => phone.id);
		expect(ids).not.toContain("B75001FB-B91D-4F94-80A7-3E371A641D27");
		expect(ids).not.toContain("00008310-0004E21A2600E01E");
	});

	test("unreadable output lists nothing", () => {
		expect(parseDevicectlDevices(null)).toEqual([]);
		expect(parseDevicectlDevices({ result: {} })).toEqual([]);
	});
});

describe("idleWiredUdids", () => {
	test("finds a cabled phone whose tunnel is down, not a connected or Wi-Fi one", () => {
		const idle = structuredClone(wired) as typeof wired;
		const item = idle.result.devices.find(
			(d) => parseDevicectlDevices({ result: { devices: [d] } }).length,
		);
		const props = (item as { properties?: { connection?: { state?: string } } }).properties;
		const legacy = (item as { connectionProperties?: { tunnelState?: string } })
			.connectionProperties;
		if (props?.connection) props.connection.state = "disconnected";
		if (legacy) legacy.tunnelState = "disconnected";

		expect(idleWiredUdids(idle).length).toBeGreaterThan(0);
		expect(idleWiredUdids(wired)).toEqual([]);
		expect(idleWiredUdids(wifi)).toEqual([]);
	});
});

describe("parseDevicectlApps", () => {
	test("lists the user apps, the ones built by a developer first, without YoqaRunner or app clips", () => {
		expect(parseDevicectlApps(apps)).toEqual(["com.example.testemall", "com.example.shop"]);
	});

	test("unreadable output lists nothing", () => {
		expect(parseDevicectlApps(null)).toEqual([]);
		expect(parseDevicectlApps({ result: {} })).toEqual([]);
	});
});

describe("parseDevicectlAppUrl", () => {
	test("finds where an app is installed by its bundle id", () => {
		expect(parseDevicectlAppUrl(apps, "com.example.shop")).toBe(
			"file:///private/var/containers/Bundle/Application/2C1F8A4E-0C5E-4F43-9F7B-1D7C2B3E4A10/Shop.app/",
		);
	});

	test("an app that is not listed, or unreadable output, has no url", () => {
		expect(parseDevicectlAppUrl(apps, "com.example.absent")).toBeUndefined();
		expect(parseDevicectlAppUrl(null, "com.example.shop")).toBeUndefined();
		expect(parseDevicectlAppUrl({ result: {} }, "com.example.shop")).toBeUndefined();
	});
});

describe("parseDevicectlProcesses", () => {
	test("lists each running process with its pid and executable", () => {
		const running = parseDevicectlProcesses(processes);
		expect(running).toHaveLength(8);
		expect(running?.[0]).toEqual({ pid: 1, executable: "file:///sbin/launchd" });
	});

	test("unreadable output is null, not an empty phone", () => {
		expect(parseDevicectlProcesses(null)).toBeNull();
		expect(parseDevicectlProcesses({ result: {} })).toBeNull();
	});
});

describe("appMainProcess", () => {
	const running = parseDevicectlProcesses(processes) ?? [];
	const urlOf = (bundleId: string) => parseDevicectlAppUrl(apps, bundleId) ?? "";

	test("a running app is its own executable, not one of its extensions", () => {
		expect(appMainProcess(running, urlOf("com.example.shop"))?.pid).toBe(528);
	});

	test("an app that is not running has no process", () => {
		expect(appMainProcess(running, urlOf("com.example.testemall"))).toBeUndefined();
	});

	test("an app with only an extension running is not running", () => {
		expect(appMainProcess(running, urlOf("com.example.shop.Clip"))).toBeUndefined();
	});

	test("a system app is found under /Applications", () => {
		expect(appMainProcess(running, "file:///Applications/Preferences.app/")?.pid).toBe(401);
	});
});
