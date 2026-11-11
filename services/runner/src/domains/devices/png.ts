/** A minimal PNG codec for drawing on device screenshots (8-bit, non-interlaced). */
import { crc32, deflateSync, inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type RgbaImage = { width: number; height: number; rgba: Uint8Array };

function pngChunk(type: string, data: Buffer): Buffer {
	const typeAndData = Buffer.concat([Buffer.from(type), data]);
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(typeAndData) >>> 0);
	return Buffer.concat([length, typeAndData, crc]);
}

/** Encode an RGBA buffer as a non-interlaced PNG (filter None). */
export function encodeRgbaPng(image: RgbaImage): Buffer {
	const { width, height, rgba } = image;
	const stride = width * 4;
	const raw = Buffer.alloc(height * (1 + stride));
	for (let y = 0; y < height; y++) {
		const row = y * (1 + stride);
		raw[row] = 0;
		Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, row + 1);
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	return Buffer.concat([
		PNG_SIGNATURE,
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", deflateSync(raw)),
		pngChunk("IEND", Buffer.alloc(0)),
	]);
}

function paeth(left: number, up: number, upLeft: number): number {
	const estimate = left + up - upLeft;
	const leftDist = Math.abs(estimate - left);
	const upDist = Math.abs(estimate - up);
	const upLeftDist = Math.abs(estimate - upLeft);
	if (leftDist <= upDist && leftDist <= upLeftDist) return left;
	if (upDist <= upLeftDist) return up;
	return upLeft;
}

function unfilter(raw: Buffer, height: number, stride: number, bpp: number): Buffer | null {
	const out = Buffer.alloc(height * stride);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (1 + stride)];
		if (filter === undefined || filter > 4) return null;
		const src = y * (1 + stride) + 1;
		const dst = y * stride;
		for (let x = 0; x < stride; x++) {
			const value = raw[src + x] ?? 0;
			const left = x >= bpp ? (out[dst + x - bpp] ?? 0) : 0;
			const up = y > 0 ? (out[dst - stride + x] ?? 0) : 0;
			const upLeft = y > 0 && x >= bpp ? (out[dst - stride + x - bpp] ?? 0) : 0;
			let recon = value;
			if (filter === 1) recon = value + left;
			else if (filter === 2) recon = value + up;
			else if (filter === 3) recon = value + Math.floor((left + up) / 2);
			else if (filter === 4) recon = value + paeth(left, up, upLeft);
			out[dst + x] = recon & 0xff;
		}
	}
	return out;
}

/** Decode an 8-bit non-interlaced PNG into RGBA. Returns null for unsupported files. */
export function decodePng(bytes: Buffer): RgbaImage | null {
	if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
	let width = 0;
	let height = 0;
	let colorType = -1;
	const idat: Buffer[] = [];
	let offset = 8;
	while (offset + 8 <= bytes.length) {
		const length = bytes.readUInt32BE(offset);
		const type = bytes.toString("ascii", offset + 4, offset + 8);
		const start = offset + 8;
		const end = start + length;
		if (end + 4 > bytes.length) return null;
		const data = bytes.subarray(start, end);
		if (type === "IHDR") {
			if (data.length < 13) return null;
			width = data.readUInt32BE(0);
			height = data.readUInt32BE(4);
			if (data[8] !== 8 || data[12] !== 0) return null;
			colorType = data[9] ?? -1;
		} else if (type === "IDAT") {
			idat.push(Buffer.from(data));
		} else if (type === "IEND") {
			break;
		}
		offset = end + 4;
	}
	if (width < 1 || height < 1 || width > 8192 || height > 8192) return null;
	const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
	if (bpp === 0) return null;
	let inflated: Buffer;
	try {
		inflated = inflateSync(Buffer.concat(idat));
	} catch {
		return null;
	}
	const stride = width * bpp;
	if (inflated.length < height * (1 + stride)) return null;
	const raw = unfilter(inflated, height, stride, bpp);
	if (!raw) return null;
	const rgba = new Uint8Array(width * height * 4);
	if (bpp === 4) {
		rgba.set(raw.subarray(0, rgba.length));
	} else {
		for (let i = 0; i < width * height; i++) {
			rgba[i * 4] = raw[i * 3] ?? 0;
			rgba[i * 4 + 1] = raw[i * 3 + 1] ?? 0;
			rgba[i * 4 + 2] = raw[i * 3 + 2] ?? 0;
			rgba[i * 4 + 3] = 255;
		}
	}
	return { width, height, rgba };
}
