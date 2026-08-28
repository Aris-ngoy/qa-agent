import { usableId, usableLabel } from "@/features/inspector/command-snippets";
import type { ScreenElement } from "@yoqa/runner-client";

export type PreferredLocator = "id" | "label";

export type InspectorSelection = {
	/** Tap target in 0–1000 space (element center or raw click). */
	x: number;
	y: number;
	element: ScreenElement | null;
	/** Original click point in 0–1000 (for Change Selector / re-hit-test). */
	pointX: number;
	pointY: number;
	/** Index into candidatesAtPoint for the click. */
	candidateIndex: number;
	/** Which locator chips prefer when both id and label exist. */
	preferredLocator: PreferredLocator;
};

export function elementCenter(element: ScreenElement): { x: number; y: number } {
	return {
		x: Math.round(element.x + element.width / 2),
		y: Math.round(element.y + element.height / 2),
	};
}

function area(el: ScreenElement): number {
	return el.width * el.height;
}

function hasUsableSelector(el: ScreenElement): boolean {
	return Boolean(usableLabel(el) || usableId(el));
}

function containsPoint(el: ScreenElement, x: number, y: number): boolean {
	return x >= el.x && x <= el.x + el.width && y >= el.y && y <= el.y + el.height;
}

function defaultPreferredLocator(element: ScreenElement | null): PreferredLocator {
	if (element && usableId(element)) return "id";
	return "label";
}

function selectionForElement(
	element: ScreenElement,
	point: { x: number; y: number },
	candidateIndex: number,
	preferredLocator?: PreferredLocator,
): InspectorSelection {
	const center = elementCenter(element);
	return {
		x: center.x,
		y: center.y,
		element,
		pointX: point.x,
		pointY: point.y,
		candidateIndex,
		preferredLocator: preferredLocator ?? defaultPreferredLocator(element),
	};
}

/** Screenshot-point selection — no accessibility-tree snap. Used for Control-pick. */
export function pointOnlySelection(point: { x: number; y: number }): InspectorSelection {
	return {
		x: point.x,
		y: point.y,
		element: null,
		pointX: point.x,
		pointY: point.y,
		candidateIndex: 0,
		preferredLocator: "label",
	};
}

/**
 * All elements under a point for Change Selector cycling.
 * Prefer selectable (id/label) nodes when any exist; sort smallest → largest (leaf → parent).
 * If nothing contains the point, return the nearest element (same as hit-test fallback).
 */
export function candidatesAtPoint(
	elements: ScreenElement[],
	x: number,
	y: number,
): ScreenElement[] {
	const containing = elements.filter((el) => containsPoint(el, x, y));
	if (containing.length > 0) {
		const selectable = containing.filter(hasUsableSelector);
		const pool = selectable.length > 0 ? selectable : containing;
		return [...pool].sort((a, b) => area(a) - area(b));
	}

	let best: ScreenElement | null = null;
	let bestDist = Number.POSITIVE_INFINITY;
	for (const el of elements) {
		const c = elementCenter(el);
		const dist = (c.x - x) ** 2 + (c.y - y) ** 2;
		if (dist < bestDist) {
			bestDist = dist;
			best = el;
		}
	}
	return best ? [best] : [];
}

/**
 * Prefer a labeled/id control containing the point (full word/button bounds),
 * expanding same-label leaves to the largest matching sibling; else smallest;
 * else nearest center.
 */
export function hitTestElements(
	elements: ScreenElement[],
	x: number,
	y: number,
): ScreenElement | null {
	const containing = elements.filter((el) => containsPoint(el, x, y));
	if (containing.length > 0) {
		const selectable = containing.filter(hasUsableSelector);
		const pool = selectable.length > 0 ? selectable : containing;
		pool.sort((a, b) => area(a) - area(b));
		const smallest = pool[0];
		if (!smallest) return null;

		const label = usableLabel(smallest);
		if (label) {
			const sameLabel = pool.filter((el) => usableLabel(el) === label);
			sameLabel.sort((a, b) => area(b) - area(a));
			return sameLabel[0] ?? smallest;
		}
		return smallest;
	}

	const nearest = candidatesAtPoint(elements, x, y);
	return nearest[0] ?? null;
}

function indexOfCandidate(candidates: ScreenElement[], element: ScreenElement | null): number {
	if (!element || candidates.length === 0) return 0;
	const idx = candidates.findIndex(
		(c) =>
			c === element ||
			(c.x === element.x &&
				c.y === element.y &&
				c.width === element.width &&
				c.height === element.height &&
				(c.id ?? "") === (element.id ?? "") &&
				(c.label ?? "") === (element.label ?? "") &&
				c.type === element.type),
	);
	return idx >= 0 ? idx : 0;
}

/** Build a selection from a click against the cached tree (local, no network). */
export function selectionFromPoint(
	elements: ScreenElement[],
	point: { x: number; y: number },
): InspectorSelection {
	const element = hitTestElements(elements, point.x, point.y);
	if (!element) return pointOnlySelection(point);
	const candidates = candidatesAtPoint(elements, point.x, point.y);
	return selectionForElement(element, point, indexOfCandidate(candidates, element));
}

/**
 * Cycle Change Selector: when both id and label exist on the current element and
 * preferred is still `id`, switch to `label`; otherwise advance to the next
 * overlapping candidate (leaf → parent) and reset preference to id-when-available.
 */
export function cycleChangeSelector(
	elements: ScreenElement[],
	selection: InspectorSelection,
): InspectorSelection {
	const point = { x: selection.pointX, y: selection.pointY };
	const candidates = candidatesAtPoint(elements, point.x, point.y);
	if (candidates.length === 0) {
		return pointOnlySelection(point);
	}

	const current =
		candidates[Math.min(selection.candidateIndex, candidates.length - 1)] ??
		selection.element ??
		candidates[0];
	if (!current) return pointOnlySelection(point);

	const id = usableId(current);
	const label = usableLabel(current);
	if (id && label && selection.preferredLocator === "id") {
		return selectionForElement(current, point, indexOfCandidate(candidates, current), "label");
	}

	const nextIndex = (indexOfCandidate(candidates, current) + 1) % candidates.length;
	const next = candidates[nextIndex];
	if (!next) return pointOnlySelection(point);
	return selectionForElement(next, point, nextIndex);
}

/** One-line caption for the active locator (shown under the highlight). */
export function activeSelectorCaption(selection: InspectorSelection): string | null {
	const el = selection.element;
	if (!el) return null;
	const id = usableId(el);
	const label = usableLabel(el);
	if (selection.preferredLocator === "id" && id) return `id: ${id}`;
	if (label) return `label: ${label}`;
	if (id) return `id: ${id}`;
	if (el.type) return el.type;
	return null;
}

export function appendScriptLines(script: string, lines: string[]): string {
	const trimmed = script.replace(/\s+$/, "");
	const block = lines.join("\n");
	if (trimmed.length === 0) return `${block}\n`;
	return `${trimmed}\n${block}\n`;
}
