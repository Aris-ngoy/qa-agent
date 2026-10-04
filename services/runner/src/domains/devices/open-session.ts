import type { DevicePlatform } from "@yoqa/runner-client";
import { createAndroidDirectSession } from "./android-direct-lane";
import { createAppiumSession } from "./appium-lane";
import type { DeviceSession, LaneFactory, LaneName, SessionOptions } from "./lane";
import { availableLanes, selectLane } from "./select-lane";

/** At most one Device Session per device id (Active Session or Run). */
const openByDeviceId = new Map<string, DeviceSession>();

/** Direct is Android-only; iOS stays on Appium until an iOS Direct factory exists. */
export function defaultLanesFor(platform: DevicePlatform): Partial<Record<LaneName, LaneFactory>> {
	return {
		appium: createAppiumSession,
		...(platform === "android" ? { direct: createAndroidDirectSession } : {}),
	};
}

function mergeLanes(
	platform: DevicePlatform,
	lanes: Partial<Record<LaneName, LaneFactory | undefined>>,
): Partial<Record<LaneName, LaneFactory>> {
	const defaults = defaultLanesFor(platform);
	const merged =
		Object.keys(lanes).length > 0 ? { appium: defaults.appium, ...lanes } : { ...defaults };
	const out: Partial<Record<LaneName, LaneFactory>> = {};
	if (merged.appium) out.appium = merged.appium;
	if (merged.direct) out.direct = merged.direct;
	return out;
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
 * Open the one Device Session for a device (`createDeviceSession` in `session.ts` calls this). Any session already open on that device
 * is quit first (ADR-0001), whichever Lane it ran on. The session lives on exactly
 * one Lane for its whole life (ADR-0004). `lanes` lets tests inject a fake lane.
 */
export async function openDeviceSession(
	options: SessionOptions,
	lanes: Partial<Record<LaneName, LaneFactory>> = {},
): Promise<DeviceSession> {
	await releaseExistingSession(options.deviceId);

	const merged = mergeLanes(options.platform, lanes);
	const choice = selectLane({
		requested: options.requestedLane ?? "auto",
		available: availableLanes(merged),
		appCaps: options.appCaps,
		caseCaps: options.caseCaps,
	});

	let opened: DeviceSession;
	let warning = choice.warning;
	try {
		opened = await openOnLane(choice.lane, options, merged);
	} catch (error) {
		if (choice.lane === "direct") {
			const detail = error instanceof Error ? error.message : String(error);
			warning = `Direct lane failed to start; fell back to Appium (${detail})`;
			opened = await openOnLane("appium", options, merged);
		} else {
			throw error;
		}
	}

	const session: DeviceSession = {
		...opened,
		lane: opened.lane,
		...(warning ? { laneWarning: warning } : {}),
		quit: async () => {
			if (openByDeviceId.get(options.deviceId) === session) {
				openByDeviceId.delete(options.deviceId);
			}
			await opened.quit();
		},
	};
	if (warning) {
		console.warn(`[yoqa-runner] ${warning}`);
	}
	openByDeviceId.set(options.deviceId, session);
	return session;
}
