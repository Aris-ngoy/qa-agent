/**
 * Where the Yoqa update controller is in the update lifecycle. A failed check or download
 * goes back to `idle` (or stays `ready`) with `lastError`; `error` means the Yoqa update in
 * `version` failed to apply, in this session or the last, until a later check succeeds.
 */
export type YoqaUpdateState = "idle" | "checking" | "downloading" | "ready" | "error";

/** What the Yoqa update controller pushes to the webview on every change. */
export type YoqaUpdateStatus = {
	state: YoqaUpdateState;
	/** Version of the Yoqa update being downloaded, ready to install or failed to apply, e.g. `1.0.9`. */
	version: string | null;
	/** Epoch milliseconds of the last finished check, whether it found an update or failed. */
	lastCheckedAt: number | null;
	lastError: string | null;
	/** True while a ready Yoqa update waits on a Run in progress. */
	restartHeld: boolean;
};

/** The Yoqa update controller's snapshot before anything has happened. */
export function initialYoqaUpdateStatus(): YoqaUpdateStatus {
	return { state: "idle", version: null, lastCheckedAt: null, lastError: null, restartHeld: false };
}

/** The stored Yoqa update settings. */
export type YoqaUpdateSettings = {
	/** "Check for updates automatically": the launch check and one every 6 hours. On by default. */
	autoCheck: boolean;
};

/**
 * Electrobun's channel for the installed Yoqa Desktop: `dev` under `electrobun dev`, `canary`
 * for a prerelease (`v*-*` tag), `stable` for a release.
 */
export type YoqaChannel = "dev" | "canary" | "stable";

/**
 * Only stable installs look for a Yoqa update. `latest/download` never serves a prerelease's
 * files, so a canary check could only fail (ADR-0013); `dev` has nothing to update.
 */
export function updatesEnabledForChannel(channel: YoqaChannel): boolean {
	return channel === "stable";
}

/** The installed Yoqa Desktop version and its Electrobun channel. */
export type YoqaVersionInfo = {
	version: string;
	channel: YoqaChannel;
};

/** Yoqa Desktop's GitHub Releases: each version's release page, and Yoqa updates under `latest/download`. */
export const YOQA_RELEASES_URL = "https://github.com/Aris-ngoy/qa-agent/releases";
