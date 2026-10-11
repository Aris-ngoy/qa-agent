import { RunnerRequestError } from "@yoqa/runner-client";

/**
 * A 410 the webview kept from an earlier reply: no `chain`, and no runner pid. The phone
 * can already be back. It is not a reason to drop the Device Session.
 */
export function isStaleSessionReply(error: unknown): boolean {
	if (!(error instanceof RunnerRequestError) || error.status !== 410) return false;
	const body = error.body as { chain?: unknown } | null;
	return !Array.isArray(body?.chain) && error.answeredBy.runnerPid == null;
}

/** True when a runner/Appium error means the Device Session is gone. */
export function isDeviceSessionGone(error: unknown): boolean {
	if (isStaleSessionReply(error)) return false;
	const message = error instanceof Error ? error.message : String(error);
	return /device session ended|session does not exist|invalid session id|no such session|HTTP 410/i.test(
		message,
	);
}

/**
 * True when the runner says the device is not answering (503). The Inspector Session stays
 * on that answer, including past the grace window. A gesture's 410 is what ends the Device
 * Session.
 */
export function isDeviceUnreachable(error: unknown): boolean {
	if (!(error instanceof RunnerRequestError) || error.status !== 503) return false;
	const body = error.body as { error?: unknown } | null;
	return body?.error === "Device unreachable";
}
