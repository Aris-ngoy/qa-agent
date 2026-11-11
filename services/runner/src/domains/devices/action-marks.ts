import { type RgbaImage, decodePng, encodeRgbaPng } from "./png";

/** Where an Action landed, in the 0–1000 screenshot space. */
export type ActionMark =
	| { kind: "tap"; x: number; y: number }
	| { kind: "path"; x: number; y: number; x2: number; y2: number };

type Rgb = [number, number, number];

const MARK_RED: Rgb = [255, 32, 32];
const MARK_WHITE: Rgb = [255, 255, 255];
const MARK_GREEN: Rgb = [0, 200, 80];

function normToPx(norm: number, size: number): number {
	const clamped = Math.min(1000, Math.max(0, Number.isFinite(norm) ? norm : 0));
	return Math.round((clamped / 1000) * (size - 1));
}

/** Fill every pixel whose distance from the centre is in [inner, outer]. */
function paintRing(
	image: RgbaImage,
	cx: number,
	cy: number,
	inner: number,
	outer: number,
	color: Rgb,
): void {
	const { width, height, rgba } = image;
	const outerSq = outer * outer;
	const innerSq = inner * inner;
	const reach = Math.ceil(outer);
	for (let py = Math.max(0, cy - reach); py <= Math.min(height - 1, cy + reach); py++) {
		for (let px = Math.max(0, cx - reach); px <= Math.min(width - 1, cx + reach); px++) {
			const distSq = (px - cx) ** 2 + (py - cy) ** 2;
			if (distSq > outerSq || distSq < innerSq) continue;
			const index = (py * width + px) * 4;
			rgba[index] = color[0];
			rgba[index + 1] = color[1];
			rgba[index + 2] = color[2];
			rgba[index + 3] = 255;
		}
	}
}

function paintThickLine(
	image: RgbaImage,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	thickness: number,
	color: Rgb,
): void {
	const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
	const radius = Math.max(1, Math.floor(thickness / 2));
	for (let step = 0; step <= steps; step++) {
		const cx = Math.round(x0 + ((x1 - x0) * step) / steps);
		const cy = Math.round(y0 + ((y1 - y0) * step) / steps);
		paintRing(image, cx, cy, 0, radius, color);
	}
}

/** A ring with a centre dot: where a tap, or the end of a swipe, landed. */
function paintLandingMark(image: RgbaImage, cx: number, cy: number, unit: number): void {
	const radius = unit * 4;
	paintRing(image, cx, cy, radius, radius + unit * 2, MARK_WHITE);
	paintRing(image, cx, cy, radius + unit * 0.5, radius + unit * 1.5, MARK_RED);
	paintRing(image, cx, cy, 0, unit * 1.5, MARK_RED);
}

/** Draw where each Action landed: a ring for a tap, a line from a green start dot to a ring for a path. */
export function paintActionMarks(image: RgbaImage, marks: readonly ActionMark[]): void {
	const unit = Math.max(2, Math.round(Math.min(image.width, image.height) / 200));
	for (const mark of marks) {
		const cx = normToPx(mark.x, image.width);
		const cy = normToPx(mark.y, image.height);
		if (mark.kind === "tap") {
			paintLandingMark(image, cx, cy, unit);
			continue;
		}
		const ex = normToPx(mark.x2, image.width);
		const ey = normToPx(mark.y2, image.height);
		paintThickLine(image, cx, cy, ex, ey, unit * 3, MARK_WHITE);
		paintThickLine(image, cx, cy, ex, ey, unit, MARK_RED);
		paintRing(image, cx, cy, 0, unit * 3, MARK_WHITE);
		paintRing(image, cx, cy, 0, unit * 2, MARK_GREEN);
		paintLandingMark(image, ex, ey, unit);
	}
}

/** Return a PNG with the Action marks drawn on it, or null when the screenshot cannot be drawn on. */
export function overlayActionMarks(pngBase64: string, marks: readonly ActionMark[]): string | null {
	if (marks.length === 0) return null;
	const image = decodePng(Buffer.from(pngBase64, "base64"));
	if (!image) return null;
	paintActionMarks(image, marks);
	return encodeRgbaPng(image).toString("base64");
}
