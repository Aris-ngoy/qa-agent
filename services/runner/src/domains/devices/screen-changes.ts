/** How the changes of a page become screen-changed signals. */
export type ScreenChangeTiming = {
	/** A signal waits until nothing has changed for this long. */
	quietMs: number;
	/** A page that never goes quiet (an animation, a blinking caret) still signals this often. */
	maxWaitMs: number;
};

export type ScreenChanges = {
	/** Something on the page changed: a navigation, a scroll, a painted frame, an Action. */
	changed: () => void;
	/** No signal after this, even for a change already seen. */
	stop: () => void;
};

/**
 * Debounce a page's changes into screen-changed signals, so a page loading or a scroll's
 * frames is one re-read of the Screen, not one per event.
 */
export function debounceScreenChanges(
	signal: () => void,
	{ quietMs, maxWaitMs }: ScreenChangeTiming,
): ScreenChanges {
	let timer: ReturnType<typeof setTimeout> | undefined;
	/** When the first change not yet signalled came; null when every change has been. */
	let pendingSince: number | null = null;
	let stopped = false;
	const fire = () => {
		timer = undefined;
		pendingSince = null;
		if (!stopped) signal();
	};
	return {
		changed: () => {
			if (stopped) return;
			const now = performance.now();
			pendingSince ??= now;
			clearTimeout(timer);
			timer = setTimeout(fire, Math.max(0, Math.min(quietMs, pendingSince + maxWaitMs - now)));
		},
		stop: () => {
			stopped = true;
			clearTimeout(timer);
		},
	};
}
