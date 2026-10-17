export type BootPhase = "starting" | "checking" | "ready" | "error";

/** The splash and its crossfade into the app. */
export type BootState = {
	phase: BootPhase;
	message: string | null;
	/** Bumped by Retry to start the boot checks again. */
	attempt: number;
	ready: boolean;
	splashMounted: boolean;
	splashExiting: boolean;
	appVisible: boolean;
};

export function initialBootState(attempt = 0): BootState {
	return {
		phase: "starting",
		message: null,
		attempt,
		ready: false,
		splashMounted: true,
		splashExiting: false,
		appVisible: false,
	};
}
