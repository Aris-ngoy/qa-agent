import type { ScreenElement, ScreenSource } from "@yoqa/runner-client";

/**
 * What the Device panel shows of the tree it read. `label` says where the tree came from,
 * null on a Lane that does not say.
 */
export type TreePanel =
	/** The tree's elements, as the Inspector always showed them. */
	| { kind: "tree"; label: string | null }
	/** SpringBoard was read because no app is targeted: the app selector, not its elements. */
	| { kind: "no-target-app"; label: string }
	/** The same, with SpringBoard's elements revealed by the toggle. */
	| { kind: "system"; label: string };

/** "Reading <bundle id> (target)", "Reading <bundle id> (foreground)", or "System (SpringBoard)". */
export function treeSourceLabel(source: ScreenSource): string {
	if (source.kind === "system") return "System (SpringBoard)";
	if (!source.bundleId) return `Reading the ${source.kind} app`;
	return `Reading ${source.bundleId} (${source.kind})`;
}

/**
 * The panel for a tree read from `source`, while the Device Session has a target app or
 * none, and the system toggle is on or off. A system tree read with a target app set is
 * shown as read: the next read is that app's.
 */
export function treePanelFor(input: {
	source: ScreenSource | null | undefined;
	hasTargetApp: boolean;
	showSystem: boolean;
}): TreePanel {
	const { source } = input;
	if (!source) return { kind: "tree", label: null };
	const label = treeSourceLabel(source);
	if (source.kind !== "system" || input.hasTargetApp) return { kind: "tree", label };
	return { kind: input.showSystem ? "system" : "no-target-app", label };
}

/** The elements the panel hit-tests and selects: none while SpringBoard's are hidden. */
export function treePanelElements(panel: TreePanel, elements: ScreenElement[]): ScreenElement[] {
	return panel.kind === "no-target-app" ? [] : elements;
}
