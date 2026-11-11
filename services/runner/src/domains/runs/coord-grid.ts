import { type RgbaImage, decodePng, encodeRgbaPng } from "../devices/png";

// Lane harnesses and tests still import the codec from here; they move to `../devices/png` in a follow-up.
export { decodePng, encodeRgbaPng };

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

/**
 * Where inside a cell the centre sits: ten slots of 10 units, 0 at the left or top. Five slots
 * (20 units) missed small controls near a cell edge, such as a close X at 97,114.
 */
const GRID_SLOT = [5, 15, 25, 35, 45, 55, 65, 75, 85, 95] as const;

function clampCell(value: number, max: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(max, Math.max(0, Math.round(value)));
}

/**
 * Tap point for a labeled cell. Columns and rows are 0–9.
 * `qx` / `qy` are 0–9 (left/top to right/bottom). Omitted or out of range means the middle (50).
 */
export function pointFromGridCell(cell: {
	col: number;
	row: number;
	qx?: number;
	qy?: number;
}): { x: number; y: number } {
	const slot = (value: number | undefined): number => {
		if (value == null || !Number.isFinite(value)) return 50;
		const rounded = Math.round(value);
		if (rounded < 0 || rounded > 9) return 50;
		return GRID_SLOT[rounded] ?? 50;
	};
	const qx = slot(cell.qx);
	const qy = slot(cell.qy);
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
