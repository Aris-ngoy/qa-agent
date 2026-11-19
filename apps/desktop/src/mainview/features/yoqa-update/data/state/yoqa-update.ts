import type { YoqaUpdateStatus } from "@/../shared/yoqa-update";
import { observable } from "@legendapp/state";

export function initialYoqaUpdateStatus(): YoqaUpdateStatus {
	return { state: "idle", version: null, lastCheckedAt: null, lastError: null, restartHeld: false };
}

/** The Yoqa update controller's latest snapshot, as pushed by the Bun host. */
export const yoqaUpdate$ = observable<YoqaUpdateStatus>(initialYoqaUpdateStatus());

export function setYoqaUpdateStatus(status: YoqaUpdateStatus): void {
	yoqaUpdate$.set({ ...status });
}
