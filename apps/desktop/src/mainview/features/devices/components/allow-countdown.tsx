import type { AllowWait } from "@/features/devices/data/state/session-bar";
import { allowPrompt, allowSecondsLeft } from "@/features/devices/utils/everyday-browser";
import { useObservable, useValue } from "@legendapp/state/react";
import { useEffect } from "react";

/** "Click Allow in Dia · 58 s": the seconds left until the runner stops waiting on Allow. */
export function AllowCountdown({ wait }: { wait: AllowWait }) {
	const now$ = useObservable(Date.now());
	const now = useValue(now$);
	useEffect(() => {
		now$.set(Date.now());
		const tick = setInterval(() => now$.set(Date.now()), 1_000);
		return () => clearInterval(tick);
	}, [now$]);
	return <>{allowPrompt(wait.browserName, allowSecondsLeft(wait.deadline, now))}</>;
}
