/**
 * Live mirror for a cabled iPhone. `YoqaRunner` already captures half-size JPEGs on the
 * phone (`recordStart`); this pulls the newest one and serves it as MJPEG, the same Frame
 * Feed the simulator uses. A full PNG per poll is what made the inspector sit still.
 *
 * The pull is slow until something is watching the stream, so an idle session does not
 * keep a usbmux tunnel open. The phone's recorder stops itself if nobody pulls for a
 * minute, so the slow pull still happens often enough to keep it alive.
 */

import type { LiveStream } from "./lane";
import { MJPEG_CONTENT_TYPE, mjpegPart } from "./mjpeg-server";
import { YoqaRunnerCommandError } from "./yoqa-runner-link";

/** What the phone captures for the mirror and for a Run recording that shares it. */
export const IOS_PREVIEW_CAPTURE = { fps: 12, scale: 0.5, quality: 0.55 };

/** How often a watcher pulls a new frame off the phone. */
const FAST_PULL_MS = 40;
/** Often enough that the phone does not stop the recorder, rare enough to leave the cable alone. */
const KEEPALIVE_PULL_MS = 20_000;
/** Resend the current frame when the screen has not changed, so a gone client is noticed. */
const HEARTBEAT_MS = 1_000;

type PreviewSend = (command: string, fields?: Record<string, unknown>) => Promise<unknown>;

type LatestFrame = { seq: number; bytes: Uint8Array };

type FetchReply = {
	running?: unknown;
	frames?: Array<{ seq?: unknown; jpeg?: unknown }>;
};

export type PhonePreview = {
	stream: LiveStream;
	/** The phone is already capturing; a recording should not start or stop that recorder. */
	readonly running: true;
	stop: () => Promise<void>;
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Start the phone's capture and a local MJPEG server. Returns null when this runner has
 * no recorder (the inspector then polls screenshots). Any other failure is the caller's.
 */
export async function startPhonePreview(send: PreviewSend): Promise<PhonePreview | null> {
	try {
		await send("recordStart", IOS_PREVIEW_CAPTURE);
	} catch (error) {
		if (error instanceof YoqaRunnerCommandError) return null;
		throw error;
	}

	let stopped = false;
	let after: number | undefined;
	let latest: LatestFrame | null = null;
	let watchers = 0;
	let wakePull: (() => void) | null = null;
	let loggedPullError = false;

	const interruptPull = () => {
		wakePull?.();
	};

	/** Sleep the pull loop only. A watcher arriving ends a keepalive wait early. */
	const sleepPull = (ms: number) =>
		new Promise<void>((resolve) => {
			if (stopped) {
				resolve();
				return;
			}
			const timer = setTimeout(() => {
				wakePull = null;
				resolve();
			}, ms);
			wakePull = () => {
				clearTimeout(timer);
				wakePull = null;
				resolve();
			};
		});

	const pull = async () => {
		const reply = (await send("recordFetch", after === undefined ? {} : { after })) as FetchReply;
		if (reply?.running === false) {
			after = undefined;
			await send("recordStart", IOS_PREVIEW_CAPTURE);
			return;
		}
		let newest: LatestFrame | null = null;
		for (const frame of reply?.frames ?? []) {
			if (
				typeof frame.seq !== "number" ||
				typeof frame.jpeg !== "string" ||
				frame.jpeg.length === 0
			) {
				continue;
			}
			after = frame.seq;
			newest = { seq: frame.seq, bytes: Uint8Array.from(Buffer.from(frame.jpeg, "base64")) };
		}
		if (newest) latest = newest;
	};

	const loop = (async () => {
		while (!stopped) {
			await sleepPull(watchers > 0 ? FAST_PULL_MS : KEEPALIVE_PULL_MS);
			if (stopped) return;
			try {
				await pull();
				loggedPullError = false;
			} catch (error) {
				if (stopped) return;
				if (!loggedPullError) {
					loggedPullError = true;
					console.warn(
						`[yoqa-runner] live preview missed a frame (${errorMessage(error)}); the mirror keeps the last one`,
					);
				}
			}
		}
	})();

	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			watchers += 1;
			interruptPull();
			let lastSeq = -1;
			let lastSent = 0;
			const body = new ReadableStream<Uint8Array>({
				async start(controller) {
					try {
						while (!stopped && !request.signal.aborted) {
							const frame = latest;
							const now = performance.now();
							if (frame && (frame.seq !== lastSeq || now - lastSent >= HEARTBEAT_MS)) {
								lastSeq = frame.seq;
								lastSent = now;
								controller.enqueue(mjpegPart(frame.bytes));
							}
							await Bun.sleep(FAST_PULL_MS);
						}
					} catch {
						// The watcher hung up.
					} finally {
						watchers = Math.max(0, watchers - 1);
						try {
							controller.close();
						} catch {
							// Already closed.
						}
					}
				},
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
		running: true,
		stop: async () => {
			if (stopped) return;
			stopped = true;
			interruptPull();
			server.stop(true);
			await loop.catch(() => undefined);
			await send("recordStop").catch(() => undefined);
		},
	};
}
