import { describe, expect, test } from "bun:test";
import { idleWiredUdids, parseDevicectlDevices } from "./devicectl";
import wifi from "./fixtures/devicectl-wifi.json";
import devModeOff from "./fixtures/devicectl-wired-devmode-off.json";
import wiredLegacy from "./fixtures/devicectl-wired-legacy.json";
import wired from "./fixtures/devicectl-wired.json";

// `devicectl-wifi.json` is captured from `xcrun devicectl list devices --json-output` (Xcode 27)
// with serials and hostnames removed: a watch, two Wi-Fi-paired iPhones (one with its tunnel
// up) and a booted simulator. The `wired` fixtures are its iPhone 15 on a cable.

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
