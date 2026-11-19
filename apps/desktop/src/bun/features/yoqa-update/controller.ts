import type { YoqaUpdateStatus } from "../../../shared/yoqa-update";

/** What a check found: whether a newer Yoqa Desktop exists, and its version. */
export type YoqaUpdateCheck = {
	updateAvailable: boolean;
	version: string;
};

/**
 * The three things the controller asks of Electrobun's `Updater`. Each throws on failure;
 * `apply` quits and relaunches Yoqa when it succeeds.
 */
export type YoqaUpdater = {
	check: () => Promise<YoqaUpdateCheck>;
	/** Electrobun's patch chain, falling back to the full archive. */
	download: () => Promise<void>;
	apply: () => Promise<void>;
};

export type YoqaUpdateTimer = {
	setTimeout: (callback: () => void, ms: number) => unknown;
	clearTimeout: (handle: unknown) => void;
};

export type YoqaUpdateControllerDeps = {
	updater: YoqaUpdater;
	/** Electrobun's build channel (`dev`, `canary`, `stable`). */
	channel: string;
	timer: YoqaUpdateTimer;
	now: () => number;
	/** Asks the local runner whether any Run is in progress; a ready update waits for it. */
	isRunInProgress: () => Promise<boolean>;
	/** Called with a fresh snapshot on every change. */
	onStatus: (status: YoqaUpdateStatus) => void;
};

export type YoqaUpdateController = {
	/** Schedule the launch check. Does nothing on the dev channel. */
	start: () => void;
	/** Check now, ignoring any schedule. Resolves once the check (and download) ends. */
	checkNow: () => Promise<void>;
	/** Apply a ready Yoqa update. Never called by the controller itself. */
	restart: () => Promise<void>;
	status: () => YoqaUpdateStatus;
};

/** Wait a moment after launch so the check doesn't compete with the runner starting. */
export const LAUNCH_CHECK_DELAY_MS = 10_000;

/** How often a ready Yoqa update asks the runner whether a Run is still in progress. */
export const RUN_RECHECK_INTERVAL_MS = 5_000;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function createYoqaUpdateController(deps: YoqaUpdateControllerDeps): YoqaUpdateController {
	let status: YoqaUpdateStatus = {
		state: "idle",
		version: null,
		lastCheckedAt: null,
		lastError: null,
		restartHeld: false,
	};

	function update(next: Partial<YoqaUpdateStatus>): void {
		status = { ...status, ...next };
		deps.onStatus(status);
	}

	/** Version of the Yoqa update already downloaded; it stays ready through later failures. */
	let readyVersion: string | null = null;

	/** Where a check settles when it doesn't produce a new ready update. */
	function settled(): Partial<YoqaUpdateStatus> {
		return readyVersion
			? { state: "ready", version: readyVersion }
			: { state: "idle", version: null, restartHeld: false };
	}

	/** A runner that can't answer runs no Run, so it never holds the restart. */
	function runInProgress(): Promise<boolean> {
		return deps.isRunInProgress().catch(() => false);
	}

	/** `electrobun dev` builds never look for a Yoqa update. */
	const devChannel = deps.channel === "dev";

	let checking: Promise<void> | null = null;

	function checkNow(): Promise<void> {
		if (devChannel) return Promise.resolve();
		checking ??= runCheck().finally(() => {
			checking = null;
		});
		return checking;
	}

	async function runCheck(): Promise<void> {
		// A ready Yoqa update keeps its banner while Yoqa looks for a newer one.
		if (!readyVersion) update({ state: "checking" });
		let found: YoqaUpdateCheck;
		try {
			found = await deps.updater.check();
		} catch (error) {
			update({ ...settled(), lastCheckedAt: deps.now(), lastError: errorMessage(error) });
			return;
		}
		// Up to date: a ready Yoqa update whose release is gone has nothing left to install.
		if (!found.updateAvailable) readyVersion = null;
		if (!found.updateAvailable || found.version === readyVersion) {
			update({ ...settled(), lastCheckedAt: deps.now(), lastError: null });
			return;
		}
		update({
			state: "downloading",
			version: found.version,
			lastCheckedAt: deps.now(),
			lastError: null,
		});
		try {
			await deps.updater.download();
		} catch (error) {
			update({ ...settled(), lastError: errorMessage(error) });
			return;
		}
		const held = await runInProgress();
		readyVersion = found.version;
		update({ state: "ready", restartHeld: held });
		watchRuns();
	}

	/** One re-check loop at a time; it ends on its own once no update is ready. */
	let watchingRuns = false;

	/** While an update is ready, keep `restartHeld` in step with the Runs in progress. */
	function watchRuns(): void {
		if (watchingRuns) return;
		watchingRuns = true;
		deps.timer.setTimeout(() => void recheckRuns(), RUN_RECHECK_INTERVAL_MS);
	}

	async function recheckRuns(): Promise<void> {
		const held = readyVersion ? await runInProgress() : false;
		watchingRuns = false;
		if (!readyVersion) return;
		if (held !== status.restartHeld) update({ restartHeld: held });
		watchRuns();
	}

	let applying: Promise<void> | null = null;

	function restart(): Promise<void> {
		if (applying) return applying;
		if (status.state !== "ready") return Promise.resolve();
		applying = (async () => {
			// Applying quits Yoqa and its runner, which would kill the Run mid-case.
			if (await runInProgress()) {
				update({ restartHeld: true });
				return;
			}
			await deps.updater.apply();
		})()
			.catch((error) => update({ lastError: errorMessage(error) }))
			.finally(() => {
				applying = null;
			});
		return applying;
	}

	return {
		start: () => {
			if (devChannel) return;
			deps.timer.setTimeout(() => void checkNow(), LAUNCH_CHECK_DELAY_MS);
		},
		checkNow,
		restart,
		status: () => status,
	};
}
