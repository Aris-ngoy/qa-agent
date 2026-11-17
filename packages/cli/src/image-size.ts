/**
 * The pixel size of an image a command named for the caller to read — an Agent image or a raw
 * screenshot — taken from the head of its file, which is all Emitted usage needs to price it.
 *
 * The CLI reads it rather than asking the runner, because the runner does not report it and the
 * file is what the calling agent will open. Everything here is best-effort: an image it cannot
 * size is priced as no image, never guessed at.
 */

import { open } from "node:fs/promises";
import type { EmittedImage } from "./emitted-usage";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A PNG's size from its IHDR chunk, which the format requires to come first. */
function pngSize(bytes: Uint8Array): EmittedImage | undefined {
	if (bytes.length < 24 || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
		return undefined;
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * Start-of-frame markers: every baseline, progressive and lossless variant carries the size the
 * same way. C4 (Huffman tables), C8 (reserved) and CC (arithmetic conditioning) share the range
 * and are not frames.
 */
const JPEG_FRAME_MARKERS = new Set([
	0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/**
 * A JPEG's size from its frame header, walking the segments ahead of it — JFIF, Exif and an ICC
 * profile come first in a `sips` Agent image. Stops at the scan or at the end of the bytes it has,
 * because past either there is no header left to find.
 */
function jpegSize(bytes: Uint8Array): EmittedImage | undefined {
	if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let offset = 2;
	while (offset + 4 <= bytes.length) {
		if (bytes[offset] !== 0xff) return undefined;
		const marker = bytes[offset + 1] as number;
		// A fill byte before a marker is legal padding.
		if (marker === 0xff) {
			offset += 1;
			continue;
		}
		if (marker === 0xd9 || marker === 0xda) return undefined;
		const length = view.getUint16(offset + 2);
		if (JPEG_FRAME_MARKERS.has(marker)) {
			if (offset + 9 > bytes.length) return undefined;
			return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
		}
		offset += 2 + length;
	}
	return undefined;
}

/** The size of a PNG or JPEG from its opening bytes, or undefined for anything it cannot size. */
export function imageSize(bytes: Uint8Array): EmittedImage | undefined {
	return pngSize(bytes) ?? jpegSize(bytes);
}

/**
 * How much of a file is read to find its size. A PNG's is in the first 24 bytes; a JPEG's sits
 * behind its metadata segments, which in a `sips` Agent image run to a few kilobytes — an embedded
 * ICC profile is the largest. 64 KiB clears that many times over without reading a `--full`
 * screenshot's megabytes for a number in its first page.
 */
const HEADER_WINDOW_BYTES = 64 * 1024;

/**
 * The size of the image at `path`, or undefined when it cannot be read or sized. Never throws:
 * a runner on another host names paths this machine cannot open, and accounting must never fail
 * the command it is accounting for.
 */
export async function readImageSize(path: string): Promise<EmittedImage | undefined> {
	try {
		const file = await open(path, "r");
		try {
			const head = new Uint8Array(HEADER_WINDOW_BYTES);
			const { bytesRead } = await file.read(head, 0, HEADER_WINDOW_BYTES, 0);
			return imageSize(head.subarray(0, bytesRead));
		} finally {
			await file.close();
		}
	} catch {
		return undefined;
	}
}
