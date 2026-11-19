import { Updater } from "electrobun/bun";
import type { YoqaUpdater } from "./controller";
import { type ElectrobunStatusEntry, unrecoveredError } from "./electrobun-status";
import type { FailedApplyTracker } from "./failed-apply";

/** Electrobun appends a random `?cachebuster` to the update.json URL; it only adds noise. */
function withoutCacheBuster(message: string): string {
	return message.replace(/\?[a-z0-9]+$/i, "");
}

/**
 * The controller's `updater`, over Electrobun 1.18's `Updater`. Electrobun reports failures as
 * an `error` string or a status event rather than by throwing, so each step throws here.
 */
export function createElectrobunYoqaUpdater(failedApply: FailedApplyTracker): YoqaUpdater {
	/** The step running now's errors and fallbacks; each download or apply starts it afresh. */
	let attempt: ElectrobunStatusEntry[] = [];
	Updater.onStatusChange((entry) => {
		if (entry.status !== "error" && entry.status !== "downloading-full-bundle") return;
		attempt.push({ status: entry.status, message: entry.message });
	});

	async function download(): Promise<void> {
		attempt = [];
		try {
			await Updater.downloadUpdate();
		} catch (error) {
			throw new Error(unrecoveredError(attempt) ?? (error as Error).message);
		}
		const info = Updater.updateInfo();
		if (!info?.updateReady) {
			throw new Error(
				unrecoveredError(attempt) ?? (info?.error || "Failed to download the Yoqa update"),
			);
		}
	}

	return {
		check: async () => {
			const info = await Updater.checkForUpdate();
			if (info.error) throw new Error(withoutCacheBuster(info.error));
			return { updateAvailable: info.updateAvailable === true, version: info.version };
		},
		download,
		apply: async () => {
			// A later check replaces Electrobun's update info and drops its ready flag; download
			// again, which reuses the tar already on disk.
			if (!Updater.updateInfo()?.updateReady) await download();
			attempt = [];
			// Electrobun forgets the apply across the relaunch; this marker lets the next launch
			// tell whether it still runs the old Yoqa.
			await failedApply.beforeApply(Updater.updateInfo()?.version ?? "");
			await Updater.applyUpdate();
			// A successful apply quits Yoqa before this line; still running means it stopped early.
			await failedApply.applyStopped();
			throw new Error(unrecoveredError(attempt) ?? "The Yoqa update could not be applied");
		},
		takeFailedApply: () => failedApply.take(),
	};
}
