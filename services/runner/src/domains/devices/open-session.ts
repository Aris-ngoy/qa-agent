import type { DevicePlatform } from "@yoqa/runner-client";
import { defaultDirectLane } from "./direct-lane";
import {
	type DeviceSession,
	type LaneFactory,
	type LaneName,
	type SessionOptions,
	joinLaneWarnings,
} from "./lane";
import { availableLanes, selectLane } from "./select-lane";

/** At most one Device Session per device id (Active Session or Run). */
const openByDeviceId = new Map<string, DeviceSession>();

/**
 * Direct: Android over adb, iOS simulator over idb_companion, a cabled iPhone over
 * `YoqaRunner`, a Chromium browser over CDP, each picking its implementation inside the
 * Direct lane (`direct-lane.ts`).
 */
export function defaultLanesFor(platform: DevicePlatform): Partial<Record<LaneName, LaneFactory>> {
	switch (platform) {
		case "android":
		case "ios":
		case "web":
			return { direct: defaultDirectLane(platform) };
	}
}

function mergeLanes(
	platform: DevicePlatform,
	lanes: Partial<Record<LaneName, LaneFactory | undefined>>,
): Partial<Record<LaneName, LaneFactory>> {
	const defaults = defaultLanesFor(platform);
	const merged = Object.keys(lanes).length > 0 ? lanes : defaults;
	return merged.direct ? { direct: merged.direct } : {};
}

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

async function openOnLane(
	laneName: LaneName,
	options: SessionOptions,
	lanes: Partial<Record<LaneName, LaneFactory>>,
): Promise<DeviceSession> {
	const factory = lanes[laneName] ?? defaultLanesFor(options.platform)[laneName];
	if (!factory) {
		throw new Error(`No factory registered for the ${laneName} lane`);
	}
	return factory(options);
}

/**
 * Open the one Device Session for a device (`createDeviceSession` in `session.ts` calls this).
 * The Lane is chosen before any session is quit, so a connect that cannot open Direct fails
 * without touching the current one. Any session already open on that device is then quit
 * (ADR-0001) before the new one starts, whichever Lane it ran on. The session lives
 * on exactly one Lane for its whole life. `lanes` lets tests inject a fake lane.
 */
export async function openDeviceSession(
	options: SessionOptions,
	lanes: Partial<Record<LaneName, LaneFactory>> = {},
): Promise<DeviceSession> {
	const merged = mergeLanes(options.platform, lanes);
	const choice = selectLane({
		requested: options.requestedLane ?? "auto",
		available: availableLanes(merged),
	});
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
	const opened = await openOnLane(choice.lane, laneOptions, merged);
	const warning = [choice.warning, opened.laneWarning].filter(Boolean).join("; ") || undefined;

	const handedOut: DeviceSession = {
		...opened,
		lane: opened.lane,
		...(warning ? { laneWarning: warning } : {}),
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
