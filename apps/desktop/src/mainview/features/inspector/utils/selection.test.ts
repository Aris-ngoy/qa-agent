import { describe, expect, test } from "bun:test";
import type { ScreenElement } from "@yoqa/runner-client";
import {
	activeSelectorCaption,
	candidatesAtPoint,
	cycleChangeSelector,
	hitTestElements,
	pointOnlySelection,
	selectionFromPoint,
} from "./selection";

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

describe("candidatesAtPoint", () => {
	test("returns containing selectable nodes smallest → largest", () => {
		const parent = el({
			type: "XCUIElementTypeOther",
			label: "Card",
			id: "card",
			x: 50,
			y: 50,
			width: 300,
			height: 200,
		});
		const child = el({
			type: "XCUIElementTypeButton",
			label: "Continue",
			id: "continue_btn",
			x: 100,
			y: 100,
			width: 100,
			height: 40,
		});
		const candidates = candidatesAtPoint([parent, child], 120, 120);
		expect(candidates).toEqual([child, parent]);
	});
});

describe("cycleChangeSelector", () => {
	const parent = el({
		type: "XCUIElementTypeOther",
		label: "Card",
		id: "card",
		x: 50,
		y: 50,
		width: 300,
		height: 200,
	});
	const child = el({
		type: "XCUIElementTypeButton",
		label: "Continue",
		id: "continue_btn",
		x: 100,
		y: 100,
		width: 100,
		height: 40,
	});
	const elements = [parent, child];

	test("first Change Selector flips id → label on same element", () => {
		const initial = selectionFromPoint(elements, { x: 120, y: 120 });
		expect(initial.element).toBe(child);
		expect(initial.preferredLocator).toBe("id");

		const next = cycleChangeSelector(elements, initial);
		expect(next.element).toBe(child);
		expect(next.preferredLocator).toBe("label");
		expect(activeSelectorCaption(next)).toBe("label: Continue");
	});

	test("second Change Selector advances to parent candidate", () => {
		const initial = selectionFromPoint(elements, { x: 120, y: 120 });
		const afterLabel = cycleChangeSelector(elements, initial);
		const afterParent = cycleChangeSelector(elements, afterLabel);
		expect(afterParent.element).toBe(parent);
		expect(afterParent.preferredLocator).toBe("id");
		expect(activeSelectorCaption(afterParent)).toBe("id: card");
	});

	test("cycles back to leaf after parent", () => {
		let sel = selectionFromPoint(elements, { x: 120, y: 120 });
		sel = cycleChangeSelector(elements, sel); // label on child
		sel = cycleChangeSelector(elements, sel); // parent
		sel = cycleChangeSelector(elements, sel); // label on parent (has both)
		sel = cycleChangeSelector(elements, sel); // back to child
		expect(sel.element).toBe(child);
		expect(sel.preferredLocator).toBe("id");
	});
});

describe("selectionFromPoint", () => {
	test("defaults preferredLocator to id when present", () => {
		const button = el({
			type: "XCUIElementTypeButton",
			label: "Continue",
			id: "continue_btn",
			x: 100,
			y: 100,
			width: 100,
			height: 40,
		});
		const sel = selectionFromPoint([button], { x: 120, y: 120 });
		expect(sel.preferredLocator).toBe("id");
		expect(sel.pointX).toBe(120);
		expect(sel.pointY).toBe(120);
		expect(activeSelectorCaption(sel)).toBe("id: continue_btn");
	});
});

describe("pointOnlySelection", () => {
	test("uses the click point, not a nearby element center", () => {
		const point = { x: 412, y: 887 };
		const sel = pointOnlySelection(point);
		expect(sel.element).toBeNull();
		expect(sel.x).toBe(412);
		expect(sel.y).toBe(887);
		expect(sel.pointX).toBe(412);
		expect(sel.pointY).toBe(887);
		expect(activeSelectorCaption(sel)).toBeNull();
	});
});
