import { describe, expect, test } from "bun:test";
import type { Device, IosSigningStatus } from "@yoqa/runner-client";
import {
	formatDeveloperNotTrusted,
	formatSigningCheck,
	formatSigningStatus,
	pickCheckDevice,
} from "./signing";

const status: IosSigningStatus = {
	team: "T4L8PFGHBJ",
	source: "saved",
	saved: "T4L8PFGHBJ",
	envOverride: null,
	bundleId: "dev.yoqa.runner.t4l8pfghbj",
	teams: [
		{
			id: "NEWTEAM222",
			name: "Apple Development: Test Person (NEWID22222)",
			personal: null,
			inXcode: false,
			certificate: {
				name: "Apple Development: Test Person (NEWID22222)",
				expiresAt: "2027-04-01T00:00:00.000Z",
			},
		},
		{
			id: "T4L8PFGHBJ",
			name: "Test Person (Personal Team)",
			personal: true,
			inXcode: true,
			certificate: null,
		},
	],
};

const phone = (id: string, extra: Partial<Device> = {}): Device => ({
	id,
	name: "iPhone",
	osVersion: "26.0",
	platform: "ios",
	kind: "physical",
	...extra,
});

describe("formatSigningStatus", () => {
	test("marks the team in use and says where it came from", () => {
		const text = formatSigningStatus(status);
		expect(text).toContain("Signing team: T4L8PFGHBJ (saved)");
		expect(text).toContain("App ID:       dev.yoqa.runner.t4l8pfghbj");
		expect(text).toContain("* T4L8PFGHBJ  Test Person (Personal Team)");
		expect(text).toContain("personal (7-day profiles, 3 devices) · in Xcode · no certificate yet");
		expect(text).toContain("  NEWTEAM222");
		expect(text).toContain("not in Xcode · certificate until 2027-04-01");
	});

	test("says when YOQA_IOS_TEAM_ID overrides the saved team", () => {
		const text = formatSigningStatus({
			...status,
			team: "ENVTEAM999",
			source: "env",
			envOverride: "ENVTEAM999",
		});
		expect(text).toContain("(from YOQA_IOS_TEAM_ID)");
		expect(text).toContain("YOQA_IOS_TEAM_ID overrides the saved team T4L8PFGHBJ.");
	});

	test("without a team it says how to get one", () => {
		const text = formatSigningStatus({
			...status,
			team: null,
			source: null,
			saved: null,
			bundleId: null,
			teams: [],
		});
		expect(text).toContain("Signing team: none — sign in to Xcode");
		expect(text).toContain("No teams on this Mac.");
	});
});

describe("formatSigningCheck", () => {
	test("a failure leads with FAIL and the fix", () => {
		expect(
			formatSigningCheck({
				ok: false,
				deviceId: "U1",
				team: "T4L8PFGHBJ",
				action: null,
				profileExpiresAt: null,
				devices: null,
				message: "Xcode has no account for team T4L8PFGHBJ.",
			}),
		).toBe("FAIL U1\nXcode has no account for team T4L8PFGHBJ.");
	});
});

describe("pickCheckDevice", () => {
	test("--device wins", () => {
		expect(pickCheckDevice("U9", [phone("U1"), phone("U2")])).toBe("U9");
	});

	test("the one cabled iPhone, ignoring simulators and Wi-Fi-only phones", () => {
		const devices = [
			phone("U1"),
			phone("U2", { unavailableReason: "paired over Wi-Fi only" }),
			phone("SIM", { kind: "simulator" }),
		];
		expect(pickCheckDevice(undefined, devices)).toBe("U1");
	});

	test("none or several is an error that says what to pass", () => {
		expect(() => pickCheckDevice(undefined, [])).toThrow(/No cabled iPhone/);
		expect(() => pickCheckDevice(undefined, [phone("U1"), phone("U2")])).toThrow(
			/Several iPhones.*\n {2}U1/,
		);
	});
});

describe("formatDeveloperNotTrusted", () => {
	test("says what to tap on the phone and how to connect again", () => {
		const text = formatDeveloperNotTrusted(
			{
				error: "Developer not trusted on the iPhone",
				code: "DEVELOPER_NOT_TRUSTED",
				detail: "…",
				team: "T4L8PFGHBJ",
				certificate: "Apple Development: a@b.c (63L33U439U)",
			},
			"yoqa devices connect U1 --platform ios",
		);
		expect(text).toContain("YoqaRunner is installed");
		expect(text).toContain("2. Under Developer App, tap Apple Development: a@b.c (63L33U439U)");
		expect(text).toContain("Then connect again: yoqa devices connect U1 --platform ios");
	});
});
