/** True when a runner/Appium error means the Device Session is gone. */
export function isDeviceSessionGone(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /device session ended|session does not exist|invalid session id|no such session|HTTP 410/i.test(
		message,
	);
}
