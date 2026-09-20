import type { DeviceSession } from "./session";

/** Multipart boundary for the live-frame stream (`GET /screenshot/stream`). */
export const FEED_BOUNDARY = "yoqa-frame";

/** One `multipart/x-mixed-replace` part carrying a single frame. Pure: unit-tested. */
export function formatFrameChunk(
	frame: { base64: string; mime: string },
	boundary: string = FEED_BOUNDARY,
): Uint8Array {
	const bytes = Buffer.from(frame.base64, "base64");
	const header = `--${boundary}\r\nContent-Type: ${frame.mime}\r\nContent-Length: ${bytes.length}\r\n\r\n`;
	const headerBytes = new TextEncoder().encode(header);
	const trailer = new TextEncoder().encode("\r\n");
	const chunk = new Uint8Array(headerBytes.length + bytes.length + trailer.length);
	chunk.set(headerBytes, 0);
	chunk.set(bytes, headerBytes.length);
	chunk.set(trailer, headerBytes.length + bytes.length);
	return chunk;
}

export type FeedWriter = {
	write: (chunk: Uint8Array) => Promise<void> | void;
};

/**
 * Pump live frames into a multipart stream until aborted.
 * Captures back-to-back (no fixed interval) so delivery tracks the fastest
 * the backend can capture; TCP backpressure naturally paces the loop.
 * Resolves when `signal` aborts or the session dies (client falls back to poll).
 */
export async function pumpFeed(
	session: DeviceSession,
	writer: FeedWriter,
	signal: AbortSignal,
	options: { boundary?: string; maxFrames?: number } = {},
): Promise<{ frames: number; reason: "aborted" | "session-dead" | "max-frames" }> {
	const boundary = options.boundary ?? FEED_BOUNDARY;
	let frames = 0;
	while (!signal.aborted) {
		if (options.maxFrames != null && frames >= options.maxFrames) {
			return { frames, reason: "max-frames" };
		}
		let frame: { base64: string; mime: string };
		try {
			// Fresh captures pace the loop on the backend's real capture rate.
			frame = await session.captureFrame({ fresh: true });
		} catch {
			return { frames, reason: "session-dead" };
		}
		if (signal.aborted) return { frames, reason: "aborted" };
		try {
			await writer.write(formatFrameChunk(frame, boundary));
		} catch {
			return { frames, reason: "aborted" };
		}
		frames += 1;
	}
	return { frames, reason: "aborted" };
}
