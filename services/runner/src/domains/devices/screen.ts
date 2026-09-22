/**
 * Map backend snapshot nodes to Yoqa's compact element list with
 * relative 0–1000 boxes.
 */

import type { SnapshotNode } from "./session";

export type ScreenElement = {
	type: string;
	label: string;
	/** Android resource-id / iOS accessibility identifier when available. */
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

function labelFor(node: SnapshotNode): string {
	for (const candidate of [node.label, node.value, node.identifier]) {
		const value = candidate?.trim() ?? "";
		if (!value) continue;
		if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) continue;
		if (/^XCUIElementType/i.test(value)) continue;
		if (value === (node.type ?? "") || value === (node.role ?? "")) continue;
		return value;
	}
	return "";
}

function idFor(node: SnapshotNode): string | undefined {
	const explicit = node.identifier?.trim() ?? "";
	if (explicit && !/^[a-z][a-z0-9+.-]*:\/\//i.test(explicit)) return explicit;
	return undefined;
}

export function snapshotNodesToScreen(
	nodes: SnapshotNode[],
	window: { width: number; height: number },
): CleanedScreen {
	const elements: ScreenElement[] = [];
	for (const node of nodes) {
		const rect = node.rect;
		if (!rect || rect.width <= 0 || rect.height <= 0) continue;
		if (
			rect.x + rect.width < 0 ||
			rect.y + rect.height < 0 ||
			rect.x > window.width ||
			rect.y > window.height
		) {
			continue;
		}
		const label = labelFor(node);
		const type = node.role || node.type || "node";
		// Drop pure layout containers without any label.
		if (!label) {
			const lower = type.toLowerCase();
			if (
				lower.includes("layout") ||
				lower.includes("viewgroup") ||
				lower.includes("collectionview") ||
				lower.includes("scrollview") ||
				lower.includes("application") ||
				lower === "other" ||
				lower === "window"
			) {
				continue;
			}
		}
		const id = idFor(node);
		elements.push({
			type,
			label,
			...(id ? { id } : {}),
			x: Math.round((rect.x / window.width) * 1000),
			y: Math.round((rect.y / window.height) * 1000),
			width: Math.round((rect.width / window.width) * 1000),
			height: Math.round((rect.height / window.height) * 1000),
			enabled: node.enabled,
			visible: true,
		});
	}
	return { elements, window };
}
