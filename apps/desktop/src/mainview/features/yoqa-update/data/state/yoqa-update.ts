import { type YoqaUpdateStatus, initialYoqaUpdateStatus } from "@/../shared/yoqa-update";
import { observable } from "@legendapp/state";

/** The Yoqa update controller's latest snapshot, as pushed by the Bun host. */
export const yoqaUpdate$ = observable<YoqaUpdateStatus>(initialYoqaUpdateStatus());

export function setYoqaUpdateStatus(status: YoqaUpdateStatus): void {
	yoqaUpdate$.set({ ...status });
}
