import type { ActiveDeviceResponse } from "@yoqa/runner-client";

type SessionHold = Pick<ActiveDeviceResponse, "deviceId" | "connectedAt" | "heldByRun">;

/**
 * Whether to point the Active Session back at the selected app now: a Run held this same
 * session and has let it go, and that Run was for another app (or its app is unknown).
 * A new connection needs nothing, since connecting already uses the selected app.
 */
export function retargetsAfterRun(
	previous: SessionHold | null,
	current: SessionHold | null,
	runAppId: string | null | undefined,
	selectedAppId: string | null | undefined,
): boolean {
	if (!previous?.heldByRun || !current || current.heldByRun || !selectedAppId) return false;
	const sameSession =
		previous.deviceId === current.deviceId && previous.connectedAt === current.connectedAt;
	return sameSession && runAppId !== selectedAppId;
}
