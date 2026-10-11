/** True when the Inspector should pick a raw screenshot x,y instead of hit-testing. */
export function isPickPointModifier(event: { ctrlKey: boolean }): boolean {
	return event.ctrlKey;
}

/** Map a pointer position onto a displayed screenshot as a 0–1000 grid. */
export function coordsFromImageRect(
	rect: { left: number; top: number; width: number; height: number },
	clientX: number,
	clientY: number,
): { x: number; y: number } | null {
	if (rect.width <= 0 || rect.height <= 0) return null;
	const x = Math.round(((clientX - rect.left) / rect.width) * 1000);
	const y = Math.round(((clientY - rect.top) / rect.height) * 1000);
	return {
		x: Math.min(1000, Math.max(0, x)),
		y: Math.min(1000, Math.max(0, y)),
	};
}
