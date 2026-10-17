import { type WidthBounds, readPanelWidth, writePanelWidth } from "@/app/resize/panel-width";
import { useCallback, useState } from "react";

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
	const [stored, setStored] = useState(() => readPanelWidth(storageKey));

	const setWidth = useCallback(
		(width: number, options: { persist?: boolean } = {}) => {
			setStored(width);
			if (options.persist) writePanelWidth(storageKey, width);
		},
		[storageKey],
	);

	const reset = useCallback(() => {
		setStored(null);
		writePanelWidth(storageKey, null);
	}, [storageKey]);

	return { width: stored ?? defaultWidth, resized: stored != null, bounds, setWidth, reset };
}
