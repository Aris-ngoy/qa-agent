import { describe, expect, test } from "bun:test";
import type { Device } from "@yoqa/runner-client";
import {
	deviceForSession,
	pickRememberedDevice,
	readRememberedDevice,
	writeRememberedDevice,
} from "./session-device";

const PHONE: Device = {
	id: "00008120-000E6D813E2A601E",
	name: "iPhone 16",
	owner: "Ada's iPhone",
	osVersion: "18.1",
	platform: "ios",
	kind: "physical",
};

const SIMULATOR: Device = {
	id: "B75001FB-B91D-4F94-80A7-3E371A641D27",
	name: "iPhone 17 Pro",
	osVersion: "26.0",
	platform: "ios",
	kind: "simulator",
};

const WIFI_ONLY: Device = {
	...PHONE,
	id: "00008110-0001",
	unavailableReason: "Paired over Wi-Fi only",
};

function memoryStorage(initial: Record<string, string> = {}) {
	const items = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => {
			items.set(key, value);
		},
	};
}

describe("deviceForSession", () => {
	test("names the session's device as the device list does", () => {
		expect(deviceForSession({ deviceId: PHONE.id, platform: "ios" }, [SIMULATOR, PHONE])).toEqual({
			id: PHONE.id,
			label: "iPhone 16 (Ada's iPhone)",
			name: "iPhone 16",
			osVersion: "18.1",
			platform: "ios",
			kind: "physical",
		});
	});

	test("keeps the real kind of a listed simulator", () => {
		expect(deviceForSession({ deviceId: SIMULATOR.id, platform: "ios" }, [SIMULATOR])?.kind).toBe(
			"simulator",
		);
	});

	test("is nothing when the list does not have the device (or is not loaded), never a guess", () => {
		expect(deviceForSession({ deviceId: SIMULATOR.id, platform: "ios" }, [PHONE])).toBeNull();
		expect(deviceForSession({ deviceId: SIMULATOR.id, platform: "ios" }, undefined)).toBeNull();
	});
});

describe("remembered device", () => {
	test("is read back after it was written", () => {
		const storage = memoryStorage();
		writeRememberedDevice({ platform: "ios", deviceId: PHONE.id }, storage);
		expect(readRememberedDevice(storage)).toEqual({ platform: "ios", deviceId: PHONE.id });
	});

	test("reads as nothing when nothing, or something unreadable, was stored", () => {
		expect(readRememberedDevice(memoryStorage())).toBeNull();
		expect(readRememberedDevice(memoryStorage({ "yoqa.lastDevice": "{not json" }))).toBeNull();
		expect(
			readRememberedDevice(
				memoryStorage({ "yoqa.lastDevice": JSON.stringify({ platform: "tv", deviceId: "x" }) }),
			),
		).toBeNull();
	});

	test("reads as nothing when storage is unavailable", () => {
		const broken = {
			getItem: () => {
				throw new Error("storage disabled");
			},
			setItem: () => {
				throw new Error("storage disabled");
			},
		};
		expect(() =>
			writeRememberedDevice({ platform: "ios", deviceId: PHONE.id }, broken),
		).not.toThrow();
		expect(readRememberedDevice(broken)).toBeNull();
	});
});

describe("pickRememberedDevice", () => {
	test("preselects the remembered device when the list still has it", () => {
		expect(pickRememberedDevice({ platform: "ios", deviceId: PHONE.id }, [PHONE])?.label).toBe(
			"iPhone 16 (Ada's iPhone)",
		);
	});

	test("picks nothing when the remembered device is gone or can't be a target", () => {
		expect(pickRememberedDevice({ platform: "ios", deviceId: PHONE.id }, [SIMULATOR])).toBeNull();
		expect(
			pickRememberedDevice({ platform: "ios", deviceId: WIFI_ONLY.id }, [WIFI_ONLY]),
		).toBeNull();
		expect(pickRememberedDevice(null, [PHONE])).toBeNull();
	});
});
