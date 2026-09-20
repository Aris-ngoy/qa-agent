import { describe, expect, test } from "bun:test";
import { FEED_BOUNDARY, formatFrameChunk, pumpFeed } from "./feed";
import type { DeviceSession } from "./session";

const FRAME = {
	base64: Buffer.from([1, 2, 3, 4]).toString("base64"),
	mime: "image/png" as const,
};

describe("formatFrameChunk", () => {
	test("builds a valid multipart part", () => {
		const chunk = formatFrameChunk(FRAME);
		const text = new TextDecoder().decode(chunk.slice(0, 120));
		expect(text).toContain(`--${FEED_BOUNDARY}`);
		expect(text).toContain("Content-Type: image/png");
		expect(text).toContain("Content-Length: 4");
		expect(chunk.slice(-2)).toEqual(new Uint8Array([13, 10]));
		expect(chunk.length).toBeGreaterThan(4);
	});
});

describe("pumpFeed", () => {
	function stubSession(frames: (typeof FRAME)[], failAfter?: number): DeviceSession {
		let calls = 0;
		return {
			captureFrame: async () => {
				if (failAfter != null && calls >= failAfter) {
					throw new Error("Device session ended");
				}
				const frame = frames[calls % frames.length];
				calls += 1;
				if (!frame) throw new Error("no frame");
				return frame;
			},
		} as unknown as DeviceSession;
	}

	test("pumps frames until max-frames", async () => {
		const written: Uint8Array[] = [];
		const controller = new AbortController();
		const result = await pumpFeed(
			stubSession([FRAME]),
			{ write: (chunk) => void written.push(chunk) },
			controller.signal,
			{ maxFrames: 3 },
		);
		expect(result).toEqual({ frames: 3, reason: "max-frames" });
		expect(written).toHaveLength(3);
	});

	test("stops when the session dies", async () => {
		const written: Uint8Array[] = [];
		const controller = new AbortController();
		const result = await pumpFeed(
			stubSession([FRAME], 2),
			{ write: (chunk) => void written.push(chunk) },
			controller.signal,
		);
		expect(result).toEqual({ frames: 2, reason: "session-dead" });
	});

	test("stops when aborted mid-write", async () => {
		const controller = new AbortController();
		const result = await pumpFeed(
			stubSession([FRAME]),
			{
				write: () => {
					controller.abort();
				},
			},
			controller.signal,
			{ maxFrames: 10 },
		);
		expect(result.reason).toBe("aborted");
	});
});
