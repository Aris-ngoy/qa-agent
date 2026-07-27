import type { ScreenElement } from "@yoqa/runner-client";

export type InspectorSelection = {
	/** Tap target in 0–1000 space (element center or raw click). */
	x: number;
	y: number;
	element: ScreenElement | null;
};

export function elementCenter(element: ScreenElement): { x: number; y: number } {
	return {
		x: Math.round(element.x + element.width / 2),
		y: Math.round(element.y + element.height / 2),
	};
}

/** Prefer the smallest element containing the point; else nearest center. */
export function hitTestElements(
	elements: ScreenElement[],
	x: number,
	y: number,
): ScreenElement | null {
	const containing = elements.filter(
		(el) => x >= el.x && x <= el.x + el.width && y >= el.y && y <= el.y + el.height,
	);
	if (containing.length > 0) {
		containing.sort((a, b) => a.width * a.height - b.width * b.height);
		return containing[0] ?? null;
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
	return best;
}

export function appendScriptLines(script: string, lines: string[]): string {
	const trimmed = script.replace(/\s+$/, "");
	const block = lines.join("\n");
	if (trimmed.length === 0) return `${block}\n`;
	return `${trimmed}\n${block}\n`;
}
