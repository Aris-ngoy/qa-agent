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

/**
 * The session resolved so far in this command, keyed by base URL.
 *
 * A Device Session cannot change while one command is running, so one lookup answers every
 * emission that command makes — and `yoqa script run --json` emits a line per action, so without
 * this a twenty-action replay would make twenty round-trips for the same answer.
 */
const resolved = new Map<string, Promise<string | null>>();

/**
 * The Device Session for this command, asking the runner at most once.
 *
 * The pending promise is cached rather than its value, so emissions that overlap share the one
 * request. A rejection is cached too, deliberately: the only way this rejects is a runner that
 * accepted the connection and stopped answering, and paying that 2-second deadline once per
 * emitted line is exactly the hang the deadline exists to prevent.
 */
export function sessionIdOnce(
	baseUrl: string,
	options: { timeoutMs?: number } = {},
): Promise<string | null> {
	const cached = resolved.get(baseUrl);
	if (cached) return cached;
	const pending = activeSessionId(baseUrl, options);
	resolved.set(baseUrl, pending);
	return pending;
}

/**
 * Forget what this command resolved. Called from a `preAction` hook, so the cache lives for one
 * command invocation rather than one process: a reconnect between two commands in the same
 * process — which is every CLI test — must never be served the previous session.
 */
export function resetSessionCache(): void {
	resolved.clear();
}
