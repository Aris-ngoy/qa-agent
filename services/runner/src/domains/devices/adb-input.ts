import type { PointerSize } from "./android-gestures";

/** Parse `adb shell wm size` (`Physical size: 1080x2400`, optional Override). */
export function parseWmSize(stdout: string): PointerSize | null {
	const override = stdout.match(/Override size:\s*(\d+)x(\d+)/i);
	const physical = stdout.match(/Physical size:\s*(\d+)x(\d+)/i);
	const match = override ?? physical;
	if (!match?.[1] || !match[2]) return null;
	const width = Number(match[1]);
	const height = Number(match[2]);
	if (width < 1 || height < 1) return null;
	return { width, height };
}

/** Encode a string for `adb shell input text` (spaces become %s). */
export function encodeAdbInputText(text: string): string {
	return text
		.replace(/\\/g, "\\\\")
		.replace(/ /g, "%s")
		.replace(/['"&|<>();*$`]/g, "\\$&");
}

/** Drop the "UI hierchary dumped to: …" banner from `uiautomator dump /dev/tty`. */
export function stripUiautomatorDump(stdout: string): string {
	const xmlStart = stdout.indexOf("<");
	return xmlStart >= 0 ? stdout.slice(xmlStart) : stdout;
}

export function findDumpNodeBounds(
	xml: string,
	match: (attrs: Record<string, string>) => boolean,
): { x: number; y: number; width: number; height: number } | null {
	const tagRe = /<([A-Za-z0-9_.-]+)([^>]*)\/?>/g;
	for (const hit of xml.matchAll(tagRe)) {
		const full = hit[0];
		if (!full || full.startsWith("</")) continue;
		const attrs: Record<string, string> = {};
		for (const attr of full.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g)) {
			if (attr[1] && attr[2] !== undefined) attrs[attr[1]] = attr[2];
		}
		if (!match(attrs)) continue;
		const bounds = attrs.bounds?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
		if (!bounds?.[1] || !bounds[2] || !bounds[3] || !bounds[4]) continue;
		const x1 = Number(bounds[1]);
		const y1 = Number(bounds[2]);
		const x2 = Number(bounds[3]);
		const y2 = Number(bounds[4]);
		return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
	}
	return null;
}
