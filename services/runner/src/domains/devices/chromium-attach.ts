/**
 * Attach to a Chromium-family browser (Chrome, Edge, Brave, Chromium) the user started
 * with `--remote-debugging-port`. The user names the port in the device id
 * (`chromium-cdp-9222`); ports are never scanned. Attach is localhost only.
 */

const PROBE_TIMEOUT_MS = 2_000;

/** Nothing on the port answered as a Chromium DevTools endpoint. */
export class NoCdpEndpointError extends Error {
	constructor(
		readonly port: number,
		reason: string,
	) {
		super(
			`No Chromium DevTools endpoint on port ${port} (${reason}). Start Chrome, Edge or Brave with --remote-debugging-port=${port} and a non-default --user-data-dir: Chrome 136 and later turn remote debugging off on the default profile.`,
		);
		this.name = "NoCdpEndpointError";
	}
}

/**
 * The browser's CDP WebSocket URL, read from `/json/version` on `port`. Fails with
 * `NoCdpEndpointError` when nothing there speaks CDP.
 */
export async function browserSocketUrl(
	port: number,
	fetchFn: typeof fetch = fetch,
): Promise<string> {
	let response: Response;
	try {
		response = await fetchFn(`http://127.0.0.1:${port}/json/version`, {
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
		});
	} catch (error) {
		throw new NoCdpEndpointError(port, error instanceof Error ? error.message : String(error));
	}
	if (!response.ok) throw new NoCdpEndpointError(port, `/json/version answered ${response.status}`);
	const body = (await response.json().catch(() => null)) as {
		webSocketDebuggerUrl?: unknown;
	} | null;
	const url = body?.webSocketDebuggerUrl;
	if (typeof url !== "string" || !url.startsWith("ws")) {
		throw new NoCdpEndpointError(port, "/json/version named no DevTools socket");
	}
	return url;
}
