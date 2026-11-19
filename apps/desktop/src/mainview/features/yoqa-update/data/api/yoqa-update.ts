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
