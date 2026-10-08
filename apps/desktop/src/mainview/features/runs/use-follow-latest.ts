import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** How far from the end still counts as "at the bottom", so a small scroll jitter keeps following. */
const FOLLOW_THRESHOLD_PX = 48;

export function isNearBottom(
	metrics: { scrollHeight: number; scrollTop: number; clientHeight: number },
	threshold: number = FOLLOW_THRESHOLD_PX,
): boolean {
	return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= threshold;
}

/**
 * Chat-style scrolling: while `active`, keep a scroll container pinned to its newest content
 * whenever `signal` changes. Scrolling up stops following; scrolling back to the end, or
 * `jumpToLatest`, resumes it.
 */
export function useFollowLatest(active: boolean, signal: unknown) {
	const ref = useRef<HTMLDivElement | null>(null);
	const followingRef = useRef(true);
	const [following, setFollowing] = useState(true);

	const setFollow = useCallback((next: boolean) => {
		followingRef.current = next;
		setFollowing(next);
	}, []);

	const onScroll = useCallback(() => {
		const el = ref.current;
		if (el) setFollow(isNearBottom(el));
	}, [setFollow]);

	const scrollToEnd = useCallback(() => {
		const el = ref.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, []);

	// A run that starts executing begins in follow mode.
	useEffect(() => {
		if (active) setFollow(true);
	}, [active, setFollow]);

	// `signal` is a dependency on purpose: new content is what moves the view.
	// biome-ignore lint/correctness/useExhaustiveDependencies: see above
	useLayoutEffect(() => {
		if (active && followingRef.current) scrollToEnd();
	}, [active, signal, scrollToEnd]);

	const jumpToLatest = useCallback(() => {
		setFollow(true);
		scrollToEnd();
	}, [setFollow, scrollToEnd]);

	return { ref, onScroll, following, jumpToLatest };
}
