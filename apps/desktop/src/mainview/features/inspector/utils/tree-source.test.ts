import { describe, expect, test } from "bun:test";
import type { ScreenElement, ScreenSource } from "@yoqa/runner-client";
import { type TreePanel, treePanelElements, treePanelFor, treeSourceLabel } from "./tree-source";

const TARGET: ScreenSource = { kind: "target", bundleId: "com.example.testemall" };
const FOREGROUND: ScreenSource = { kind: "foreground", bundleId: "com.example.notes" };
const SYSTEM: ScreenSource = { kind: "system" };

describe("treePanelFor", () => {
	const cases: Array<{
		source: ScreenSource | null;
		hasTargetApp: boolean;
		showSystem: boolean;
		panel: TreePanel;
	}> = [
		// Other Lanes say nothing: the tree shows as it always has.
		{ source: null, hasTargetApp: false, showSystem: false, panel: { kind: "tree", label: null } },
		{ source: null, hasTargetApp: false, showSystem: true, panel: { kind: "tree", label: null } },
		{ source: null, hasTargetApp: true, showSystem: false, panel: { kind: "tree", label: null } },
		{ source: null, hasTargetApp: true, showSystem: true, panel: { kind: "tree", label: null } },
		...[false, true].flatMap((hasTargetApp) =>
			[false, true].flatMap((showSystem) => [
				{
					source: TARGET,
					hasTargetApp,
					showSystem,
					panel: { kind: "tree", label: "Reading com.example.testemall (target)" } as const,
				},
				{
					source: FOREGROUND,
					hasTargetApp,
					showSystem,
					panel: { kind: "tree", label: "Reading com.example.notes (foreground)" } as const,
				},
			]),
		),
		// SpringBoard with no target app: say so, its elements only behind the toggle.
		{
			source: SYSTEM,
			hasTargetApp: false,
			showSystem: false,
			panel: { kind: "no-target-app", label: "System (SpringBoard)" },
		},
		{
			source: SYSTEM,
			hasTargetApp: false,
			showSystem: true,
			panel: { kind: "system", label: "System (SpringBoard)" },
		},
		// A target app is set, so the next read is that app's: show what was read, labelled.
		{
			source: SYSTEM,
			hasTargetApp: true,
			showSystem: false,
			panel: { kind: "tree", label: "System (SpringBoard)" },
		},
		{
			source: SYSTEM,
			hasTargetApp: true,
			showSystem: true,
			panel: { kind: "tree", label: "System (SpringBoard)" },
		},
	];

	for (const { source, hasTargetApp, showSystem, panel } of cases) {
		test(`${source?.kind ?? "no source"}, ${hasTargetApp ? "a" : "no"} target app, toggle ${showSystem ? "on" : "off"}: ${panel.kind}`, () => {
			expect(treePanelFor({ source, hasTargetApp, showSystem })).toEqual(panel);
		});
	}

	test("covers every source, target-app state and toggle", () => {
		expect(cases).toHaveLength(4 * 2 * 2);
	});
});

describe("treeSourceLabel", () => {
	test("names the app read, or the kind when the runner names none", () => {
		expect(treeSourceLabel({ kind: "target" })).toBe("Reading the target app");
		expect(treeSourceLabel({ kind: "foreground" })).toBe("Reading the foreground app");
	});
});

describe("treePanelElements", () => {
	const springBoard: ScreenElement[] = [
		{
			type: "Window",
			label: "",
			id: "SBSwitcherWindow:Main",
			x: 0,
			y: 0,
			width: 1000,
			height: 1000,
		},
	];

	test("hides SpringBoard's elements until the toggle reveals them", () => {
		expect(
			treePanelElements({ kind: "no-target-app", label: "System (SpringBoard)" }, springBoard),
		).toEqual([]);
		expect(treePanelElements({ kind: "system", label: "System (SpringBoard)" }, springBoard)).toBe(
			springBoard,
		);
		expect(treePanelElements({ kind: "tree", label: null }, springBoard)).toBe(springBoard);
	});
});
