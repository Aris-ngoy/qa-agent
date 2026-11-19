import {
	YOQA_RELEASES_URL,
	type YoqaChannel,
	type YoqaUpdateStatus,
	updatesEnabledForChannel,
} from "@/../shared/yoqa-update";

/**
 * Settings' one-line result: up to date, checking, downloading, ready, or failed; or why this
 * version never looks for a Yoqa update.
 */
export function updateStatusText(status: YoqaUpdateStatus, channel: YoqaChannel): string {
	if (!updatesEnabledForChannel(channel)) {
		return channel === "canary"
			? "This prerelease doesn't receive Yoqa updates"
			: "Development versions don't check for Yoqa updates";
	}
	switch (status.state) {
		case "checking":
			return "Checking for updates…";
		case "downloading":
			return `Downloading Yoqa v${status.version}…`;
		case "ready":
			return `${readyPromptText(status.version ?? "")} — restart to install it`;
		case "error":
			return `Yoqa v${status.version} couldn't be installed`;
		case "idle":
			if (status.lastError) return "The last check for updates failed";
			if (status.lastCheckedAt == null) return "Yoqa hasn't checked for updates yet";
			return "Yoqa is up to date";
	}
}

/** The banner's headline while a Yoqa update is ready. */
export function readyPromptText(version: string): string {
	return `Yoqa v${version} is ready`;
}

/** Why the banner's Restart is disabled, or null when it isn't held. */
export function restartHeldText(restartHeld: boolean): string | null {
	return restartHeld ? "Waiting for the Run to finish" : null;
}

/** The banner's headline after a Yoqa update failed to apply. */
export function failedPromptText(version: string): string {
	return `Yoqa v${version} couldn't be installed, so Yoqa kept the version you had`;
}

const UNITS: { name: string; ms: number }[] = [
	{ name: "day", ms: 24 * 60 * 60_000 },
	{ name: "hour", ms: 60 * 60_000 },
	{ name: "minute", ms: 60_000 },
];

/** "Last checked 6 hours ago", rounded down to the largest whole unit. */
export function lastCheckedText(lastCheckedAt: number | null, now: number): string {
	if (lastCheckedAt == null) return "Not checked yet";
	const elapsed = Math.max(0, now - lastCheckedAt);
	for (const unit of UNITS) {
		const count = Math.floor(elapsed / unit.ms);
		if (count >= 1) return `Last checked ${count} ${unit.name}${count === 1 ? "" : "s"} ago`;
	}
	return "Last checked just now";
}

/** "What's new" and the manual download: the GitHub release page of that version. */
export function releasePageUrl(version: string): string {
	return `${YOQA_RELEASES_URL}/tag/v${version}`;
}
