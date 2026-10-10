import type { DevicePlatform } from "@yoqa/runner-client";
import { startAndroidDevtools } from "./android-devtools";
import { createAndroidDirectSession } from "./android-direct-lane";
import { createIosDirectSession } from "./ios-direct-lane";
import type { LaneFactory } from "./lane";
import {
	type DeviceClass,
	type DirectImplementationInfo,
	directImplementationOrder,
	directOptIn,
} from "./select-lane";
import { type StartYoqaAx, resolveYoqaAxBin, startYoqaAx } from "./yoqa-ax";
import { resolveYoqaSimBin, spawnYoqaSim } from "./yoqa-sim";

/** One way the Direct lane drives a device class (e.g. adb, or a faster `device-android`). */
export type DirectImplementation = DirectImplementationInfo & { open: LaneFactory };

/**
 * Every Direct implementation tried in a failed start, with the warnings from each
 * fallback inside the Direct lane, so the Appium fallback can keep them.
 */
export class DirectLaneStartError extends Error {
	constructor(
		message: string,
		readonly warnings: string[],
	) {
		super(message);
		this.name = "DirectLaneStartError";
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * The Direct lane for one device class. It tries its implementations in order
 * (see `directImplementationOrder`) and falls back once per step, loudly: each
 * fallback adds a Lane warning to the session (ADR-0004). When none starts it
 * throws a `DirectLaneStartError`, and the caller falls back to Appium.
 */
export function createDirectLane(
	implementations: readonly DirectImplementation[],
	optIn?: string,
): LaneFactory {
	return async (options) => {
		const order = directImplementationOrder(implementations, optIn);
		const warnings: string[] = [];
		let lastError: unknown = new Error("No Direct implementation is available");
		for (const [index, impl] of order.entries()) {
			try {
				const session = await impl.open(options);
				if (warnings.length === 0) return session;
				const laneWarning = [...warnings, session.laneWarning].filter(Boolean).join("; ");
				return { ...session, laneWarning };
			} catch (error) {
				lastError = error;
				const next = order[index + 1];
				if (next) {
					warnings.push(
						`Direct implementation ${impl.name} failed to start; fell back to ${next.name} (${errorMessage(error)})`,
					);
				}
			}
		}
		throw new DirectLaneStartError(errorMessage(lastError), warnings);
	};
}

/** Physical iOS has no Direct device class yet; it stays on Appium unless `direct` is requested. */
export function deviceClassFor(platform: DevicePlatform): DeviceClass {
	return platform === "android" ? "android" : "ios-simulator";
}

/**
 * Direct implementations per device class, newest first. A new one is added at the
 * front without `promoted`, so it runs only when opted in until it clears the gate.
 */
export const DIRECT_IMPLEMENTATIONS: Record<DeviceClass, DirectImplementation[]> = {
	android: [
		{
			// adb with capture-frame served from a background `screencap` loop (#237), and the
			// tree from the instrumentation helper, else `uiautomator dump` (#238).
			name: "device-android",
			open: (options) =>
				createAndroidDirectSession(options, {
					backgroundCapture: {},
					devtools: (context) => startAndroidDevtools(context),
				}),
		},
		{ name: "adb", promoted: true, open: (options) => createAndroidDirectSession(options) },
	],
	"ios-simulator": [
		{
			// idb_companion, with frames and input from our resident `yoqa-sim` (#239, #240), and
			// the tree from `yoqa-ax` inside the simulator (#242, #243). Without `yoqa-ax` it runs
			// degraded, with the tree on idb_companion. Promoted by #245: see
			// docs/devices/ios-sim-promotion.md for the benchmark.
			name: "device-sim",
			promoted: true,
			open: async (options) => {
				const bin = resolveYoqaSimBin();
				if (!bin)
					throw new Error("yoqa-sim is not built (native/yoqa-sim) and YOQA_SIM_BIN is unset");
				const axBin = resolveYoqaAxBin();
				const yoqaAx: StartYoqaAx = axBin
					? (udid) => startYoqaAx(udid, { bin: axBin })
					: async () => {
							throw new Error("yoqa-ax is not built (native/yoqa-ax) and YOQA_AX_BIN is unset");
						};
				return createIosDirectSession(options, {
					yoqaSim: (udid) => spawnYoqaSim(udid, { command: [bin] }),
					yoqaAx,
				});
			},
		},
		{ name: "idb", promoted: true, open: (options) => createIosDirectSession(options) },
	],
};

/** The default Direct lane for a platform, honoring its device class's opt-in env var. */
export function defaultDirectLane(platform: DevicePlatform): LaneFactory {
	const deviceClass = deviceClassFor(platform);
	return createDirectLane(DIRECT_IMPLEMENTATIONS[deviceClass], directOptIn(deviceClass));
}
