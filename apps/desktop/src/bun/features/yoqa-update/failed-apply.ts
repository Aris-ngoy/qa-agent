import type { YoqaFailedApply } from "./controller";

/** Saved just before Yoqa quits to apply a Yoqa update: what it meant to install, and over what. */
export type PendingYoqaApply = {
	version: string;
	/** Electrobun's hash (`version.json`) of the Yoqa version that quit to apply. */
	fromHash: string;
};

/** Where the marker survives the relaunch; production keeps it in Yoqa's stored settings. */
export type PendingYoqaApplyStore = {
	read: () => Promise<PendingYoqaApply | null>;
	write: (next: PendingYoqaApply | null) => Promise<void>;
};

export type FailedApplyTracker = ReturnType<typeof createFailedApplyTracker>;

/**
 * Electrobun keeps nothing about an apply across the relaunch, and keeps the old Yoqa when the
 * apply fails. So Yoqa saves a marker before applying and, on the next launch, a marker whose
 * `fromHash` is still the running hash means the apply failed.
 */
export function createFailedApplyTracker(
	store: PendingYoqaApplyStore,
	localHash: () => Promise<string>,
) {
	/** A marker that can't be saved or cleared must never block an apply or a launch. */
	async function write(next: PendingYoqaApply | null): Promise<void> {
		await store.write(next).catch(() => {});
	}

	return {
		beforeApply: async (version: string): Promise<void> => {
			await write({ version, fromHash: await localHash() });
		},
		/** The apply returned instead of quitting; Yoqa has reported that failure in-session. */
		applyStopped: (): Promise<void> => write(null),
		take: async (): Promise<YoqaFailedApply | null> => {
			const pending = await store.read().catch(() => null);
			if (!pending) return null;
			await write(null);
			return pending.fromHash === (await localHash()) ? { version: pending.version } : null;
		},
	};
}
