import type { Application } from "@/features/apps/data/api/apps";
import type { SelectedDevice } from "@/features/devices/data/state/session-bar";
import { viewportFor } from "@/features/devices/utils/web-device";
import {
	type ActiveDeviceResponse,
	type ConnectDeviceRequest,
	type DevicePlatform,
	type LaneName,
	type RetargetDeviceRequest,
	appStartTarget,
	startTargetRequest,
} from "@yoqa/runner-client";

type SessionHold = Pick<ActiveDeviceResponse, "deviceId" | "connectedAt" | "heldByRun">;

/**
 * The app a session on `platform` targets, as connect and retarget requests name it: the
 * App's start target in the field the runner's `targetAppFor` reads for that platform.
 * Empty when the app has no id for that platform.
 */
export function appTargetFor(
	platform: DevicePlatform,
	app: Pick<Application, "iosBundleId" | "androidApplicationId" | "webUrl"> | null | undefined,
): RetargetDeviceRequest {
	return startTargetRequest(platform, appStartTarget(app, platform));
}

/**
 * The connect for `target`: the selected app's start target, and on web the Viewport preset
 * the session emulates (desktop unless another was chosen).
 */
export function connectRequestFor(
	target: Pick<SelectedDevice, "id" | "platform" | "viewport">,
	app: Pick<Application, "iosBundleId" | "androidApplicationId" | "webUrl"> | null | undefined,
	lane?: LaneName,
): ConnectDeviceRequest {
	const viewport = viewportFor(target.platform, target.viewport);
	return {
		deviceId: target.id,
		platform: target.platform,
		...appTargetFor(target.platform, app),
		...(lane ? { lane } : {}),
		...(viewport ? { viewport } : {}),
	};
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
