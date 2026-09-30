import { crc32, deflateSync, inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type RgbaImage = { width: number; height: number; rgba: Uint8Array };

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

function paintMagenta(rgba: Uint8Array, index: number): void {
	rgba[index] = 255;
	rgba[index + 1] = 0;
	rgba[index + 2] = 255;
	rgba[index + 3] = 255;
}

/** 5×7 glyphs. A cell label is `column-row`, for example `3-6`. */
const GLYPHS: Record<string, readonly string[]> = {
	"0": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
	"1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
	"2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
	"3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
	"4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
	"5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
	"6": ["01110", "10000", "11110", "10001", "10001", "10001", "01110"],
	"7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
	"8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
	"9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
	"-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
};

/** Where inside a cell the centre sits. 2 is the middle. */
const GRID_SLOT = [10, 30, 50, 70, 90] as const;

function clampCell(value: number, max: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(max, Math.max(0, Math.round(value)));
}

/**
 * Tap point for a labeled cell. Columns and rows are 0–9.
 * `qx` / `qy` are 0–4 (left/top to right/bottom). Omitted or out of range means the middle.
 */
export function pointFromGridCell(cell: {
	col: number;
	row: number;
	qx?: number;
	qy?: number;
}): { x: number; y: number } {
	const slot = (value: number | undefined): number => {
		if (value == null || !Number.isFinite(value)) return 2;
		const rounded = Math.round(value);
		if (rounded < 0 || rounded > 4) return 2;
		return rounded;
	};
	const qx = GRID_SLOT[slot(cell.qx)] ?? 50;
	const qy = GRID_SLOT[slot(cell.qy)] ?? 50;
	return {
		x: clampCell(cell.col, 9) * 100 + qx,
		y: clampCell(cell.row, 9) * 100 + qy,
	};
}

function fillRect(
	rgba: Uint8Array,
	width: number,
	height: number,
	x: number,
	y: number,
	w: number,
	h: number,
	color: [number, number, number],
): void {
	const xEnd = Math.min(width, x + w);
	const yEnd = Math.min(height, y + h);
	for (let py = Math.max(0, y); py < yEnd; py++) {
		for (let px = Math.max(0, x); px < xEnd; px++) {
			const index = (py * width + px) * 4;
			rgba[index] = color[0];
			rgba[index + 1] = color[1];
			rgba[index + 2] = color[2];
			rgba[index + 3] = 255;
		}
	}
}

function paintGlyph(
	rgba: Uint8Array,
	width: number,
	height: number,
	glyph: readonly string[],
	originX: number,
	originY: number,
	scale: number,
): void {
	for (let row = 0; row < glyph.length; row++) {
		const bits = glyph[row] ?? "";
		for (let col = 0; col < bits.length; col++) {
			if (bits[col] !== "1") continue;
			for (let sy = 0; sy < scale; sy++) {
				for (let sx = 0; sx < scale; sx++) {
					const px = originX + col * scale + sx;
					const py = originY + row * scale + sy;
					if (px < 0 || py < 0 || px >= width || py >= height) continue;
					const index = (py * width + px) * 4;
					rgba[index] = 255;
					rgba[index + 1] = 255;
					rgba[index + 2] = 255;
					rgba[index + 3] = 255;
				}
			}
		}
	}
}

/** Paint `column-row` in the top-left of each cell so the model can name the cell. */
export function paintCellLabels(image: RgbaImage): void {
	const { width, height, rgba } = image;
	const stroke = Math.max(2, Math.round(Math.min(width, height) / 200));
	for (let col = 0; col < 10; col++) {
		for (let row = 0; row < 10; row++) {
			const x0 = Math.round((col / 10) * (width - 1));
			const y0 = Math.round((row / 10) * (height - 1));
			const x1 = Math.round(((col + 1) / 10) * (width - 1));
			const y1 = Math.round(((row + 1) / 10) * (height - 1));
			const scale = Math.floor(Math.min(x1 - x0, y1 - y0) / 24);
			if (scale < 1) continue;
			const text = `${col}-${row}`;
			const textW = text.length * 5 + (text.length - 1);
			const boxW = (textW + 2) * scale;
			const boxH = 9 * scale;
			if (x0 + stroke + boxW >= x1 || y0 + stroke + boxH >= y1) continue;
			const originX = x0 + stroke;
			const originY = y0 + stroke;
			fillRect(rgba, width, height, originX, originY, boxW, boxH, [0, 0, 0]);
			let cursor = originX + scale;
			for (const char of text) {
				const glyph = GLYPHS[char];
				if (glyph) paintGlyph(rgba, width, height, glyph, cursor, originY + scale, scale);
				cursor += 6 * scale;
			}
		}
	}
}

/** Draw lines at every 100 units on the 0–1000 grid. */
export function paintNormGrid(image: RgbaImage): void {
	const { width, height, rgba } = image;
	const stroke = Math.max(2, Math.round(Math.min(width, height) / 200));
	const half = Math.floor(stroke / 2);
	const paintColumn = (x: number) => {
		for (let dx = -half; dx < stroke - half; dx++) {
			const px = x + dx;
			if (px < 0 || px >= width) continue;
			for (let y = 0; y < height; y++) paintMagenta(rgba, (y * width + px) * 4);
		}
	};
	const paintRow = (y: number) => {
		for (let dy = -half; dy < stroke - half; dy++) {
			const py = y + dy;
			if (py < 0 || py >= height) continue;
			for (let x = 0; x < width; x++) paintMagenta(rgba, (py * width + x) * 4);
		}
	};
	for (let step = 1; step <= 9; step++) {
		paintColumn(Math.round((step / 10) * (width - 1)));
		paintRow(Math.round((step / 10) * (height - 1)));
	}
}

/**
 * Return a PNG with the coordinate grid, or null when the screenshot cannot be drawn on.
 */
export function overlayCoordGrid(pngBase64: string): string | null {
	const bytes = Buffer.from(pngBase64, "base64");
	const image = decodePng(bytes);
	if (!image) return null;
	paintNormGrid(image);
	paintCellLabels(image);
	return encodeRgbaPng(image).toString("base64");
}
