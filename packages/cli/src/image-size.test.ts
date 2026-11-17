/**
 * Reading an Agent image's pixel size from the head of its file — what Emitted usage prices it
 * on. The fixtures are the opening bytes of real 3×2 images written by `sips`, the tool the runner
 * makes Agent images with, so the expected sizes come from the encoder rather than from this reader.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { imageSize, readImageSize } from "./image-size";

/** Signature and IHDR chunk of a 3×2 PNG. */
const PNG_3X2 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYa", "base64");

/** The first 128 bytes of a 3×2 JPEG: JFIF, Exif, then the frame header. */
const JPEG_3X2 = Buffer.from(
	"/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAA6ADAAQAAAABAAAAAgAAAAD/wAARCAACAAMDASIAAhEBAxEB/8QAHwAAAQUBAQE=",
	"base64",
);

describe("the pixel size of an image", () => {
	test("reads a PNG's size from its header", () => {
		expect(imageSize(PNG_3X2)).toEqual({ width: 3, height: 2 });
	});

	test("reads a JPEG's size from its frame header, past the segments ahead of it", () => {
		// The Agent image is a `sips` JPEG by default; its frame header follows JFIF and Exif.
		expect(imageSize(JPEG_3X2)).toEqual({ width: 3, height: 2 });
	});

	test("sizes nothing it cannot read, rather than guessing", () => {
		expect(imageSize(new Uint8Array())).toBeUndefined();
		expect(imageSize(Buffer.from("screenshot /tmp/result.png"))).toBeUndefined();
		// The Exif segment ends where the frame header would begin.
		expect(imageSize(JPEG_3X2.subarray(0, 0x62))).toBeUndefined();
		expect(imageSize(PNG_3X2.subarray(0, 20))).toBeUndefined();
	});
});

describe("the pixel size of an image file a command named", () => {
	let dir = "";

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "yoqa-image-size-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	test("reads it from the head of the file", async () => {
		const path = join(dir, "result_agent.jpg");
		await writeFile(path, JPEG_3X2);

		expect(await readImageSize(path)).toEqual({ width: 3, height: 2 });
	});

	test("is unknown, not an error, for a file that is not there", async () => {
		// A runner on another host names paths this machine cannot open — nor can the agent here.
		expect(await readImageSize(join(dir, "missing.png"))).toBeUndefined();
		expect(await readImageSize(dir)).toBeUndefined();
	});
});
