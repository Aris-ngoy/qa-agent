/**
 * Run rows saved while Appium was a Lane may name it. A report never says Appium, so the
 * Lane reads as absent and a warning that mentions it is dropped.
 */
export function reportedLane(lane: string | null): "direct" | undefined {
	return lane === "direct" ? lane : undefined;
}

export function reportedLaneWarning(warning: string | null): string | undefined {
	if (!warning || /appium/i.test(warning)) return undefined;
	return warning;
}
