import type {
	DeveloperNotTrusted,
	Device,
	IosSigningCheckResponse,
	IosSigningStatus,
} from "@yoqa/runner-client";

const SOURCE_LABEL: Record<NonNullable<IosSigningStatus["source"]>, string> = {
	env: "from YOQA_IOS_TEAM_ID",
	saved: "saved",
	keychain: "newest certificate in the keychain",
};

function day(iso: string): string {
	return iso.slice(0, 10);
}

/** `yoqa signing`: the team in use and every team this Mac can sign with. */
export function formatSigningStatus(status: IosSigningStatus): string {
	const lines: string[] = [];
	if (status.team && status.source) {
		lines.push(`Signing team: ${status.team} (${SOURCE_LABEL[status.source]})`);
		if (status.bundleId) lines.push(`App ID:       ${status.bundleId}`);
	} else {
		lines.push("Signing team: none — sign in to Xcode › Settings › Accounts with your Apple ID");
	}
	if (status.envOverride && status.saved && status.saved !== status.envOverride) {
		lines.push(`YOQA_IOS_TEAM_ID overrides the saved team ${status.saved}.`);
	}
	lines.push("");
	if (status.teams.length === 0) {
		lines.push("No teams on this Mac.");
	} else {
		for (const team of status.teams) {
			const mark = team.id === status.team ? "*" : " ";
			const facts = [
				team.personal === true ? "personal (7-day profiles, 3 devices)" : null,
				team.personal === false ? "paid" : null,
				team.inXcode ? "in Xcode" : "not in Xcode",
				team.certificate
					? `certificate until ${day(team.certificate.expiresAt)}`
					: "no certificate yet",
			].filter(Boolean);
			lines.push(`${mark} ${team.id}  ${team.name ?? "unknown team"}`);
			lines.push(`    ${facts.join(" · ")}`);
		}
	}
	lines.push("");
	lines.push("Change it with `yoqa signing use <team>`, or `yoqa signing use auto`.");
	return lines.join("\n");
}

/** `yoqa signing check`: whether the team signed for the phone, and until when. */
export function formatSigningCheck(check: IosSigningCheckResponse): string {
	if (!check.ok) return `FAIL ${check.deviceId}\n${check.message}`;
	const lines = [`ok ${check.deviceId}`, check.message];
	if (check.devices) lines.push(`Profile lists: ${check.devices.join(", ")}`);
	return lines.join("\n");
}

/**
 * The iPhone `yoqa signing check` signs for: `--device`, else the one cabled iPhone. Several
 * or none is an error that lists what to pass.
 */
export function pickCheckDevice(requested: string | undefined, devices: Device[]): string {
	if (requested) return requested;
	const phones = devices.filter(
		(device) => device.kind === "physical" && device.unavailableReason === undefined,
	);
	if (phones.length === 1 && phones[0]) return phones[0].id;
	if (phones.length === 0) {
		throw new Error("No cabled iPhone. Connect one, or pass --device <udid>.");
	}
	const list = phones.map((device) => `  ${device.id}  ${device.owner ?? device.name}`).join("\n");
	throw new Error(`Several iPhones are connected; pass --device <udid>:\n${list}`);
}

/**
 * `yoqa devices connect` on an iPhone that does not trust a free Personal Team yet: the runner
 * is installed, so the user trusts it on the phone and runs the same connect again.
 */
export function formatDeveloperNotTrusted(info: DeveloperNotTrusted, retry: string): string {
	const certificate = info.certificate ?? `the Apple Development certificate of team ${info.team}`;
	return [
		"YoqaRunner is installed, but the iPhone does not trust your Personal Team yet.",
		"On the iPhone (unlocked, online):",
		"  1. Open Settings › General › VPN & Device Management",
		`  2. Under Developer App, tap ${certificate}`,
		"  3. Tap Trust, then Trust again",
		`Then connect again: ${retry}`,
	].join("\n");
}
