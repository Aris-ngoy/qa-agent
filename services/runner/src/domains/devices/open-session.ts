import { createAppiumSession } from "./appium-lane";
import type { DeviceSession, LaneFactory, LaneName, SessionOptions } from "./lane";

/** At most one Device Session per device id (Active Session or Run). */
const openByDeviceId = new Map<string, DeviceSession>();

const defaultLanes: Record<LaneName, LaneFactory> = {
	appium: createAppiumSession,
};

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
 * Open the one Device Session for a device (`createDeviceSession` in `session.ts` calls this). Any session already open on that device
 * is quit first (ADR-0001), whichever Lane it ran on. The session lives on exactly
 * one Lane for its whole life (ADR-0004); today that is always Appium.
 * `lanes` lets tests inject a fake lane.
 */
export async function openDeviceSession(
	options: SessionOptions,
	lanes: Partial<Record<LaneName, LaneFactory>> = {},
): Promise<DeviceSession> {
	await releaseExistingSession(options.deviceId);

	const laneName: LaneName = "appium";
	const factory = lanes[laneName] ?? defaultLanes[laneName];
	const opened = await factory(options);

	const session: DeviceSession = {
		...opened,
		quit: async () => {
			if (openByDeviceId.get(options.deviceId) === session) {
				openByDeviceId.delete(options.deviceId);
			}
			await opened.quit();
		},
	};
	openByDeviceId.set(options.deviceId, session);
	return session;
}
