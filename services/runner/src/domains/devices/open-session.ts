import { defaultDirectLane } from "./direct-lane";
import {
	type DeviceSession,
	type LaneFactory,
	type SessionOptions,
	joinLaneWarnings,
} from "./lane";

/** At most one Device Session per device id (Active Session or Run). */
const openByDeviceId = new Map<string, DeviceSession>();

async function releaseExistingSession(deviceId: string): Promise<void> {
	const existing = openByDeviceId.get(deviceId);
	if (!existing) return;
	openByDeviceId.delete(deviceId);
	try {
		await existing.quit();
	} catch (error) {
		console.warn(
			"[yoqa-runner] quit prior Device Session for exclusivity:",
			error instanceof Error ? error.message : error,
		);
	}
}

/**
 * Quit every open Device Session, the Active Session and any a Run holds, each as its Lane
 * quits on disconnect. A session that fails to quit does not stop the others.
 */
export async function quitOpenDeviceSessions(): Promise<void> {
	const sessions = [...openByDeviceId.values()];
	openByDeviceId.clear();
	await Promise.all(
		sessions.map((session) =>
			session.quit().catch((error: unknown) => {
				console.warn(
					"[yoqa-runner] quit Device Session on stop:",
					error instanceof Error ? error.message : error,
				);
			}),
		),
	);
}

/**
 * Open the one Device Session for a device. A Lane is Direct only (ADR-0005), so there is
 * nothing to choose: `lane` is the platform's Direct lane (`direct-lane.ts`), which picks
 * its implementation and falls back inside itself. Any session already open on that
 * device is quit first (ADR-0001). The session lives on exactly one Lane for its whole
 * life. Tests pass `lane` to open on a faked device.
 */
export async function openDeviceSession(
	options: SessionOptions,
	lane: LaneFactory = defaultDirectLane(options.platform),
): Promise<DeviceSession> {
	await releaseExistingSession(options.deviceId);

	// A fallback the Lane reports later lands on the session handed out here, not on the
	// Lane's own object, which this wrapper copies. One it reports while it opens is
	// already on that object's laneWarning, which the copy carries.
	const handedOutRef: { session?: DeviceSession } = {};
	const laneOptions: SessionOptions = {
		...options,
		onLaneWarning: (late) => {
			const session = handedOutRef.session;
			if (!session) return;
			session.laneWarning = joinLaneWarnings(session.laneWarning, late);
			options.onLaneWarning?.(late);
		},
	};
	const opened = await lane(laneOptions);
	const warning = opened.laneWarning;

	const handedOut: DeviceSession = {
		...opened,
		quit: async () => {
			if (openByDeviceId.get(options.deviceId) === handedOut) {
				openByDeviceId.delete(options.deviceId);
			}
			await opened.quit();
		},
	};
	handedOutRef.session = handedOut;
	if (warning) {
		console.warn(`[yoqa-runner] ${warning}`);
	}
	openByDeviceId.set(options.deviceId, handedOut);
	return handedOut;
}
