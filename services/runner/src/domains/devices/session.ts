/**
 * Device Session — Argent backend (visual-first).
 * This path is the stable import for callers; the implementation lives in
 * `domains/argent/session.ts`. Argent has no named sessions: the transport
 * is per device (`--udid`) and screenshots are the primary read.
 */
export {
	createDeviceSession,
	DeadSessionError,
	isDeadSessionError,
	shouldAutoInstallRunnerOnConnect,
	withDeviceInUseTakeover,
} from "../argent/session";
export type {
	CapturedFrame,
	DeviceSession,
	PointerPhase,
	SessionOptions,
	SnapshotNode,
} from "../argent/session";
