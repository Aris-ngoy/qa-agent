import { observable } from "@legendapp/state";

const QUERY = "(prefers-reduced-motion: reduce)";

function reducedMotionQuery(): MediaQueryList | null {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
	return window.matchMedia(QUERY);
}

/** The OS "reduce motion" setting, followed live. */
export const prefersReducedMotion$ = observable(reducedMotionQuery()?.matches ?? false);
reducedMotionQuery()?.addEventListener("change", (event) =>
	prefersReducedMotion$.set(event.matches),
);
