/**
 * A local MJPEG server for a Lane whose JPEG frames are pushed to it as they come (the web
 * screencast). The runner proxies it on `/stream.mjpeg`, as it does every Stream. Each
 * watcher gets every new frame, starting with the newest one, and that frame again each
 * second while nothing changes, so a watcher that hung up is noticed. A watcher that falls
 * behind skips frames rather than queueing them.
 */

import type { LiveStream } from "./lane";

/** Resend the newest frame when the screen has not changed, so a gone watcher is noticed. */
const HEARTBEAT_MS = 1_000;
/** Frames queued for one watcher before it skips the next ones. */
const MAX_QUEUED_FRAMES = 2;

const BOUNDARY = "yoqa-frame";

/** One JPEG as a part of the multipart stream. */
export function mjpegPart(bytes: Uint8Array): Uint8Array {
	const head = `--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${bytes.byteLength}\r\n\r\n`;
	const headBytes = new TextEncoder().encode(head);
	const tail = new TextEncoder().encode("\r\n");
	const out = new Uint8Array(headBytes.byteLength + bytes.byteLength + tail.byteLength);
	out.set(headBytes, 0);
	out.set(bytes, headBytes.byteLength);
	out.set(tail, headBytes.byteLength + bytes.byteLength);
	return out;
}

export const MJPEG_CONTENT_TYPE = `multipart/x-mixed-replace; boundary=${BOUNDARY}`;

export type MjpegServer = {
	stream: LiveStream;
	/** Send a frame to every watcher. */
	push: (jpeg: Uint8Array) => void;
	/** End every watcher's stream and stop listening. Safe to call twice. */
	stop: () => void;
};

export function startMjpegServer(hooks: {
	/** The first watcher arrived: start producing frames. */
	onWatched: () => void;
	/** The last watcher left: stop producing them. */
	onUnwatched: () => void;
}): MjpegServer {
	const watchers = new Set<ReadableStreamDefaultController<Uint8Array>>();
	let latest: Uint8Array | null = null;
	let lastSentAt = 0;
	let stopped = false;

	const leave = (watcher: ReadableStreamDefaultController<Uint8Array>) => {
		if (!watchers.delete(watcher)) return;
		try {
			watcher.close();
		} catch {
			// Already closed.
		}
		if (watchers.size === 0 && !stopped) hooks.onUnwatched();
	};

	const send = (watcher: ReadableStreamDefaultController<Uint8Array>, part: Uint8Array) => {
		if ((watcher.desiredSize ?? 0) <= -MAX_QUEUED_FRAMES) return;
		try {
			watcher.enqueue(part);
		} catch {
			leave(watcher);
		}
	};

	const sendLatest = () => {
		if (!latest) return;
		lastSentAt = performance.now();
		const part = mjpegPart(latest);
		for (const watcher of watchers) send(watcher, part);
	};

	const heartbeat = setInterval(() => {
		if (performance.now() - lastSentAt >= HEARTBEAT_MS) sendLatest();
	}, HEARTBEAT_MS);
	heartbeat.unref?.();

	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		// A watcher waits on frames for as long as it watches.
		idleTimeout: 0,
		fetch(request) {
			if (stopped) return new Response("The stream has stopped", { status: 503 });
			let watcher: ReadableStreamDefaultController<Uint8Array> | null = null;
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					watcher = controller;
					watchers.add(controller);
					if (latest) send(controller, mjpegPart(latest));
					if (watchers.size === 1) hooks.onWatched();
				},
				cancel() {
					if (watcher) leave(watcher);
				},
			});
			request.signal.addEventListener("abort", () => {
				if (watcher) leave(watcher);
			});
			return new Response(body, {
				headers: {
					"Content-Type": MJPEG_CONTENT_TYPE,
					"Cache-Control": "no-store",
					Connection: "close",
				},
			});
		},
	});
	server.unref?.();

	return {
		stream: {
			ready: true,
			port: server.port ?? 0,
			upstreamUrl: `http://127.0.0.1:${server.port}/stream.mjpeg`,
		},
		push: (jpeg) => {
			if (stopped) return;
			latest = jpeg;
			sendLatest();
		},
		stop: () => {
			if (stopped) return;
			stopped = true;
			clearInterval(heartbeat);
			for (const watcher of [...watchers]) leave(watcher);
			// Not forced: each watcher's stream ends cleanly, then the server lets go.
			void server.stop();
		},
	};
}
