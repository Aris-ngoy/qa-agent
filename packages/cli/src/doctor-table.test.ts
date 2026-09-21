import { describe, expect, test } from "bun:test";
import type { DoctorReport } from "@yoqa/runner-client";
import { doctorColorEnabled, formatDoctorReport } from "./doctor-table";

const report: DoctorReport = {
	ok: false,
	checks: [
		{ id: "node", label: "Node.js", status: "pass", detail: "v22.14.0" },
		{
			id: "argent",
			label: "Argent",
			status: "fail",
			detail: "not installed",
			fixHint: "yoqa runtime ensure",
		},
		{ id: "session", label: "Active device session", status: "warn", detail: "No active session" },
	],
	servers: [],
	steps: [
		{
			severity: "error",
			title: "Install Argent",
			detail: "Run yoqa runtime ensure",
			repair: "ensure-runtime",
		},
		{ severity: "warn", title: "No active session", detail: "yoqa devices connect <id>" },
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
		expect(text).toContain("• Node.js — v22.14.0");
		expect(text).toContain("• Argent — not installed · yoqa runtime ensure");
		expect(text).toContain("• Active device session — No active session");
		expect(text).toContain("next");
		expect(text).toContain("• Install Argent — Run yoqa runtime ensure");
		expect(text).not.toContain("STATUS");
		expect(text.includes("\u001b")).toBe(false);
	});

	test("colors pass green, fail red, and warn yellow", () => {
		const text = formatDoctorReport(report, true);
		expect(text).toContain("\u001b[32m");
		expect(text).toContain("\u001b[31m");
		expect(text).toContain("\u001b[33m");
		expect(text).toContain("•");
		expect(text).toContain("Node.js");
		expect(text).toContain("Argent");
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
		expect(text).toContain("• Node.js — v22");
		expect(text).not.toContain("next");
	});
});
