import { describe, expect, test } from "bun:test";
import type { ScreenElement } from "@yoqa/runner-client";
import { hitTestElements } from "./selection";

function el(
	partial: Partial<ScreenElement> & Pick<ScreenElement, "type" | "x" | "y" | "width" | "height">,
): ScreenElement {
	return {
		label: partial.label ?? "",
		...partial,
	};
}

describe("hitTestElements", () => {
	test("unlabeled tiny leaf inside labeled button → button", () => {
		const button = el({
			type: "XCUIElementTypeButton",
			label: "Continue",
			x: 100,
			y: 400,
			width: 200,
			height: 80,
		});
		const icon = el({
			type: "XCUIElementTypeImage",
			label: "",
			x: 140,
			y: 420,
			width: 20,
			height: 20,
		});
		const hit = hitTestElements([button, icon], 150, 430);
		expect(hit).toBe(button);
	});

	test("small labeled text + larger same-label button → button", () => {
		const button = el({
			type: "XCUIElementTypeButton",
			label: "Continue",
			x: 100,
			y: 400,
			width: 200,
			height: 80,
		});
		const text = el({
			type: "XCUIElementTypeStaticText",
			label: "Continue",
			x: 120,
			y: 420,
			width: 80,
			height: 30,
		});
		const hit = hitTestElements([button, text], 150, 430);
		expect(hit).toBe(button);
	});

	test("only unlabeled nodes → smallest", () => {
		const large = el({
			type: "XCUIElementTypeOther",
			label: "",
			x: 0,
			y: 0,
			width: 500,
			height: 500,
		});
		const small = el({
			type: "XCUIElementTypeOther",
			label: "",
			x: 100,
			y: 100,
			width: 40,
			height: 40,
		});
		const hit = hitTestElements([large, small], 120, 120);
		expect(hit).toBe(small);
	});

	test("no containing → nearest center", () => {
		const near = el({
			type: "XCUIElementTypeButton",
			label: "A",
			x: 200,
			y: 200,
			width: 40,
			height: 40,
		});
		const far = el({
			type: "XCUIElementTypeButton",
			label: "B",
			x: 800,
			y: 800,
			width: 40,
			height: 40,
		});
		const hit = hitTestElements([near, far], 250, 250);
		expect(hit).toBe(near);
	});

	test("ignores URL-like labels when preferring selectable candidates", () => {
		const junk = el({
			type: "XCUIElementTypeCell",
			label: "myapp://path",
			x: 100,
			y: 100,
			width: 50,
			height: 50,
		});
		const button = el({
			type: "XCUIElementTypeButton",
			label: "Open",
			x: 90,
			y: 90,
			width: 120,
			height: 80,
		});
		const hit = hitTestElements([junk, button], 120, 120);
		expect(hit).toBe(button);
	});
});
