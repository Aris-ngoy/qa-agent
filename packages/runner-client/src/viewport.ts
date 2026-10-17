import type { ViewportPresetName } from "./schemas";

export type ViewportPreset = {
	name: ViewportPresetName;
	/** The page viewport in CSS pixels: what 0–1000 maps onto. */
	width: number;
	height: number;
	/** Screenshot pixels per CSS pixel. */
	deviceScaleFactor: number;
	/** A phone: a mobile user agent and touch input. */
	mobile: boolean;
};

/** Each Viewport preset's size. `mobile` is an iPhone 14's screen. */
export const VIEWPORT_PRESETS: Record<ViewportPresetName, ViewportPreset> = {
	desktop: { name: "desktop", width: 1280, height: 800, deviceScaleFactor: 1, mobile: false },
	mobile: { name: "mobile", width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
};

export const DEFAULT_VIEWPORT_PRESET: ViewportPresetName = "desktop";

/** `mobile (390×844)`: a preset with its size, for reports and the CLI. */
export function formatViewportPreset(name: ViewportPresetName): string {
	const { width, height } = VIEWPORT_PRESETS[name];
	return `${name} (${width}×${height})`;
}
