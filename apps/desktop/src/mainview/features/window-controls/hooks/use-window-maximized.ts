import { useObservable, useValue } from "@legendapp/state/react";
import { useEffect } from "react";
import { getWindowState, toggleMaximizeWindow } from "../data/api/window";

/**
 * Whether the window is maximized, re-read on every resize so Snap, double-click and
 * keyboard maximize keep the Maximize / Restore glyph right.
 */
export function useWindowMaximized(): { maximized: boolean; toggle: () => void } {
	const maximized$ = useObservable(false);
	const maximized = useValue(maximized$);

	useEffect(() => {
		let cancelled = false;
		const refresh = () => {
			void getWindowState()
				.then((state) => {
					if (!cancelled) maximized$.set(state.maximized);
				})
				.catch(() => {});
		};
		refresh();
		window.addEventListener("resize", refresh);
		return () => {
			cancelled = true;
			window.removeEventListener("resize", refresh);
		};
	}, [maximized$]);

	const toggle = () => {
		void toggleMaximizeWindow()
			.then((state) => maximized$.set(state.maximized))
			.catch(() => {});
	};

	return { maximized, toggle };
}
