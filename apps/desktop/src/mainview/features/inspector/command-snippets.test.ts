import { describe, expect, test } from "bun:test";
import {
	assertLinesForSelection,
	buildCommandLines,
	buildStepLines,
	defaultSelectorKind,
	inputLinesForSelection,
	isUsableSelectorValue,
	selectorCommands,
	selectorOptions,
	suggestedCommands,
	tapLinesForSelection,
	usableId,
	usableLabel,
} from "./command-snippets";
import type { InspectorSelection } from "./selection";

function selection(
	partial: Partial<InspectorSelection> & {
		element?: InspectorSelection["element"];
	},
): InspectorSelection {
	return {
		x: partial.x ?? 521,
		y: partial.y ?? 500,
		element: partial.element ?? null,
		pointX: partial.pointX ?? partial.x ?? 521,
		pointY: partial.pointY ?? partial.y ?? 500,
		candidateIndex: partial.candidateIndex ?? 0,
		preferredLocator: partial.preferredLocator ?? "id",
	};
}

describe("usable selectors", () => {
	test("rejects URL-like and type-name values", () => {
		expect(isUsableSelectorValue("cashgiraffeSB://game-details/1")).toBe(false);
		expect(isUsableSelectorValue("https://example.com")).toBe(false);
		expect(isUsableSelectorValue("XCUIElementTypeScrollView")).toBe(false);
		expect(isUsableSelectorValue("XCUIElementTypeScrollView", "XCUIElementTypeScrollView")).toBe(
			false,
		);
		expect(isUsableSelectorValue("continue_btn")).toBe(true);
		expect(isUsableSelectorValue("Discover")).toBe(true);
	});

	test("usableId / usableLabel ignore junk", () => {
		expect(
			usableId({
				id: "cashgiraffeSB://game-details/6751056655",
				type: "XCUIElementTypeCell",
			}),
		).toBeNull();
		expect(
			usableLabel({
				label: "XCUIElementTypeScrollView",
				type: "XCUIElementTypeScrollView",
			}),
		).toBeNull();
		expect(usableId({ id: "continue_btn", type: "XCUIElementTypeButton" })).toBe("continue_btn");
		expect(usableLabel({ label: "Continue", type: "XCUIElementTypeButton" })).toBe("Continue");
	});
});

describe("command snippets selector quality", () => {
	test("tap / input never emit type or URL selectors", () => {
		const scrollView = selection({
			element: {
				type: "XCUIElementTypeScrollView",
				label: "XCUIElementTypeScrollView",
				x: 0,
				y: 0,
				width: 1000,
				height: 1000,
			},
		});
		const deeplink = selection({
			element: {
				type: "XCUIElementTypeCell",
				label: "",
				id: "cashgiraffeSB://game-details/6751056655",
				x: 100,
				y: 200,
				width: 800,
				height: 100,
			},
		});

		const scrollTap = tapLinesForSelection(scrollView).join("\n");
		expect(scrollTap).toContain("--x 521");
		expect(scrollTap).toContain("--y 500");
		expect(scrollTap).not.toContain("--id");
		expect(scrollTap).not.toContain("--label");
		expect(scrollTap).not.toContain("XCUIElementTypeScrollView'");

		const deeplinkTap = tapLinesForSelection(deeplink).join("\n");
		expect(deeplinkTap).toContain("--x 521");
		expect(deeplinkTap).not.toContain("--id");
		expect(deeplinkTap).not.toContain("cashgiraffeSB://");

		const input = inputLinesForSelection(scrollView, "hello").join("\n");
		expect(input).toContain("--text 'hello'");
		expect(input).not.toContain("--label");
		expect(input).not.toContain("XCUIElementTypeScrollView'");
	});

	test("assert prompts when label is a type name", () => {
		const scrollView = selection({
			element: {
				type: "XCUIElementTypeScrollView",
				label: "XCUIElementTypeScrollView",
				x: 0,
				y: 0,
				width: 1000,
				height: 1000,
			},
		});

		expect(assertLinesForSelection(scrollView, "visible")).toBeNull();
		expect(assertLinesForSelection(scrollView, "visible", "Discover")).toEqual([
			"yoqa assert visible --text 'Discover'",
		]);

		const suggested = suggestedCommands(scrollView);
		const tapCmd = suggested.find((c) => c.id === "tap" || c.id === "tapPoint");
		expect(tapCmd?.previewLines.join("\n")).not.toContain("--id");
		expect(tapCmd?.previewLines.join("\n")).not.toContain("--label");

		const assertCmd = selectorCommands(scrollView, { defaultAppId: "" }).find(
			(c) => c.id === "assertVisible",
		);
		expect(assertCmd?.needsPrompt).toBe("text");
		expect(assertCmd?.previewLines.join("\n")).toContain("--text '…'");
		expect(assertCmd?.previewLines.join("\n")).not.toContain("XCUIElementTypeScrollView");
	});

	test("stable id/label prefer id chip first; tap uses preferred locator only", () => {
		const button = selection({
			x: 200,
			y: 300,
			preferredLocator: "id",
			element: {
				type: "XCUIElementTypeButton",
				label: "Continue",
				id: "continue_btn",
				x: 100,
				y: 250,
				width: 200,
				height: 100,
			},
		});
		const lines = buildCommandLines(button, "tap").join("\n");
		expect(lines).toContain("# id continue_btn");
		expect(lines).toContain("--id 'continue_btn'");
		expect(lines).not.toContain("--label 'Continue'");
		expect(lines).toContain("--x 200");
		expect(lines).toContain("--y 300");

		const alt = buildCommandLines(button, "tapAlt").join("\n");
		expect(alt).toContain("--label 'Continue'");
		expect(alt).not.toContain("--id 'continue_btn'");

		const suggested = suggestedCommands(button);
		expect(suggested[0]?.id).toBe("tap");
		expect(suggested[0]?.previewLines.join("\n")).toContain("--id 'continue_btn'");
		expect(suggested[1]?.id).toBe("tapAlt");
		expect(suggested[1]?.previewLines.join("\n")).toContain("--label 'Continue'");
	});

	test("preferredLocator label puts label chip first", () => {
		const button = selection({
			preferredLocator: "label",
			element: {
				type: "XCUIElementTypeButton",
				label: "Continue",
				id: "continue_btn",
				x: 100,
				y: 250,
				width: 200,
				height: 100,
			},
		});
		const suggested = suggestedCommands(button);
		expect(suggested[0]?.previewLines.join("\n")).toContain("--label 'Continue'");
		expect(suggested[1]?.previewLines.join("\n")).toContain("--id 'continue_btn'");
	});

	test("point-only selection leads with tap (x,y) and coords-only gestures", () => {
		const point = selection({
			x: 412,
			y: 887,
			element: null,
		});
		const suggested = suggestedCommands(point);
		expect(suggested.map((c) => c.id)).toEqual(["tapPoint", "doubleTap", "longPress", "inputText"]);
		expect(suggested[0]?.previewLines.join("\n")).toContain("--x 412");
		expect(suggested[0]?.previewLines.join("\n")).toContain("--y 887");
		expect(suggested[0]?.previewLines.join("\n")).not.toContain("--id");
		expect(suggested[0]?.previewLines.join("\n")).not.toContain("--label");

		const tap = buildCommandLines(point, "tapPoint").join("\n");
		expect(tap).toContain("yoqa action tap --x 412 --y 887");
		expect(tap).not.toContain("--id");
		expect(tap).not.toContain("--label");

		const doubleTap = buildCommandLines(point, "doubleTap").join("\n");
		expect(doubleTap).toContain("--double");
		expect(doubleTap).toContain("--x 412");
		expect(doubleTap).not.toContain("--id");

		const longPress = buildCommandLines(point, "longPress").join("\n");
		expect(longPress).toContain("--duration 2000");
		expect(longPress).toContain("--y 887");
		expect(longPress).not.toContain("--label");
	});
});

describe("step builder (element dialog)", () => {
	const button = selection({
		x: 500,
		y: 190,
		element: {
			type: "Button",
			label: "Invite a Friend",
			id: "invite_btn",
			x: 400,
			y: 150,
			width: 200,
			height: 80,
		},
	});
	const labelOnly = selection({
		element: { type: "Button", label: "Email", x: 0, y: 0, width: 10, height: 10 },
	});
	const bare = selection({ x: 300, y: 400, element: null });

	test("offers only the selectors the element can supply, point always last", () => {
		expect(selectorOptions(button, []).map((o) => o.kind)).toEqual([
			"label",
			"id",
			"both",
			"point",
		]);
		expect(selectorOptions(labelOnly, []).map((o) => o.kind)).toEqual(["label", "point"]);
		expect(selectorOptions(bare, []).map((o) => o.kind)).toEqual(["point"]);
	});

	test("defaults to id when usable, then label, then point", () => {
		expect(defaultSelectorKind(button)).toBe("id");
		expect(defaultSelectorKind(labelOnly)).toBe("label");
		expect(defaultSelectorKind(bare)).toBe("point");
	});

	test("counts matches in the tree and flags the point selector as fragile", () => {
		const elements = [
			{ type: "Button", label: "Email", x: 0, y: 0, width: 1, height: 1 },
			{ type: "StaticText", label: "Email", x: 0, y: 0, width: 1, height: 1 },
			{ type: "Button", label: "Other", x: 0, y: 0, width: 1, height: 1 },
		];
		const options = selectorOptions(labelOnly, elements);
		expect(options.find((o) => o.kind === "label")?.matches).toBe(2);
		expect(options.find((o) => o.kind === "point")?.matches).toBeNull();
	});

	test("builds tap lines for each selector", () => {
		const line = (selector: "label" | "id" | "both" | "point") =>
			buildStepLines(button, { command: "tap", selector }).at(-1);
		expect(line("label")).toBe("yoqa action tap --label 'Invite a Friend' --x 500 --y 190");
		expect(line("id")).toBe("yoqa action tap --id 'invite_btn' --x 500 --y 190");
		expect(line("both")).toContain("--id 'invite_btn'");
		expect(line("both")).toContain("--label 'Invite a Friend'");
		expect(line("point")).toBe("yoqa action tap --x 500 --y 190");
	});

	test("long press and double tap honour the chosen selector", () => {
		expect(buildStepLines(button, { command: "longPress", selector: "label" }).at(-1)).toContain(
			"--label 'Invite a Friend' --x 500 --y 190 --duration 2000",
		);
		expect(buildStepLines(bare, { command: "doubleTap", selector: "point" }).at(-1)).toContain(
			"--double",
		);
	});

	test("type text targets the chosen selector and needs text", () => {
		expect(buildStepLines(button, { command: "inputText", selector: "point", text: "hi" })).toEqual(
			["# id invite_btn", "yoqa action input --x 500 --y 190 --text 'hi'"],
		);
		expect(buildStepLines(button, { command: "inputText", selector: "label", text: " " })).toEqual(
			[],
		);
	});

	test("assert visible uses the typed text, falling back to the label", () => {
		expect(buildStepLines(button, { command: "assertVisible", selector: "label" })).toEqual([
			"yoqa assert visible --text 'Invite a Friend'",
		]);
		expect(buildStepLines(bare, { command: "assertVisible", selector: "point" })).toEqual([]);
	});
});
