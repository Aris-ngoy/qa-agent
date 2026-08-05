/** Live MJPEG proxy fetches into WDA/UIA2 — must be aborted before deleteSession. */
const proxies = new Set<AbortController>();

/** Register a proxy AbortController; removed automatically when aborted. */
export function trackMjpegProxy(): AbortController {
	const controller = new AbortController();
	proxies.add(controller);
	controller.signal.addEventListener(
		"abort",
		() => {
			proxies.delete(controller);
		},
		{ once: true },
	);
	return controller;
}

/** Cancel every open `/stream.mjpeg` upstream so WDA can exit. */
export function abortAllMjpegProxies(): void {
	for (const controller of [...proxies]) {
		try {
			controller.abort();
		} catch {
			// ignore
		}
	}
	proxies.clear();
}
