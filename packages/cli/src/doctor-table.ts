import type { DoctorCheck, DoctorCheckStatus, DoctorReport, DoctorStep } from "@yoqa/runner-client";

const ANSI = {
	reset: "\u001b[0m",
	bold: "\u001b[1m",
	dim: "\u001b[2m",
	green: "\u001b[32m",
	red: "\u001b[31m",
	yellow: "\u001b[33m",
} as const;

const CHECK_STATUS_LABEL: Record<DoctorCheckStatus, string> = {
	pass: "PASS",
	fail: "FAIL",
	warn: "WARN",
};

const STEP_SEVERITY_LABEL: Record<DoctorStep["severity"], string> = {
	error: "ERROR",
	warn: "WARN",
	info: "INFO",
};

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

const ESC = "\u001b";

function stripAnsi(text: string): string {
	let out = "";
	for (let i = 0; i < text.length; i++) {
		if (text[i] === ESC && text[i + 1] === "[") {
			const end = text.indexOf("m", i + 2);
			if (end !== -1) {
				i = end;
				continue;
			}
		}
		out += text[i];
	}
	return out;
}

function visibleWidth(text: string): number {
	return stripAnsi(text).length;
}

function padEndVisible(text: string, width: number): string {
	const extra = width - visibleWidth(text);
	return extra > 0 ? `${text}${" ".repeat(extra)}` : text;
}

function cell(value: string | undefined): string {
	const text = value?.replace(/\s+/g, " ").trim() ?? "";
	return text.length > 0 ? text : "—";
}

function columnWidths(headers: string[], rows: string[][]): number[] {
	return headers.map((header, index) => {
		let width = header.length;
		for (const row of rows) {
			const value = row[index] ?? "";
			width = Math.max(width, visibleWidth(value));
		}
		return width;
	});
}

function formatTable(headers: string[], rows: string[][], color: boolean): string {
	const widths = columnWidths(headers, rows);
	const headerLine = headers
		.map((header, index) =>
			padEndVisible(paint(header, "dim", color), widths[index] ?? header.length),
		)
		.join("  ");
	const rule = widths.map((width) => "─".repeat(width)).join("  ");
	const body = rows.map((row) =>
		row
			.map((value, index) => padEndVisible(value, widths[index] ?? visibleWidth(value)))
			.join("  "),
	);
	return [headerLine, paint(rule, "dim", color), ...body].join("\n");
}

function checkDetail(check: DoctorCheck): string {
	const parts = [check.detail, check.status !== "pass" ? check.fixHint : undefined].filter(
		(part): part is string => Boolean(part),
	);
	return cell(parts.join(" · "));
}

export function formatDoctorReport(report: DoctorReport, color = doctorColorEnabled()): string {
	const lines: string[] = [];
	const summary = report.ok ? "doctor  ok" : "doctor  issues found";
	lines.push(paint(summary, report.ok ? "green" : "red", color));
	lines.push("");

	if (report.checks.length > 0) {
		const rows = report.checks.map((check) => {
			const status = paint(CHECK_STATUS_LABEL[check.status], checkColor(check.status), color);
			return [status, check.label, checkDetail(check)];
		});
		lines.push(formatTable(["STATUS", "CHECK", "DETAIL"], rows, color));
	}

	if (report.steps.length > 0) {
		lines.push("");
		const rows = report.steps.map((step) => {
			const severity = paint(STEP_SEVERITY_LABEL[step.severity], stepColor(step.severity), color);
			return [severity, step.title, cell(step.detail)];
		});
		lines.push(formatTable(["SEV", "STEP", "DETAIL"], rows, color));
	}

	return lines.join("\n");
}
