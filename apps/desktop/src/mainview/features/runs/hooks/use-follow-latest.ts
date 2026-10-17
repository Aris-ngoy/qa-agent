import { isNearBottom } from "@/features/runs/utils/follow-latest";
import { useObservable, useValue } from "@legendapp/state/react";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/** Safety net for engines without `scrollend`: a smooth scroll never takes longer than this. */
const SCROLL_ANIMATION_MAX_MS = 700;

/**
 * Chat-style scrolling: while `active`, glide a scroll container to its newest content whenever
 * `signal` changes. Scrolling up stops following; scrolling back to the end, or `jumpToLatest`,
 * resumes it. `smooth` animates the glide (turn it off for reduced motion).
 */
export function useFollowLatest(active: boolean, signal: unknown, smooth = true) {
	const ref = useRef<HTMLDivElement | null>(null);
	const following$ = useObservable(true);
	const following = useValue(following$);
	// True while our own smooth scroll is in flight: its in-between scroll events are not the user.
	const glidingRef = useRef(false);
	const glideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const setFollow = useCallback((next: boolean) => following$.set(next), [following$]);

	const endGlide = useCallback(() => {
		glidingRef.current = false;
		if (glideTimer.current) clearTimeout(glideTimer.current);
		glideTimer.current = null;
	}, []);

	const scrollToEnd = useCallback(() => {
		const el = ref.current;
		if (!el) return;
		if (!smooth) {
			el.scrollTop = el.scrollHeight;
			return;
		}
		glidingRef.current = true;
		if (glideTimer.current) clearTimeout(glideTimer.current);
		glideTimer.current = setTimeout(endGlide, SCROLL_ANIMATION_MAX_MS);
		el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
	}, [smooth, endGlide]);

	const onScroll = useCallback(() => {
		const el = ref.current;
		if (el && !glidingRef.current) setFollow(isNearBottom(el));
	}, [setFollow]);

	// The user grabbing the list (wheel, touch, keys) cancels the browser's smooth scroll and wins.
	const onUserScroll = useCallback(() => endGlide(), [endGlide]);

	// The browser tells us when our glide has landed.
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const onEnd = () => {
			endGlide();
			setFollow(isNearBottom(el));
		};
		el.addEventListener("scrollend", onEnd);
		return () => el.removeEventListener("scrollend", onEnd);
	}, [endGlide, setFollow]);

	useEffect(() => () => endGlide(), [endGlide]);

	// A run that starts executing begins in follow mode.
	useEffect(() => {
		if (active) setFollow(true);
	}, [active, setFollow]);

	// `signal` is a dependency on purpose: new content is what moves the view.
	// biome-ignore lint/correctness/useExhaustiveDependencies: see above
	useLayoutEffect(() => {
		if (active && following$.peek()) scrollToEnd();
	}, [active, signal, scrollToEnd, following$]);

	const jumpToLatest = useCallback(() => {
		setFollow(true);
		scrollToEnd();
	}, [setFollow, scrollToEnd]);

	return { ref, onScroll, onUserScroll, following, jumpToLatest };
}

/**
 * Which items arrived after the list first appeared. Items already there at first sight (a page
 * opened mid-run, or a finished run) are never "arriving", so only live additions animate in.
 */
export function useArrivingIds(ids: string[], ready: boolean): (id: string) => boolean {
	const knownAtStart = useRef<Set<string> | null>(null);
	if (ready && knownAtStart.current === null) knownAtStart.current = new Set(ids);
	return useCallback((id) => knownAtStart.current !== null && !knownAtStart.current.has(id), []);
}
