type WidthStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type WidthBounds = { min: number; max: number };

/** Arrow keys move the handle this far; Shift moves it further. */
export const KEY_STEP_PX = 16;
export const KEY_STEP_LARGE_PX = 64;

function defaultStorage(): WidthStorage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

/** Keeps a width inside its bounds; `min` wins when the room is smaller than the minimum. */
export function clampWidth(width: number, { min, max }: WidthBounds): number {
	return Math.round(Math.max(min, Math.min(max, width)));
}

/**
 * The width after dragging the handle `deltaX` px. A handle on the panel's end edge grows it when
 * dragged right; one on its start edge (a panel on the right of the page) grows it when dragged left.
 */
export function widthFromDrag(
	startWidth: number,
	deltaX: number,
	edge: "start" | "end",
	bounds: WidthBounds,
): number {
	return clampWidth(startWidth + (edge === "end" ? deltaX : -deltaX), bounds);
}

/** The width a key press on the handle asks for, or null for keys the handle ignores. */
export function widthFromKey(
	width: number,
	key: string,
	shiftKey: boolean,
	edge: "start" | "end",
	bounds: WidthBounds,
): number | null {
	const step = shiftKey ? KEY_STEP_LARGE_PX : KEY_STEP_PX;
	const grow = edge === "end" ? "ArrowRight" : "ArrowLeft";
	const shrink = edge === "end" ? "ArrowLeft" : "ArrowRight";
	if (key === grow) return clampWidth(width + step, bounds);
	if (key === shrink) return clampWidth(width - step, bounds);
	if (key === "Home") return bounds.min;
	if (key === "End") return Math.max(bounds.min, Math.round(bounds.max));
	return null;
}

export function readPanelWidth(
	key: string,
	storage: WidthStorage | null = defaultStorage(),
): number | null {
	try {
		const raw = Number(storage?.getItem(key));
		return Number.isFinite(raw) && raw > 0 ? raw : null;
	} catch {
		return null;
	}
}

/** Stores a width, or forgets it (`null`) so the panel goes back to its default. */
export function writePanelWidth(
	key: string,
	width: number | null,
	storage: WidthStorage | null = defaultStorage(),
): void {
	try {
		if (width == null) storage?.removeItem(key);
		else storage?.setItem(key, String(Math.round(width)));
	} catch {
		// ignore storage failures in restricted webviews
	}
}
