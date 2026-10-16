import type { Application } from "@/features/apps/context";
import {
	type ActiveDeviceResponse,
	type RetargetDeviceRequest,
	appStartTarget,
	startTargetRequest,
} from "@yoqa/runner-client";
import type { DevicePlatform } from "./select-device-modal";

type SessionHold = Pick<ActiveDeviceResponse, "deviceId" | "connectedAt" | "heldByRun">;

/**
 * The app a session on `platform` targets, as connect and retarget requests name it: the
 * App's start target in the field its platform reads (as the runner's `targetAppFor` reads them).
 * Empty when the app has no id for that platform.
 */
export function appTargetFor(
	platform: DevicePlatform,
	app: Pick<Application, "iosBundleId" | "androidApplicationId"> | null | undefined,
): RetargetDeviceRequest {
	return startTargetRequest(platform, appStartTarget(app, platform));
}

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
