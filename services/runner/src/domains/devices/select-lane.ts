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
