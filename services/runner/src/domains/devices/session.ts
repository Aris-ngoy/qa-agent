import type { DeviceSession, LaneFactory, LaneName, SessionOptions } from "./lane";
import { openDeviceSession } from "./open-session";

export { mergeCapabilities } from "./appium-lane";
export {
	type CapturedFrame,
	DeadSessionError,
	type DeviceSession,
	type LaneFactory,
	type LaneName,
	type LiveStream,
	type PointerPhase,
	type SessionOptions,
	isDeadSessionError,
} from "./lane";

/** Open the one Device Session for a device on its Lane. See `openDeviceSession`. */
export function createDeviceSession(
	options: SessionOptions,
	lanes: Partial<Record<LaneName, LaneFactory>> = {},
): Promise<DeviceSession> {
	return openDeviceSession(options, lanes);
}
