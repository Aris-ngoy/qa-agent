import { Updater } from "electrobun/bun";
import type { YoqaUpdater } from "./controller";

/** Electrobun appends a random `?cachebuster` to the update.json URL; it only adds noise. */
function withoutCacheBuster(message: string): string {
	return message.replace(/\?[a-z0-9]+$/i, "");
}

/**
 * The controller's `updater`, over Electrobun 1.18's `Updater`. Electrobun reports failures as
 * an `error` string or a status event rather than by throwing, so each step throws here.
 */
export function createElectrobunYoqaUpdater(): YoqaUpdater {
	let lastStatusError: string | null = null;
	Updater.onStatusChange((entry) => {
		if (entry.status === "error") lastStatusError = entry.message;
	});

	async function download(): Promise<void> {
		lastStatusError = null;
		try {
			await Updater.downloadUpdate();
		} catch (error) {
			throw new Error(lastStatusError ?? (error as Error).message);
		}
		const info = Updater.updateInfo();
		if (!info?.updateReady) {
			throw new Error(lastStatusError ?? (info?.error || "Failed to download the Yoqa update"));
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
			lastStatusError = null;
			await Updater.applyUpdate();
			// A successful apply quits Yoqa before this line; still running means it stopped early.
			throw new Error(lastStatusError ?? "The Yoqa update could not be applied");
		},
	};
}
