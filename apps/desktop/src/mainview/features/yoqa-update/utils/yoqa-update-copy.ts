import type { YoqaUpdateStatus } from "@/../shared/yoqa-update";

const RELEASES_URL = "https://github.com/Aris-ngoy/qa-agent/releases";

/** Settings' one-line result: up to date, checking, downloading, ready, or failed. */
export function updateStatusText(status: YoqaUpdateStatus, channel: string): string {
	if (channel === "dev") return "Development builds don't check for Yoqa updates";
	switch (status.state) {
		case "checking":
			return "Checking for updates…";
		case "downloading":
			return `Downloading Yoqa v${status.version}…`;
		case "ready":
			return `${readyPromptText(status.version ?? "")} — restart to install it`;
		case "error":
			return "The Yoqa update couldn't be installed";
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

/** "What's new": the GitHub release page of that version. */
export function releasePageUrl(version: string): string {
	return `${RELEASES_URL}/tag/v${version}`;
}
