import type { ScreenElement } from "@yoqa/runner-client";

/** True when (x, y) in 0–1000 space sits inside the element's box. */
export function pointInElement(element: ScreenElement, x: number, y: number): boolean {
	return (
		x >= element.x &&
		x <= element.x + element.width &&
		y >= element.y &&
		y <= element.y + element.height
	);
}

/**
 * A tap is accurate when it lands on the intended tree element (id or label),
 * or on any element when the suite does not name one.
 */
export function tapHitsElement(
	elements: readonly ScreenElement[],
	x: number,
	y: number,
	expect?: { id?: string; label?: string },
): boolean {
	const intended = expect?.id
		? elements.filter((el) => el.id === expect.id)
		: expect?.label
			? elements.filter((el) => el.label === expect.label)
			: elements;
	return intended.some((el) => pointInElement(el, x, y));
}
