import { describe, expect, test } from "bun:test";
import type { DoctorReport } from "@yoqa/runner-client";
import { doctorColorEnabled, formatDoctorReport } from "./doctor-table";

const report: DoctorReport = {
	ok: false,
	checks: [
		{ id: "java", label: "Java", status: "pass", detail: "JAVA_HOME=/opt/jdk" },
		{
			id: "adb-devices",
			label: "ADB devices",
			status: "fail",
			detail: "adb not found",
			fixHint: "Install Android platform-tools",
		},
		{
			id: "device-session",
			label: "Active device session",
			status: "warn",
			detail: "ios 00008120 (stream not ready)",
		},
	],
	servers: [],
	steps: [
		{ severity: "error", title: "Install adb", detail: "Install Android platform-tools" },
		{
			severity: "warn",
			title: "Active device session",
			detail: "Disconnect and reconnect",
			repair: "disconnect-session",
		},
	],
};

describe("doctorColorEnabled", () => {
	test("respects NO_COLOR even on a TTY", () => {
		expect(doctorColorEnabled({ NO_COLOR: "1" }, true)).toBe(false);
	});

	test("FORCE_COLOR wins when not a TTY", () => {
		expect(doctorColorEnabled({ FORCE_COLOR: "1" }, false)).toBe(true);
	});

	test("TTY enables color by default", () => {
		expect(doctorColorEnabled({}, true)).toBe(true);
		expect(doctorColorEnabled({}, false)).toBe(false);
	});
});

describe("formatDoctorReport", () => {
	test("renders a colored bullet list for checks and steps", () => {
		const text = formatDoctorReport(report, false);
		expect(text).toContain("doctor  issues found");
		expect(text).toContain("• Java — JAVA_HOME=/opt/jdk");
		expect(text).toContain("• ADB devices — adb not found · Install Android platform-tools");
		expect(text).toContain("• Active device session — ios 00008120 (stream not ready)");
		expect(text).toContain("next");
		expect(text).toContain("• Install adb — Install Android platform-tools");
		expect(text).not.toContain("STATUS");
		expect(text.includes("\u001b")).toBe(false);
	});

	test("colors pass green, fail red, and warn yellow", () => {
		const text = formatDoctorReport(report, true);
		expect(text).toContain("\u001b[32m");
		expect(text).toContain("\u001b[31m");
		expect(text).toContain("\u001b[33m");
		expect(text).toContain("•");
		expect(text).toContain("Java");
		expect(text).toContain("ADB devices");
	});

	test("ok reports use a green summary and skip empty steps", () => {
		const text = formatDoctorReport(
			{
				ok: true,
				checks: [{ id: "java", label: "Java", status: "pass", detail: "jdk 21" }],
				servers: [],
				steps: [],
			},
			false,
		);
		expect(text).toContain("doctor  ok");
		expect(text).toContain("• Java — jdk 21");
		expect(text).not.toContain("next");
	});
});
