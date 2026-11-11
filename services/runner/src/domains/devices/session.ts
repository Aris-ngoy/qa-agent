/**
 * The Device Session's interface, for code outside the Lanes. Open one with
 * `openDeviceSession` (`open-session.ts`).
 */
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
