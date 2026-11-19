/**
 * Where the Yoqa update controller is in the update lifecycle. A failed check or download
 * goes back to `idle` (or stays `ready`) with `lastError`; `error` is kept for a Yoqa update
 * that failed to apply.
 */
export type YoqaUpdateState = "idle" | "checking" | "downloading" | "ready" | "error";

/** What the Yoqa update controller pushes to the webview on every change. */
export type YoqaUpdateStatus = {
	state: YoqaUpdateState;
	/** Version of the Yoqa update being downloaded or ready to install, e.g. `1.0.9`. */
	version: string | null;
	/** Epoch milliseconds of the last finished check, whether it found an update or failed. */
	lastCheckedAt: number | null;
	lastError: string | null;
	/** True while a ready Yoqa update waits on a Run in progress. */
	restartHeld: boolean;
};

/** The stored Yoqa update settings. */
export type YoqaUpdateSettings = {
	/** "Check for updates automatically": the launch check and one every 6 hours. On by default. */
	autoCheck: boolean;
};

/** The installed Yoqa Desktop and the Electrobun channel it was built for. */
export type YoqaVersionInfo = {
	version: string;
	/** `dev` under `electrobun dev`, where Yoqa never checks for updates. */
	channel: string;
};
