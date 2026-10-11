import type { Device, Run } from "@yoqa/runner-client";

export type CaseLabelMeta = { number: number; name: string };

export function platformLabel(platform: Run["platform"] | Device["platform"]): string {
	if (platform === "ios") return "iOS";
	if (platform === "android") return "Android";
	return platform;
}

export function formatCaseLabel(meta: CaseLabelMeta | undefined, caseId: string): string {
	if (!meta) return caseId;
	return `#${meta.number} ${meta.name}`;
}

/** Friendly device line: name · model · OS version (platform); falls back to UDID. */
export function formatDeviceLabel(
	device: Device | undefined,
	fallback: { deviceId: string; platform: Run["platform"] },
): string {
	const os = platformLabel(fallback.platform);
	if (!device) {
		return `${fallback.deviceId} (${os})`;
	}
	const parts: string[] = [device.name];
	if (device.model?.trim()) parts.push(device.model.trim());
	parts.push(`OS ${device.osVersion}`);
	const kind =
		device.kind === "simulator"
			? "Simulator"
			: device.kind === "emulator"
				? "Emulator"
				: device.kind === "physical"
					? "Device"
					: null;
	const suffix = kind ? `${os} · ${kind}` : os;
	return `${parts.join(" · ")} (${suffix})`;
}

/** Short device title for breadcrumbs (name + OS), with UDID fallback. */
export function formatDeviceShortLabel(
	device: Device | undefined,
	fallback: { deviceId: string; platform: Run["platform"] },
): string {
	const os = platformLabel(fallback.platform);
	if (!device) return `${fallback.deviceId} (${os})`;
	return `${device.name} · ${os} ${device.osVersion}`;
}

export function formatRunCaseSummary(run: Run, caseNameById: Map<string, CaseLabelMeta>): string {
	if (run.tests.length === 0) return "—";
	const first = run.tests[0];
	if (!first) return "—";
	const primary = formatCaseLabel(caseNameById.get(first.caseId), first.caseId);
	const extra = run.tests.length - 1;
	if (extra <= 0) return primary;
	return `${primary} +${extra}`;
}

export function devicesQueryKey(platform: Run["platform"] | "all") {
	return ["devices", platform, "include-unavailable"] as const;
}

export type RunListFilter = "all" | "passed" | "failed";

export type RunListTone = "passed" | "failed" | "empty" | "live" | "cancelled";

export type RunListResult = {
	tone: RunListTone;
	/** Chip text. An em dash when the run recorded no cases. */
	chip: string;
	label: string;
};

/** How one run reads in the list: tone for the dot and chip, fraction for the chip. */
export function runListResult(run: Run): RunListResult {
	const total = run.tests.length;
	if (total === 0) {
		return { tone: "empty", chip: "—", label: "No tests" };
	}
	const passed = run.tests.filter((test) => test.status === "passed").length;
	const chip = `${passed} / ${total}`;
	switch (run.status) {
		case "passed":
			return { tone: "passed", chip, label: "Passed" };
		case "errored":
			return { tone: "failed", chip, label: "Failed" };
		case "cancelled":
			return { tone: "cancelled", chip, label: "Cancelled" };
		case "running":
			return { tone: "live", chip, label: "Running" };
		case "queued":
			return { tone: "live", chip, label: "Queued" };
	}
}

/** All, or only the passed / failed tones. Empty, live, and cancelled runs stay on All. */
export function filterRuns(runs: Run[], filter: RunListFilter): Run[] {
	if (filter === "all") return runs;
	const tone = filter === "passed" ? "passed" : "failed";
	return runs.filter((run) => runListResult(run).tone === tone);
}

/** Short month, day, and 12-hour time, as on the runs list (`Oct 10, 11:38 PM`). */
export function formatRunListDate(ms: number, locale?: string, timeZone?: string): string {
	const parts = new Intl.DateTimeFormat(locale, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		timeZone,
	}).formatToParts(new Date(ms));
	const pick = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((part) => part.type === type)?.value ?? "";
	const dayPeriod = pick("dayPeriod").replace(/[\u202f\u00a0]/g, " ");
	const time = `${pick("hour")}:${pick("minute")}${dayPeriod ? ` ${dayPeriod}` : ""}`;
	return `${pick("month")} ${pick("day")}, ${time}`;
}

/** Visible characters before the ellipsis, matching `00008120-000E6D…`. */
const DEVICE_ID_VISIBLE = 15;

function shortenDeviceId(deviceId: string): string {
	if (deviceId.length <= DEVICE_ID_VISIBLE) return deviceId;
	return `${deviceId.slice(0, DEVICE_ID_VISIBLE)}…`;
}

/** Two lines under Device: a name with OS, then model and a shortened id. */
export function formatRunDeviceLines(
	device: Device | undefined,
	fallback: { deviceId: string; platform: Run["platform"] },
): { title: string; meta: string } {
	const id = shortenDeviceId(fallback.deviceId);
	const os = platformLabel(fallback.platform);
	if (!device) return { title: id, meta: os };
	const model = device.model?.trim();
	return {
		title: formatDeviceShortLabel(device, fallback),
		meta: model ? `${model} · ${id}` : id,
	};
}

/** Right-hand caption on the list: today plus the connected device. Absent without one. */
export function formatRunContextCaption(device: Device | undefined): string | null {
	if (!device) return null;
	const title = formatDeviceShortLabel(device, {
		deviceId: device.id,
		platform: device.platform,
	});
	return `Today · ${title}`;
}
