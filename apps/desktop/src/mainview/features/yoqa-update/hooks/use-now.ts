import { useObservable, useValue } from "@legendapp/state/react";
import { useEffect } from "react";

/** Re-read the clock every 30 seconds so "Last checked 5 minutes ago" stays true. */
export function useNow(): number {
	const now$ = useObservable(() => Date.now());
	useEffect(() => {
		const id = setInterval(() => now$.set(Date.now()), 30_000);
		return () => clearInterval(id);
	}, [now$]);
	return useValue(now$);
}
