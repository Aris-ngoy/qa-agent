/** Identifies one Device Session so Disconnect stays off until that session is replaced. */
export function inspectorSessionKey(deviceId: string, connectedAt: number): string {
	return `${deviceId}:${connectedAt}`;
}

/**
 * The Inspector attaches itself when a Device Session is up. It stays off after Disconnect
 * for that same session, and attaches again when the session is a different one.
 */
export function shouldAutoAttach(input: {
	deviceId: string | null;
	connectedAt: number | null;
	attachedDeviceId: string | null;
	suppressedKey: string | null;
}): boolean {
	if (input.deviceId == null || input.connectedAt == null) return false;
	if (input.suppressedKey === inspectorSessionKey(input.deviceId, input.connectedAt)) return false;
	return input.attachedDeviceId !== input.deviceId;
}
