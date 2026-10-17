export type Size = { width: number; height: number };
export type Point = { x: number; y: number };
export type Rotation = 0 | 90 | 180 | 270;

/**
 * How the screenshot sits in the viewer stage. `scale` is relative to the fitted size (1 = fit),
 * and `x`/`y` move the image's centre away from the stage's centre, in screen px.
 */
export type ViewTransform = { scale: number; x: number; y: number; rotation: Rotation };

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 12;
/** One click on a zoom button. */
export const ZOOM_STEP = 1.25;
/** Double-click zooms in this far from fit. */
export const DOUBLE_CLICK_SCALE = 2.5;

export const FIT_VIEW: ViewTransform = { scale: 1, x: 0, y: 0, rotation: 0 };

export function clampScale(scale: number): number {
	return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
}

/**
 * The unrotated size to draw the image at so that, after `rotation`, it fits the stage. A quarter
 * turn swaps which side has to fit the stage's width.
 */
export function fitSize(stage: Size, natural: Size, rotation: Rotation): Size {
	if (stage.width <= 0 || stage.height <= 0 || natural.width <= 0 || natural.height <= 0) {
		return { width: 0, height: 0 };
	}
	const quarter = rotation === 90 || rotation === 270;
	const turnedWidth = quarter ? natural.height : natural.width;
	const turnedHeight = quarter ? natural.width : natural.height;
	const ratio = Math.min(stage.width / turnedWidth, stage.height / turnedHeight);
	return { width: natural.width * ratio, height: natural.height * ratio };
}

/**
 * Zooms by `factor` while the stage point `point` (relative to the stage's centre) stays under the
 * pointer, the way a map zooms around the cursor.
 */
export function zoomAt(view: ViewTransform, factor: number, point: Point): ViewTransform {
	const scale = clampScale(view.scale * factor);
	const k = scale / view.scale;
	return {
		...view,
		scale,
		x: point.x - (point.x - view.x) * k,
		y: point.y - (point.y - view.y) * k,
	};
}

export function zoomTo(view: ViewTransform, scale: number, point: Point = { x: 0, y: 0 }) {
	return zoomAt(view, scale / view.scale, point);
}

export function panBy(view: ViewTransform, dx: number, dy: number): ViewTransform {
	return { ...view, x: view.x + dx, y: view.y + dy };
}

/** A quarter turn clockwise (1) or anticlockwise (-1); the image re-fits and re-centres. */
export function rotateView(view: ViewTransform, direction: 1 | -1): ViewTransform {
	const rotation = (((view.rotation + direction * 90) % 360) + 360) % 360;
	return { ...FIT_VIEW, rotation: rotation as Rotation };
}

/** Wheel and trackpad-pinch deltas to a zoom factor; one event never jumps more than 2x. */
export function wheelZoomFactor(deltaY: number, pinch: boolean): number {
	const speed = pinch ? 0.01 : 0.0015;
	return Math.max(0.5, Math.min(2, Math.exp(-deltaY * speed)));
}

/** The scale that shows one screenshot pixel per screen pixel. */
export function actualPixelScale(fitted: Size, natural: Size): number {
	return fitted.width > 0 ? natural.width / fitted.width : 1;
}

/** The zoom as a share of the screenshot's real pixels, e.g. "100%" for pixel-for-pixel. */
export function zoomPercent(view: ViewTransform, fitted: Size, natural: Size): string {
	if (natural.width <= 0) return `${Math.round(view.scale * 100)}%`;
	return `${Math.round(((view.scale * fitted.width) / natural.width) * 100)}%`;
}

/** A phone screenshot's usual width:height, used until the first screenshot has loaded. */
export const PHONE_ASPECT = 9 / 19.5;

/**
 * The screenshot frame's width:height. The loaded screenshot's own shape wins, so it fills the frame
 * edge to edge; before that, a web Run's Viewport preset (`"1280 / 800"`) or a phone's shape.
 */
export function frameAspect(natural: Size | null, pageAspect: string | null): number {
	if (natural && natural.width > 0 && natural.height > 0) return natural.width / natural.height;
	const [width, height] = (pageAspect ?? "").split("/").map((part) => Number(part.trim()));
	if (width && height && Number.isFinite(width / height)) return width / height;
	return PHONE_ASPECT;
}
