/**
 * Resolving which Device Session an emission is accounted to.
 *
 * Its own module because it is the one place accounting touches the runner, and because it carries
 * a deadline the rest of the CLI does not: the output seam looks the session up *after* the
 * command's output is already written, so a runner that accepts the connection and then stops
 * answering must not hang a command that has nothing left to say.
 */

import { createRunnerClient } from "@yoqa/runner-client";
import { deviceSessionId } from "./emitted-usage";

/** Generous for a localhost round-trip, short enough that a stuck runner is not a hang. */
export const SESSION_LOOKUP_TIMEOUT_MS = 2000;

/**
 * The Device Session **Emitted usage** is accounted to, or null when nothing is connected.
 * Throws if the runner cannot answer within the deadline; every caller on the accounting path
 * treats that as "not accounted" rather than as a failure.
 */
export async function activeSessionId(
	baseUrl: string,
	options: { timeoutMs?: number } = {},
): Promise<string | null> {
	const timeoutMs = options.timeoutMs ?? SESSION_LOOKUP_TIMEOUT_MS;
	const active = await createRunnerClient({
		baseUrl,
		fetchImpl: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) }),
	}).getActiveDevice();
	return active ? deviceSessionId(active) : null;
}
