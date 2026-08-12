import type { DoctorCheckStatus } from "@yoqa/runner-client";

const STATUS_LABEL: Record<DoctorCheckStatus, string> = {
	pass: "Pass",
	fail: "Fail",
	warn: "Warn",
};

/** Pill classes for doctor check status — green / red / amber fills. */
export function doctorStatusPillClass(status: DoctorCheckStatus): string {
	if (status === "pass") {
		return "bg-secondary-container text-on-secondary-container";
	}
	if (status === "fail") {
		return "bg-error-container text-on-error-container";
	}
	return "bg-amber-100 text-amber-900";
}

export function doctorStatusDotClass(status: DoctorCheckStatus): string {
	if (status === "pass") return "bg-secondary";
	if (status === "fail") return "bg-error";
	return "bg-amber-500";
}

/** Soft row tint behind each check. */
export function doctorStatusRowClass(status: DoctorCheckStatus): string {
	if (status === "pass") {
		return "border border-secondary/25 bg-secondary-container/50";
	}
	if (status === "fail") {
		return "border border-error/30 bg-error-container/60";
	}
	return "border border-amber-300/80 bg-amber-50";
}

export function doctorStepSeverityClass(severity: "error" | "warn" | "info"): string {
	if (severity === "error") {
		return "border border-error/30 bg-error-container/60";
	}
	if (severity === "warn") {
		return "border border-amber-300/80 bg-amber-50";
	}
	return "border border-secondary/25 bg-secondary-container/50";
}

export function doctorStepSeverityPillClass(severity: "error" | "warn" | "info"): string {
	if (severity === "error") {
		return "bg-error-container text-on-error-container";
	}
	if (severity === "warn") {
		return "bg-amber-100 text-amber-900";
	}
	return "bg-secondary-container text-on-secondary-container";
}

export function DoctorStatusPill({ status }: { status: DoctorCheckStatus }) {
	return (
		<span
			className={[
				"inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-helper font-semibold capitalize",
				doctorStatusPillClass(status),
			].join(" ")}
		>
			<span className={["size-1.5 rounded-full", doctorStatusDotClass(status)].join(" ")} />
			{STATUS_LABEL[status]}
		</span>
	);
}

export function DoctorSeverityPill({ severity }: { severity: "error" | "warn" | "info" }) {
	const label = severity === "error" ? "Error" : severity === "warn" ? "Warn" : "Info";
	return (
		<span
			className={[
				"inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-helper font-semibold",
				doctorStepSeverityPillClass(severity),
			].join(" ")}
		>
			{label}
		</span>
	);
}
