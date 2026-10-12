/** Live MJPEG proxy fetches from the device tool — must be aborted before the session ends. */
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

/** Cancel every open `/stream.mjpeg` upstream so the device tool can exit. Returns true if any proxy was open. */
export function abortAllMjpegProxies(): boolean {
	const had = proxies.size > 0;
	for (const controller of [...proxies]) {
		try {
			controller.abort();
		} catch {
			// ignore
		}
	}
	proxies.clear();
	return had;
}
