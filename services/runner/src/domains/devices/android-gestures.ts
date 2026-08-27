/**
 * Android pointer injection. W3C performActions often miss system windows
 * (PermissionController); UiAutomator `mobile: clickGesture` / `dragGesture` hit them.
 */

export type PointerSize = { width: number; height: number };

export type GestureBrowser = {
	capabilities?: { platformName?: unknown };
	execute: (command: string, params?: object) => Promise<unknown>;
	performActions: (actions: object[]) => Promise<void>;
	releaseActions: () => Promise<void>;
};

export function isAndroidDriver(browser: { capabilities?: { platformName?: unknown } }): boolean {
	return String(browser.capabilities?.platformName ?? "").toLowerCase() === "android";
}

export function toPx(norm: number, size: number): number {
	return Math.round((Math.min(1000, Math.max(0, norm)) / 1000) * size);
}

/**
 * Read PNG IHDR width/height from a base64 screenshot (no decode of the image body).
 */
export function pngSizeFromBase64(base64: string): PointerSize | null {
	if (!base64) return null;
	try {
		const buf = Buffer.from(base64.slice(0, 48), "base64");
		if (buf.length < 24) return null;
		if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
		const width = buf.readUInt32BE(16);
		const height = buf.readUInt32BE(20);
		if (width < 1 || height < 1 || width > 16_384 || height > 16_384) return null;
		return { width, height };
	} catch {
		return null;
	}
}

/**
 * Scale vision / inspector 0–1000 coords. Prefer the screenshot when it matches
 * the window (same display). When they differ, keep the window so `--label` / `--id`
 * taps — cleaned against `getWindowSize()` — stay aligned.
 */
export function preferPointerSize(
	window: PointerSize,
	screenshot: PointerSize | null,
): PointerSize {
	if (!screenshot || screenshot.width < 1 || screenshot.height < 1) return window;
	if (window.width < 1 || window.height < 1) return screenshot;
	const dw = Math.abs(screenshot.width - window.width) / window.width;
	const dh = Math.abs(screenshot.height - window.height) / window.height;
	if (dw < 0.02 && dh < 0.02) return screenshot;
	return window;
}

function w3cTapActions(x: number, y: number, holdMs: number): object[] {
	return [
		{
			type: "pointer",
			id: "finger1",
			parameters: { pointerType: "touch" },
			actions: [
				{ type: "pointerMove", duration: 0, x, y },
				{ type: "pointerDown", button: 0 },
				{ type: "pause", duration: holdMs },
				{ type: "pointerUp", button: 0 },
			],
		},
	];
}

function w3cSwipeActions(
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	durationMs: number,
): object[] {
	return [
		{
			type: "pointer",
			id: "finger1",
			parameters: { pointerType: "touch" },
			actions: [
				{ type: "pointerMove", duration: 0, x: x1, y: y1 },
				{ type: "pointerDown", button: 0 },
				{ type: "pointerMove", duration: durationMs, x: x2, y: y2 },
				{ type: "pointerUp", button: 0 },
			],
		},
	];
}

async function w3cPerform(browser: GestureBrowser, actions: object[]): Promise<void> {
	await browser.performActions(actions);
	try {
		await browser.releaseActions();
	} catch {
		// WDA / UIA2 sometimes error on release after a completed gesture.
	}
}

/** Pixel tap. Android uses UiAutomator clickGesture so system dialogs receive the event. */
export async function injectTap(
	browser: GestureBrowser,
	x: number,
	y: number,
	holdMs: number,
): Promise<"clickGesture" | "w3c"> {
	const duration = Math.max(50, holdMs);
	if (isAndroidDriver(browser)) {
		try {
			await browser.execute("mobile: clickGesture", { x, y, duration });
			return "clickGesture";
		} catch {
			// Fall through — some driver builds lack the mobile command.
		}
	}
	await w3cPerform(browser, w3cTapActions(x, y, duration));
	return "w3c";
}

/** Pixel swipe/drag. Android uses dragGesture (point-to-point). */
export async function injectSwipe(
	browser: GestureBrowser,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	durationMs: number,
): Promise<"dragGesture" | "w3c"> {
	const duration = Math.max(50, durationMs);
	if (isAndroidDriver(browser)) {
		try {
			const distance = Math.hypot(x2 - x1, y2 - y1);
			const speed = Math.max(200, Math.round(distance / (duration / 1000)));
			await browser.execute("mobile: dragGesture", {
				startX: x1,
				startY: y1,
				endX: x2,
				endY: y2,
				speed,
			});
			return "dragGesture";
		} catch {
			// Fall through.
		}
	}
	await w3cPerform(browser, w3cSwipeActions(x1, y1, x2, y2, duration));
	return "w3c";
}
