/**
 * Clean Appium page source into a compact element list with relative 0–1000 boxes.
 * Drops zero-size / offscreen / pure layout containers (ARCHITECTURE §4.2).
 */

export type ScreenElement = {
	type: string;
	label: string;
	/** Android resource-id / iOS accessibility name when available. */
	id?: string;
	x: number;
	y: number;
	width: number;
	height: number;
	enabled?: boolean;
	visible?: boolean;
};

export type CleanedScreen = {
	elements: ScreenElement[];
	window: { width: number; height: number };
};

function parseBoundsAndroid(bounds: string | null): {
	x: number;
	y: number;
	width: number;
	height: number;
} | null {
	if (!bounds) return null;
	const match = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
	if (!match) return null;
	const x1 = Number(match[1]);
	const y1 = Number(match[2]);
	const x2 = Number(match[3]);
	const y2 = Number(match[4]);
	return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function parseIosFrame(attrs: Record<string, string>): {
	x: number;
	y: number;
	width: number;
	height: number;
} | null {
	const x = Number(attrs.x ?? attrs.X);
	const y = Number(attrs.y ?? attrs.Y);
	const width = Number(attrs.width ?? attrs.Width);
	const height = Number(attrs.height ?? attrs.Height);
	if ([x, y, width, height].some((n) => Number.isNaN(n))) return null;
	return { x, y, width, height };
}

function attrsFromTag(tag: string): { name: string; attrs: Record<string, string> } {
	const nameMatch = tag.match(/^<\/?([A-Za-z0-9_.-]+)/);
	const name = nameMatch?.[1] ?? "node";
	const attrs: Record<string, string> = {};
	const attrRe = /([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g;
	for (const m of tag.matchAll(attrRe)) {
		const key = m[1];
		const value = m[2];
		if (key !== undefined && value !== undefined) {
			attrs[key] = value;
		}
	}
	return { name, attrs };
}

function labelFromAttrs(attrs: Record<string, string>): string {
	return (
		attrs.contentDesc ||
		attrs["content-desc"] ||
		attrs.label ||
		attrs.name ||
		attrs.text ||
		attrs.value ||
		attrs.resourceId ||
		attrs["resource-id"] ||
		""
	);
}

function idFromAttrs(attrs: Record<string, string>): string {
	return (
		attrs["resource-id"] ||
		attrs.resourceId ||
		attrs.accessibilityIdentifier ||
		attrs.name ||
		""
	).trim();
}

function isLayoutOnly(name: string, label: string): boolean {
	if (label.trim().length > 0) return false;
	const lower = name.toLowerCase();
	return (
		lower.includes("layout") ||
		lower.includes("viewgroup") ||
		lower === "xcuielementtypeother" ||
		lower === "xcuielementtypeapplication" ||
		lower === "hierarchy" ||
		lower === "android.widget.framelayout" ||
		lower === "android.view.view"
	);
}

export function cleanPageSource(
	xml: string,
	window: { width: number; height: number },
): CleanedScreen {
	const elements: ScreenElement[] = [];
	const tagRe = /<([A-Za-z0-9_.-]+)([^>]*)\/?>/g;

	for (const match of xml.matchAll(tagRe)) {
		const full = match[0];
		if (!full || full.startsWith("</")) continue;
		const { name, attrs } = attrsFromTag(full);

		const rect = parseBoundsAndroid(attrs.bounds ?? null) ?? parseIosFrame(attrs);
		if (!rect) continue;
		if (rect.width <= 0 || rect.height <= 0) continue;

		// Offscreen (rough)
		if (
			rect.x + rect.width < 0 ||
			rect.y + rect.height < 0 ||
			rect.x > window.width ||
			rect.y > window.height
		) {
			continue;
		}

		const label = labelFromAttrs(attrs);
		if (isLayoutOnly(name, label)) continue;

		const visible =
			attrs.visible === undefined ? undefined : attrs.visible === "true" || attrs.visible === "1";
		if (visible === false) continue;

		const enabled =
			attrs.enabled === undefined ? undefined : attrs.enabled === "true" || attrs.enabled === "1";

		const id = idFromAttrs(attrs);

		elements.push({
			type: name,
			label: label || name,
			...(id ? { id } : {}),
			x: Math.round((rect.x / window.width) * 1000),
			y: Math.round((rect.y / window.height) * 1000),
			width: Math.round((rect.width / window.width) * 1000),
			height: Math.round((rect.height / window.height) * 1000),
			enabled,
			visible,
		});
	}

	return { elements, window };
}
