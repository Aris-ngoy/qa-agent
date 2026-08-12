import { describe, expect, test } from "bun:test";
import type { DoctorReport } from "@yoqa/runner-client";
import { doctorColorEnabled, formatDoctorReport } from "./doctor-table";

const report: DoctorReport = {
	ok: false,
	checks: [
		{ id: "node", label: "Node.js", status: "pass", detail: "v22.14.0" },
		{
			id: "appium",
			label: "Appium",
			status: "fail",
			detail: "not installed",
			fixHint: "yoqa runtime ensure",
		},
		{ id: "foreign", label: "Foreign Appium", status: "warn", detail: "pid 4321 on :4723" },
	],
	servers: [],
	steps: [
		{
			severity: "error",
			title: "Install Appium",
			detail: "Run yoqa runtime ensure",
			repair: "ensure-runtime",
		},
		{ severity: "warn", title: "Stop leftover Appium", detail: "yoqa doctor --fix" },
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
	test("renders a status table with pass/fail/warn and steps", () => {
		const text = formatDoctorReport(report, false);
		expect(text).toContain("doctor  issues found");
		expect(text).toContain("STATUS");
		expect(text).toContain("CHECK");
		expect(text).toContain("PASS");
		expect(text).toContain("FAIL");
		expect(text).toContain("WARN");
		expect(text).toContain("Node.js");
		expect(text).toContain("Appium");
		expect(text).toContain("yoqa runtime ensure");
		expect(text).toContain("SEV");
		expect(text).toContain("ERROR");
		expect(text).toContain("Install Appium");
		expect(text.includes("\u001b")).toBe(false);
	});

	test("colors pass green, fail red, and warn yellow", () => {
		const text = formatDoctorReport(report, true);
		expect(text).toContain("\u001b[32m");
		expect(text).toContain("\u001b[31m");
		expect(text).toContain("\u001b[33m");
		expect(text).toContain("PASS");
		expect(text).toContain("FAIL");
		expect(text).toContain("WARN");
	});

	test("ok reports use a green summary and skip empty steps", () => {
		const text = formatDoctorReport(
			{
				ok: true,
				checks: [{ id: "node", label: "Node.js", status: "pass", detail: "v22" }],
				servers: [],
				steps: [],
			},
			false,
		);
		expect(text).toContain("doctor  ok");
		expect(text).not.toContain("SEV");
	});
});
