import { type CSSProperties, useEffect, useRef, useState } from "react";

/**
 * Returns true once after `ready` becomes true, so enter animations
 * run only on the first successful load (not on filter/refetch).
 */
export function useEnterOnce(ready: boolean): boolean {
	const [shouldAnimate, setShouldAnimate] = useState(false);
	const didAnimate = useRef(false);

	useEffect(() => {
		if (!ready || didAnimate.current) return;
		didAnimate.current = true;
		setShouldAnimate(true);
	}, [ready]);

	return shouldAnimate;
}

export function staggerStyle(index: number, animate: boolean): CSSProperties | undefined {
	if (!animate) return undefined;
	return { ["--stagger" as string]: Math.min(index, 8) } as CSSProperties;
}
