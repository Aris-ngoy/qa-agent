import { describe, expect, test } from "bun:test";
import {
	assertLinesForSelection,
	buildCommandLines,
	inputLinesForSelection,
	isUsableSelectorValue,
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
		const assertCmd = suggested.find((c) => c.id === "assertVisible");
		expect(assertCmd?.needsPrompt).toBe("text");
		expect(assertCmd?.previewLines.join("\n")).toContain("--text '…'");
		expect(assertCmd?.previewLines.join("\n")).not.toContain("XCUIElementTypeScrollView");

		const tapCmd = suggested.find((c) => c.id === "tap" || c.id === "tapPoint");
		expect(tapCmd?.previewLines.join("\n")).not.toContain("--id");
		expect(tapCmd?.previewLines.join("\n")).not.toContain("--label");
	});

	test("stable id/label still appear in tap lines", () => {
		const button = selection({
			x: 200,
			y: 300,
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
		expect(lines).toContain("--label 'Continue'");
		expect(lines).toContain("--x 200");
		expect(lines).toContain("--y 300");
	});
});
