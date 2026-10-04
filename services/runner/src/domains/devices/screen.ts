/**
 * Clean Appium page source into a compact element list with relative 0–1000 boxes.
 * Drops zero-size / offscreen / pure layout containers (ARCHITECTURE §4.2).
 */

import { decodeXmlEntities } from "@yoqa/runner-client";

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
			attrs[key] = decodeXmlEntities(value);
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
		lower === "android.view.view" ||
		lower === "other" ||
		lower === "application" ||
		lower === "rctview" ||
		lower === "axgenericelement" ||
		lower === "genericelement"
	);
}

type IdbFrame = { x?: number; y?: number; width?: number; height?: number };

type IdbNode = {
	type?: string;
	role?: string;
	label?: string;
	AXLabel?: string;
	title?: string;
	identifier?: string;
	AXUniqueId?: string;
	enabled?: boolean | null;
	frame?: IdbFrame;
	children?: IdbNode[];
};

type IdbComplete = {
	modal?: {
		kind?: string;
		label?: string;
		element_type?: string;
		frame?: IdbFrame;
	} | null;
	elements?: IdbNode[];
	screen?: { width?: number; height?: number };
};

function idbFrame(frame: IdbFrame | undefined): {
	x: number;
	y: number;
	width: number;
	height: number;
} | null {
	if (!frame) return null;
	const x = Number(frame.x);
	const y = Number(frame.y);
	const width = Number(frame.width);
	const height = Number(frame.height);
	if ([x, y, width, height].some((n) => Number.isNaN(n))) return null;
	if (width <= 0 || height <= 0) return null;
	return { x, y, width, height };
}

function pushNormalized(
	elements: ScreenElement[],
	window: { width: number; height: number },
	input: {
		type: string;
		label: string;
		id?: string;
		rect: { x: number; y: number; width: number; height: number };
		enabled?: boolean;
	},
): void {
	if (
		input.rect.x + input.rect.width < 0 ||
		input.rect.y + input.rect.height < 0 ||
		input.rect.x > window.width ||
		input.rect.y > window.height
	) {
		return;
	}
	if (isLayoutOnly(input.type, input.label)) return;
	elements.push({
		type: input.type,
		label: input.label,
		...(input.id ? { id: input.id } : {}),
		x: Math.round((input.rect.x / window.width) * 1000),
		y: Math.round((input.rect.y / window.height) * 1000),
		width: Math.round((input.rect.width / window.width) * 1000),
		height: Math.round((input.rect.height / window.height) * 1000),
		enabled: input.enabled,
	});
}

function walkIdbNodes(
	nodes: IdbNode[] | undefined,
	window: { width: number; height: number },
	elements: ScreenElement[],
): void {
	if (!nodes) return;
	for (const node of nodes) {
		const type = node.type || node.role || "Other";
		const label = firstUsableAttr([node.label, node.AXLabel, node.title], type);
		const id = firstUsableAttr([node.identifier, node.AXUniqueId], type);
		const rect = idbFrame(node.frame);
		if (rect) {
			pushNormalized(elements, window, {
				type,
				label,
				id: id || undefined,
				rect,
				enabled: node.enabled === null ? undefined : (node.enabled ?? undefined),
			});
		}
		walkIdbNodes(node.children, window, elements);
	}
}

/** idb `--format complete` (and a bare element array) into the same Screen as Appium XML. */
export function cleanIdbCompleteSource(
	raw: string,
	window: { width: number; height: number },
): CleanedScreen {
	const parsed: unknown = JSON.parse(raw);
	const doc: IdbComplete = Array.isArray(parsed)
		? { elements: parsed as IdbNode[] }
		: (parsed as IdbComplete);
	const elements: ScreenElement[] = [];
	walkIdbNodes(doc.elements, window, elements);
	const modal = doc.modal;
	if (modal?.label) {
		const type = modal.element_type || "XCUIElementTypeAlert";
		const rect = idbFrame(modal.frame) ?? {
			x: Math.round(window.width * 0.08),
			y: Math.round(window.height * 0.28),
			width: Math.round(window.width * 0.84),
			height: Math.round(window.height * 0.22),
		};
		pushNormalized(elements, window, { type, label: modal.label, rect });
	}
	return { elements, window };
}

export function cleanPageSource(
	xml: string,
	window: { width: number; height: number },
): CleanedScreen {
	const trimmed = xml.trim();
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		return cleanIdbCompleteSource(trimmed, window);
	}
	const elements: ScreenElement[] = [];
	const tagRe = /<([A-Za-z0-9_.-]+)([^>]*)\/?>/g;

	for (const match of xml.matchAll(tagRe)) {
		const full = match[0];
		if (!full || full.startsWith("</")) continue;
		const { name, attrs } = attrsFromTag(full);
		const type = name === "node" && attrs.class ? attrs.class : name;

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

		const label = labelFromAttrs(attrs, type);
		if (isLayoutOnly(type, label)) continue;

		const visible =
			attrs.visible === undefined ? undefined : attrs.visible === "true" || attrs.visible === "1";
		if (visible === false) continue;

		const enabled =
			attrs.enabled === undefined ? undefined : attrs.enabled === "true" || attrs.enabled === "1";

		const id = idFromAttrs(attrs, type);

		elements.push({
			type,
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
