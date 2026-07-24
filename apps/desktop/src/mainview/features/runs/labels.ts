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
