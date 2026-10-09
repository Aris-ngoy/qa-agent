import type { LaneName } from "./lane";

export type LaneRequest = LaneName | "auto";

export type LaneChoice = {
	lane: LaneName;
	fallback: boolean;
	reason?: "capabilities" | "unsupported";
	warning?: string;
};

export function hasCustomCapabilities(
	appCaps: Array<{ key: string }>,
	caseCaps: Array<{ key: string }>,
): boolean {
	return [...appCaps, ...caseCaps].some((cap) => cap.key.trim().length > 0);
}

/**
 * Pick the Lane for a Device Session (ADR-0004). Custom Appium capabilities always
 * pin Appium. Direct is chosen automatically when that factory exists; a forced
 * Direct request falls back to Appium when it cannot start.
 */
export function selectLane(input: {
	requested: LaneRequest;
	available: readonly LaneName[];
	appCaps: Array<{ key: string }>;
	caseCaps: Array<{ key: string }>;
}): LaneChoice {
	const available = new Set(input.available);
	if (hasCustomCapabilities(input.appCaps, input.caseCaps)) {
		return {
			lane: "appium",
			fallback: false,
			reason: "capabilities",
			warning: "Custom Appium capabilities pin the Appium lane",
		};
	}
	if (input.requested === "appium") {
		return { lane: "appium", fallback: false };
	}
	if (input.requested === "direct" || input.requested === "auto") {
		if (available.has("direct")) {
			return { lane: "direct", fallback: false };
		}
		if (input.requested === "direct") {
			return {
				lane: "appium",
				fallback: true,
				reason: "unsupported",
				warning: "Direct lane is not available; fell back to Appium",
			};
		}
	}
	return { lane: "appium", fallback: false };
}

export function availableLanes(factories: Partial<Record<LaneName, unknown>>): LaneName[] {
	const names: LaneName[] = [];
	if (factories.appium) names.push("appium");
	if (factories.direct) names.push("direct");
	if (!names.includes("appium")) names.unshift("appium");
	return names;
}

/**
 * A class of device the Direct lane serves. Each class has its own implementations,
 * newest first (`device-android` before adb, `device-sim` before idb_companion).
 */
export type DeviceClass = "android" | "ios-simulator";

/** One way the Direct lane can drive a device class. Only `name` and `promoted` matter here. */
export type DirectImplementationInfo = {
	name: string;
	/** Cleared the benchmark gate (ADR-0004): used without opting in. */
	promoted?: boolean;
};

/**
 * The Direct implementations to try, in order, for one device class. `implementations`
 * is newest first. Promoted ones are tried by default; an opt-in name starts the list
 * at that implementation (new or existing), followed by the promoted ones after it.
 * So opting into the existing implementation rolls a promoted new one back.
 */
export function directImplementationOrder<T extends DirectImplementationInfo>(
	implementations: readonly T[],
	optIn?: string,
): T[] {
	const start = optIn ? implementations.findIndex((impl) => impl.name === optIn) : -1;
	if (start < 0) return implementations.filter((impl) => impl.promoted);
	const [chosen, ...rest] = implementations.slice(start);
	return chosen ? [chosen, ...rest.filter((impl) => impl.promoted)] : [];
}

const OPT_IN_ENV: Record<DeviceClass, string> = {
	android: "YOQA_DIRECT_ANDROID",
	"ios-simulator": "YOQA_DIRECT_IOS_SIMULATOR",
};

/** The Direct implementation a device class is opted into (`YOQA_DIRECT_ANDROID=device-android`). */
export function directOptIn(
	deviceClass: DeviceClass,
	env: Record<string, string | undefined> = process.env,
): string | undefined {
	const value = env[OPT_IN_ENV[deviceClass]]?.trim();
	return value ? value : undefined;
}
