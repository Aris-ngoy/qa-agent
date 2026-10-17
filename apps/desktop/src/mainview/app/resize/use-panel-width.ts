import { type WidthBounds, readPanelWidth, writePanelWidth } from "@/app/resize/panel-width";
import { useObservable, useValue } from "@legendapp/state/react";
import { useCallback } from "react";

export type PanelWidth = {
	/** The width to render, in px. */
	width: number;
	/** True once the user has dragged the panel away from its default width. */
	resized: boolean;
	/** The bounds right now; the max usually depends on how wide the page is. */
	bounds: () => WidthBounds;
	/** Sets the width; `persist` stores it so the panel opens at that width next time. */
	setWidth: (width: number, options?: { persist?: boolean }) => void;
	/** Goes back to the default width and forgets the stored one. */
	reset: () => void;
};

/** A panel width the user can drag, remembered under `storageKey`. Pair it with `ResizeHandle`. */
export function usePanelWidth({
	storageKey,
	defaultWidth,
	bounds,
}: {
	storageKey: string;
	defaultWidth: number;
	bounds: () => WidthBounds;
}): PanelWidth {
	// A function initializes once, on first read, so storage is not read on every render.
	const stored$ = useObservable<number | null>(() => readPanelWidth(storageKey));
	const stored = useValue(stored$);

	const setWidth = useCallback(
		(width: number, options: { persist?: boolean } = {}) => {
			stored$.set(width);
			if (options.persist) writePanelWidth(storageKey, width);
		},
		[storageKey, stored$],
	);

	const reset = useCallback(() => {
		stored$.set(null);
		writePanelWidth(storageKey, null);
	}, [storageKey, stored$]);

	return { width: stored ?? defaultWidth, resized: stored != null, bounds, setWidth, reset };
}
