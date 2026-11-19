/** One `Updater.onStatusChange` entry, as far as the wrapper reads it. */
export type ElectrobunStatusEntry = {
	status: string;
	message: string;
};

/**
 * The error that made one Electrobun step fail, from the statuses that step emitted, or null.
 * An `error` in the patch chain is followed by `downloading-full-bundle` (Electrobun falls back
 * to the full archive), so only an error after the last fallback is the one that failed.
 */
export function unrecoveredError(statuses: readonly ElectrobunStatusEntry[]): string | null {
	let error: string | null = null;
	for (const entry of statuses) {
		if (entry.status === "downloading-full-bundle") error = null;
		else if (entry.status === "error") error = entry.message;
	}
	return error;
}
