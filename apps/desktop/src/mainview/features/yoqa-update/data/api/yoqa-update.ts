import type { YoqaUpdateSettings } from "@/../shared/yoqa-update";
import { getDesktopRpc, onYoqaUpdateStatus } from "@/app/desktop-rpc";

export { onYoqaUpdateStatus };

export function getYoqaVersion() {
	return getDesktopRpc().request.getYoqaVersion();
}

export function getYoqaUpdateStatus() {
	return getDesktopRpc().request.getYoqaUpdateStatus();
}

/** Starts a check and answers at once; the result arrives through `onYoqaUpdateStatus`. */
export function checkForYoqaUpdate() {
	return getDesktopRpc().request.checkForYoqaUpdate();
}

/** Applies the ready Yoqa update; Yoqa quits and relaunches when it succeeds. */
export function restartForYoqaUpdate() {
	return getDesktopRpc().request.restartForYoqaUpdate();
}

/** The stored "Check for updates automatically" setting. */
export function getYoqaUpdateSettings() {
	return getDesktopRpc().request.getYoqaUpdateSettings();
}

/** Stores the setting; the host reschedules or cancels automatic checks at once. */
export function setYoqaUpdateSettings(settings: YoqaUpdateSettings) {
	return getDesktopRpc().request.setYoqaUpdateSettings(settings);
}
