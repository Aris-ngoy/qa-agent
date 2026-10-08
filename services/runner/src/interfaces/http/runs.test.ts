import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { parseByteRange, serveVideo } from "./runs";

describe("parseByteRange", () => {
	test("reads closed, open-ended and suffix ranges", () => {
		expect(parseByteRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
		expect(parseByteRange("bytes=900-", 1000)).toEqual({ start: 900, end: 999 });
		expect(parseByteRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
		expect(parseByteRange("bytes=0-5000", 1000)).toEqual({ start: 0, end: 999 });
	});

	test("ignores missing or malformed ranges and flags unsatisfiable ones", () => {
		expect(parseByteRange(undefined, 1000)).toBeNull();
		expect(parseByteRange("bytes=-", 1000)).toBeNull();
		expect(parseByteRange("bytes=-0", 1000)).toBe("unsatisfiable");
		expect(parseByteRange("bytes=2000-", 1000)).toBe("unsatisfiable");
		expect(parseByteRange("bytes=0-9", 0)).toBe("unsatisfiable");
	});
});

describe("serveVideo", () => {
	async function videoFile() {
		const path = `${await mkdtemp(`${tmpdir()}/serve-`)}/v.mp4`;
		await writeFile(
			path,
			Uint8Array.from({ length: 256 }, (_, i) => i),
		);
		return path;
	}

	test("sends the whole file with its length, so the player knows the size", async () => {
		const response = await serveVideo(await videoFile(), undefined);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-length")).toBe("256");
		expect(response.headers.get("accept-ranges")).toBe("bytes");
		expect((await response.arrayBuffer()).byteLength).toBe(256);
	});

	test("answers a Range request with exactly that part and its length", async () => {
		const response = await serveVideo(await videoFile(), "bytes=10-19");
		expect(response.status).toBe(206);
		expect(response.headers.get("content-range")).toBe("bytes 10-19/256");
		expect(response.headers.get("content-length")).toBe("10");
		expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([
			10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
		]);
	});

	test("rejects a Range past the end with 416", async () => {
		const response = await serveVideo(await videoFile(), "bytes=300-");
		expect(response.status).toBe(416);
		expect(response.headers.get("content-range")).toBe("bytes */256");
	});
});
