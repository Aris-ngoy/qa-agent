/**
 * Clean a page source into a compact element list with relative 0–1000 boxes.
 * Drops zero-size / offscreen / pure layout containers (ARCHITECTURE §4.2).
 */

import { type ScreenSource, decodeXmlEntities, screenSourceSchema } from "@yoqa/runner-client";
import type { AxNode } from "./cdp-client";

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
	/** Which app the tree was read from, when the Lane says so. */
	source?: ScreenSource;
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
	/** The physical-iOS Lane's `ScreenSource`; no other tree carries one. */
	source?: unknown;
};

/** The `ScreenSource` a JSON tree carries, or undefined when it has none. */
function sourceOf(doc: unknown): ScreenSource | undefined {
	if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return undefined;
	const parsed = screenSourceSchema.safeParse((doc as IdbComplete).source);
	return parsed.success ? parsed.data : undefined;
}

/**
 * Which app a raw tree says it was read from, for a full Screen. Only the physical-iOS
 * Lane's JSON tree says so; any other tree, or one that does not parse, has none.
 */
export function screenSourceOf(raw: string): ScreenSource | undefined {
	const trimmed = raw.trim();
	if (!trimmed.startsWith("{")) return undefined;
	try {
		return sourceOf(JSON.parse(trimmed));
	} catch {
		return undefined;
	}
}

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

function isOffscreen(rect: Rect, window: { width: number; height: number }): boolean {
	return (
		rect.x + rect.width < 0 ||
		rect.y + rect.height < 0 ||
		rect.x > window.width ||
		rect.y > window.height
	);
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
	if (isOffscreen(input.rect, window)) return;
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

/** idb `--format complete` (and a bare element array) into the same Screen as the XML. */
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
	const source = sourceOf(parsed);
	return source ? { elements, window, source } : { elements, window };
}

type Rect = { x: number; y: number; width: number; height: number };

/**
 * One node of a web page source: a CDP accessibility node with its element's border box
 * in the viewport's CSS pixels, and the element's `data-testid` and `id` attributes.
 */
export type WebAxSourceNode = AxNode & { bounds?: Rect; testId?: string; domId?: string };

/**
 * A JavaScript dialog open on a web page (`alert`, `confirm`, `prompt`, `beforeunload`):
 * the browser's `Page.javascriptDialogOpening` event, and where the lane places the dialog
 * and its buttons in the viewport's CSS pixels. The browser draws it outside the page, so
 * those boxes are the lane's, and a tap on a button answers the dialog.
 */
export type WebDialogSource = {
	event: { type: string; message: string; defaultPrompt?: string };
	bounds: Rect;
	buttons: Array<{ label: string; accept: boolean; bounds: Rect }>;
};

/**
 * The web Direct lane's page source: the page's full accessibility tree, and the page's
 * open JavaScript dialog, if any.
 */
export type WebAxSource = { axTree: WebAxSourceNode[]; dialog?: WebDialogSource };

/** Roles that only hold the page together, even when the browser names them. */
const WEB_STRUCTURAL_ROLES = new Set(["RootWebArea", "InlineTextBox", "LineBreak"]);

/** Roles a user acts on: kept even unnamed, so a bare icon button is still on the Screen. */
const WEB_CONTROL_ROLES = new Set([
	"button",
	"link",
	"checkbox",
	"radio",
	"switch",
	"tab",
	"menuitem",
	"menuitemcheckbox",
	"menuitemradio",
	"option",
	"textbox",
	"searchbox",
	"combobox",
	"slider",
	"spinbutton",
]);

/** Text runs that repeat their parent's name, the way a button's label is also its text. */
const WEB_TEXT_ROLES = new Set(["StaticText"]);

/** Images: kept unnamed only when they carry an id, so they can be picked and tapped by id. */
const WEB_IMAGE_ROLES = new Set(["img", "image"]);

/** React's `useId` values (`:r1:`, `«r1»`) change between renders; they are not ids. */
const GENERATED_DOM_ID = /^(:r[0-9a-z]+:|«r[0-9a-z]+»)$/i;

function axText(value: AxNode["name"]): string {
	return typeof value?.value === "string" ? value.value.replace(/\s+/g, " ").trim() : "";
}

function webIdOf(node: WebAxSourceNode): string {
	const testId = node.testId?.trim();
	if (testId) return testId;
	const domId = node.domId?.trim() ?? "";
	return GENERATED_DOM_ID.test(domId) ? "" : domId;
}

/**
 * A web page's accessibility tree into the same Screen as mobile: each named node, each
 * control, and each image with an id, with its role as the type. Hidden (ignored, which
 * covers `aria-hidden`), unnamed structural, zero-size and offscreen nodes are dropped, and
 * so is a text run its named parent already says or that sits inside a control on the Screen.
 * An open JavaScript dialog leads, as an iOS system alert does: one `modal` with its message
 * as the label and its type as the id, then its buttons.
 */
export function cleanWebAxSource(
	source: WebAxSource,
	window: { width: number; height: number },
): CleanedScreen {
	const byId = new Map(source.axTree.map((node) => [node.nodeId, node]));
	const parentOf = (node: WebAxSourceNode): WebAxSourceNode | undefined =>
		node.parentId ? byId.get(node.parentId) : undefined;
	const isLaidOut = (node: WebAxSourceNode): node is WebAxSourceNode & { bounds: Rect } =>
		!node.ignored &&
		!!node.bounds &&
		node.bounds.width > 0 &&
		node.bounds.height > 0 &&
		!isOffscreen(node.bounds, window);
	/** The nearest ancestor that has a name of its own. */
	const namedParentLabel = (node: WebAxSourceNode): string => {
		let parent = parentOf(node);
		while (parent) {
			const label = axText(parent.name);
			if (label && !parent.ignored) return label;
			parent = parentOf(parent);
		}
		return "";
	};
	/** Whether the nearest control ancestor is on the Screen, so it already stands for the text. */
	const inControlOnScreen = (node: WebAxSourceNode): boolean => {
		let parent = parentOf(node);
		while (parent) {
			if (WEB_CONTROL_ROLES.has(axText(parent.role))) return isLaidOut(parent);
			parent = parentOf(parent);
		}
		return false;
	};

	const elements: ScreenElement[] = [];
	if (source.dialog) {
		const { event, bounds, buttons } = source.dialog;
		pushNormalized(elements, window, {
			type: "modal",
			label: event.message,
			id: event.type,
			rect: bounds,
			enabled: true,
		});
		for (const button of buttons) {
			pushNormalized(elements, window, {
				type: "button",
				label: button.label,
				rect: button.bounds,
				enabled: true,
			});
		}
	}
	for (const node of source.axTree) {
		if (!isLaidOut(node)) continue;
		const type = axText(node.role);
		if (WEB_STRUCTURAL_ROLES.has(type)) continue;
		const label = axText(node.name) || axText(node.value);
		const id = webIdOf(node);
		const keptUnnamed = WEB_CONTROL_ROLES.has(type) || (WEB_IMAGE_ROLES.has(type) && !!id);
		if (!label && !keptUnnamed) continue;
		if (WEB_TEXT_ROLES.has(type)) {
			if (namedParentLabel(node).includes(label) || inControlOnScreen(node)) continue;
		}
		const disabled = node.properties?.some(
			(property) => property.name === "disabled" && property.value?.value === true,
		);
		pushNormalized(elements, window, {
			type,
			label,
			id: id || undefined,
			rect: node.bounds,
			enabled: !disabled,
		});
	}
	return { elements, window };
}

function isWebAxSource(parsed: unknown): parsed is WebAxSource {
	return (
		typeof parsed === "object" &&
		parsed !== null &&
		Array.isArray((parsed as Partial<WebAxSource>).axTree)
	);
}

export function cleanPageSource(
	xml: string,
	window: { width: number; height: number },
): CleanedScreen {
	const trimmed = xml.trim();
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		const parsed: unknown = JSON.parse(trimmed);
		if (isWebAxSource(parsed)) return cleanWebAxSource(parsed, window);
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
