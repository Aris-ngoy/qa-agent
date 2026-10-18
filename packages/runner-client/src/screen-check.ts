import type { ScreenElement } from "./schemas";
import { screenHasText } from "./shell-script";

/** Delay between Screen reads while a check waits. */
export const SCREEN_CHECK_POLL_MS = 400;

export type CheckScreenOptions = {
	/** One read of the cleaned Screen tree. */
	readScreen: () => Promise<{ elements?: ScreenElement[] }>;
	text: string;
	assertion: "visible" | "not-visible";
	timeoutMs: number;
	/** Default `SCREEN_CHECK_POLL_MS`. */
	pollMs?: number;
	sleep: (ms: number) => Promise<void>;
	now: () => number;
	isAborted?: () => boolean;
	/** A read error that ends the check at once instead of meaning "not there yet". */
	isDeadSession?: (error: unknown) => boolean;
};

export type CheckScreenResult = { met: boolean };

function abortError(): Error {
	return Object.assign(new Error("Aborted"), { name: "AbortError" });
}

/** The failure message for a check that was not met by its deadline. */
export function screenCheckMissMessage(
	options: Pick<CheckScreenOptions, "text" | "assertion" | "timeoutMs">,
): string {
	const seconds = Math.round(options.timeoutMs / 1000);
	return options.assertion === "visible"
		? `Expected visible text not found within ${seconds}s: ${options.text}`
		: `Unexpected text still visible after ${seconds}s: ${options.text}`;
}

/**
 * Poll the Screen until `text` is visible / not visible, or the deadline passes.
 * A plain miss at the deadline is `{ met: false }`, for the caller to fail on or branch on.
 * Throws only when aborted, on a Dead Session, or when the last read at the deadline failed.
 */
export async function checkScreen(options: CheckScreenOptions): Promise<CheckScreenResult> {
	const pollMs = options.pollMs ?? SCREEN_CHECK_POLL_MS;
	const deadline = options.now() + options.timeoutMs;
	for (;;) {
		if (options.isAborted?.()) throw abortError();
		// A read can fail while the app is still coming up (e.g. idb's axbridge finds no
		// frontmost app right after launch). That is "not there yet", so keep polling until
		// the deadline; only a Dead Session ends the check at once.
		let readError: unknown = null;
		try {
			const { elements } = await options.readScreen();
			const found = screenHasText(elements ?? [], options.text);
			if (options.assertion === "visible" ? found : !found) return { met: true };
		} catch (error) {
			if (options.isDeadSession?.(error)) throw error;
			readError = error;
		}
		if (options.now() >= deadline) {
			if (readError) {
				const seconds = Math.round(options.timeoutMs / 1000);
				const message = readError instanceof Error ? readError.message : String(readError);
				throw new Error(`Could not read the screen within ${seconds}s: ${message}`);
			}
			return { met: false };
		}
		await options.sleep(pollMs);
	}
}
