import { RunnerRequestError } from "@yoqa/runner-client";

/** True when a runner/Appium error means the Device Session is gone. */
export function isDeviceSessionGone(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /device session ended|session does not exist|invalid session id|no such session|HTTP 410/i.test(
		message,
	);
}

/**
 * True when the runner says the device is briefly unreachable (an Unreachable Session): it
 * keeps the session through its grace window and answers 410 if the device does not return.
 */
export function isDeviceUnreachable(error: unknown): boolean {
	if (!(error instanceof RunnerRequestError) || error.status !== 503) return false;
	const body = error.body as { error?: unknown } | null;
	return body?.error === "Device unreachable";
}
