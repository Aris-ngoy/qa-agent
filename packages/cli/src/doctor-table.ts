import type { DoctorCheck, DoctorCheckStatus, DoctorReport, DoctorStep } from "@yoqa/runner-client";

const ANSI = {
	reset: "\u001b[0m",
	bold: "\u001b[1m",
	dim: "\u001b[2m",
	green: "\u001b[32m",
	red: "\u001b[31m",
	yellow: "\u001b[33m",
} as const;

const BULLET = "•";

export function doctorColorEnabled(
	env: NodeJS.ProcessEnv = process.env,
	isTty = Boolean(process.stdout.isTTY),
): boolean {
	if (env.NO_COLOR != null && env.NO_COLOR !== "") return false;
	if (env.FORCE_COLOR != null && env.FORCE_COLOR !== "" && env.FORCE_COLOR !== "0") return true;
	return isTty;
}

function paint(
	text: string,
	color: "green" | "red" | "yellow" | "dim" | "bold",
	enabled: boolean,
): string {
	if (!enabled) return text;
	if (color === "dim") return `${ANSI.dim}${text}${ANSI.reset}`;
	if (color === "bold") return `${ANSI.bold}${text}${ANSI.reset}`;
	return `${ANSI.bold}${ANSI[color]}${text}${ANSI.reset}`;
}

function checkColor(status: DoctorCheckStatus): "green" | "red" | "yellow" {
	if (status === "pass") return "green";
	if (status === "fail") return "red";
	return "yellow";
}

function stepColor(severity: DoctorStep["severity"]): "green" | "red" | "yellow" {
	if (severity === "error") return "red";
	if (severity === "warn") return "yellow";
	return "green";
}

function detailText(value: string | undefined): string {
	return value?.replace(/\s+/g, " ").trim() ?? "";
}

function checkDetail(check: DoctorCheck): string {
	const parts = [check.detail, check.status !== "pass" ? check.fixHint : undefined].filter(
		(part): part is string => Boolean(part),
	);
	return detailText(parts.join(" · "));
}

function bulletLine(
	label: string,
	detail: string,
	color: "green" | "red" | "yellow",
	enabled: boolean,
): string {
	const mark = paint(BULLET, color, enabled);
	const name = paint(label, color, enabled);
	if (!detail) return `${mark} ${name}`;
	return `${mark} ${name} ${paint(`— ${detail}`, "dim", enabled)}`;
}

export function formatDoctorReport(report: DoctorReport, color = doctorColorEnabled()): string {
	const lines: string[] = [];
	const summary = report.ok ? "doctor  ok" : "doctor  issues found";
	lines.push(paint(summary, report.ok ? "green" : "red", color));

	if (report.checks.length > 0) {
		lines.push("");
		for (const check of report.checks) {
			lines.push(bulletLine(check.label, checkDetail(check), checkColor(check.status), color));
		}
	}

	if (report.steps.length > 0) {
		lines.push("");
		lines.push(paint("next", "dim", color));
		for (const step of report.steps) {
			lines.push(bulletLine(step.title, detailText(step.detail), stepColor(step.severity), color));
		}
	}

	return lines.join("\n");
}
