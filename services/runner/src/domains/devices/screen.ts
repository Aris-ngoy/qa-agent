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

/** Deeplink / http URLs are not stable accessibility identifiers or human labels. */
function isUrlLike(value: string): boolean {
	const trimmed = value.trim();
	if (!trimmed) return false;
	return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
}

function firstUsableAttr(candidates: Array<string | undefined>, elementType: string): string {
	for (const raw of candidates) {
		const value = raw?.trim() ?? "";
		if (!value) continue;
		if (isUrlLike(value)) continue;
		if (value === elementType) continue;
		if (/^XCUIElementType/i.test(value)) continue;
		return value;
	}
	return "";
}

function labelFromAttrs(attrs: Record<string, string>, elementType: string): string {
	return firstUsableAttr(
		[
			attrs.contentDesc,
			attrs["content-desc"],
			attrs.label,
			attrs.name,
			attrs.text,
			attrs.value,
			attrs.resourceId,
			attrs["resource-id"],
		],
		elementType,
	);
}

function idFromAttrs(attrs: Record<string, string>, elementType: string): string {
	const explicit = (
		attrs["resource-id"] ||
		attrs.resourceId ||
		attrs.accessibilityIdentifier ||
		""
	).trim();
	if (explicit && !isUrlLike(explicit) && explicit !== elementType) {
		return explicit;
	}
	// iOS often puts the accessibility id in `name`; skip deeplink / type strings.
	return firstUsableAttr([attrs.name], elementType);
}

function isLayoutOnly(name: string, label: string): boolean {
	if (label.trim().length > 0) return false;
	const lower = name.toLowerCase();
	return (
		lower.includes("layout") ||
		lower.includes("viewgroup") ||
		lower === "xcuielementtypeother" ||
		lower === "xcuielementtypeapplication" ||
		lower === "xcuielementtypescrollview" ||
		lower === "xcuielementtypecollectionview" ||
		lower === "xcuielementtypetable" ||
		lower === "xcuielementtypewebview" ||
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

		const label = labelFromAttrs(attrs, name);
		if (isLayoutOnly(name, label)) continue;

		const visible =
			attrs.visible === undefined ? undefined : attrs.visible === "true" || attrs.visible === "1";
		if (visible === false) continue;

		const enabled =
			attrs.enabled === undefined ? undefined : attrs.enabled === "true" || attrs.enabled === "1";

		const id = idFromAttrs(attrs, name);

		elements.push({
			type: name,
			label,
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
