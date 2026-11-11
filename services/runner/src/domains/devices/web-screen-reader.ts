/**
 * Reading a page's Screen source over CDP: its full accessibility tree, with each iframe's
 * tree spliced under its iframe element, and each laid-out element's box (in the page
 * viewport's CSS pixels) and ids from one DOM snapshot per process. The Screen module cleans
 * this; the web Direct lane decides when it may be read (not under an open dialog).
 */

import type {
	AxNode,
	CdpClient,
	CdpCommands,
	CdpMethod,
	DocumentSnapshot,
	TargetInfo,
} from "./cdp-client";
import { CdpCommandError } from "./cdp-client";
import type { WebAxSourceNode } from "./screen";

/**
 * Each out-of-process iframe in a session's page attaches as a session of its own, so the
 * Screen can read inside it. It runs on at once; nothing waits for a debugger.
 */
export const AUTO_ATTACH = {
	autoAttach: true,
	waitForDebuggerOnStart: false,
	flatten: true,
} as const;

/** A point on the page, in its CSS pixels. */
type PagePoint = { x: number; y: number };

/** An out-of-process iframe's own session; its target id is its frame id. */
type OutOfProcessFrame = { sessionId: string; frameId: string };

type ElementLayout = Pick<WebAxSourceNode, "bounds" | "testId" | "domId">;

/** An element's box, and where its content box starts: for an iframe, its document's origin. */
type ElementBox = { layout: ElementLayout; content: PagePoint };

/** A frame in a snapshot, by its iframe element's backend node id. */
type FrameOwner = { frameId: string; owner: number };

/**
 * A snapshot with each box's CSS offset and client boxes, and the padding that, past the
 * border, puts an iframe's content box where its document starts.
 */
const SNAPSHOT_PARAMS = {
	computedStyles: ["padding-left", "padding-top"],
	includeDOMRects: true,
};

/**
 * Device pixels per CSS pixel in a DOM snapshot: the display's scale (2 on a Retina Mac),
 * which Chromium lays snapshots out in whatever the page emulates. The layout viewport's
 * two widths give it. A tab that has never painted reports 0 for both, and then a box
 * against its element's CSS offset box in the same snapshot does.
 */
function devicePixelsPerCss(
	metrics: CdpCommands["Page.getLayoutMetrics"]["result"],
	doc: DocumentSnapshot | undefined,
): number {
	const device = metrics.layoutViewport?.clientWidth ?? 0;
	const css = metrics.cssLayoutViewport?.clientWidth ?? 0;
	if (device > 0 && css > 0) return device / css;
	const offsets = doc?.layout.offsetRects ?? [];
	for (const [index, offset] of offsets.entries()) {
		const cssWidth = offset[2] ?? 0;
		const deviceWidth = doc?.layout.bounds[index]?.[2] ?? 0;
		if (cssWidth > 0 && deviceWidth > 0) return deviceWidth / cssWidth;
	}
	return 1;
}

/**
 * The laid-out elements of one process's frames, from its snapshot, by backend node id: each
 * box in the page viewport's CSS pixels and its `data-testid` and `id` attributes. A
 * snapshot's boxes are in their own document's device pixels, so each document's scrolling
 * is taken off, the result scaled by `scale`, and moved to where the document sits in the
 * viewport: `origin` for the first, the content box of its iframe element for the others.
 * Also lists the other documents' frames, each by its owner's backend node id.
 */
function layoutFrames(
	{ documents, strings }: { documents: DocumentSnapshot[]; strings: string[] },
	scale: number,
	origin: PagePoint,
): { boxes: Map<number, ElementBox>; frames: FrameOwner[] } {
	const boxes = new Map<number, ElementBox>();
	const frames: FrameOwner[] = [];
	const origins: Array<PagePoint | undefined> = [origin];
	const cssPixels = (index: number | undefined) =>
		Number.parseFloat(strings[index ?? -1] ?? "") || 0;
	documents.forEach((doc, docIndex) => {
		const docOrigin = origins[docIndex];
		// A frame whose iframe is not laid out is not on the Screen.
		if (!docOrigin) return;
		const scrollX = doc.scrollOffsetX ?? 0;
		const scrollY = doc.scrollOffsetY ?? 0;
		const contentDocuments = new Map<number, number>();
		const { index = [], value = [] } = doc.nodes.contentDocumentIndex ?? {};
		index.forEach((nodeIndex, at) => contentDocuments.set(nodeIndex, value[at] ?? -1));
		doc.layout.nodeIndex.forEach((nodeIndex, layoutIndex) => {
			const backendId = doc.nodes.backendNodeId?.[nodeIndex];
			const [x = 0, y = 0, width = 0, height = 0] = doc.layout.bounds[layoutIndex] ?? [];
			if (backendId === undefined || boxes.has(backendId)) return;
			const bounds = {
				x: docOrigin.x + (x - scrollX) / scale,
				y: docOrigin.y + (y - scrollY) / scale,
				width: width / scale,
				height: height / scale,
			};
			const layout: ElementLayout = { bounds };
			const attributes = doc.nodes.attributes?.[nodeIndex] ?? [];
			for (let at = 0; at + 1 < attributes.length; at += 2) {
				const name = strings[attributes[at] ?? -1];
				const value = strings[attributes[at + 1] ?? -1];
				if (name === "data-testid" && value) layout.testId = value;
				if (name === "id" && value) layout.domId = value;
			}
			// The client box starts past the border; the content box past the padding too.
			const [borderLeft = 0, borderTop = 0] = doc.layout.clientRects?.[layoutIndex] ?? [];
			const [paddingLeft, paddingTop] = doc.layout.styles?.[layoutIndex] ?? [];
			const content = {
				x: bounds.x + borderLeft + cssPixels(paddingLeft),
				y: bounds.y + borderTop + cssPixels(paddingTop),
			};
			boxes.set(backendId, { layout, content });
			const childIndex = contentDocuments.get(nodeIndex) ?? -1;
			const frameId = strings[documents[childIndex]?.frameId ?? -1];
			if (frameId) {
				origins[childIndex] = content;
				frames.push({ frameId, owner: backendId });
			}
		});
	});
	return { boxes, frames };
}

/**
 * A frame's nodes, with ids that cannot clash with another process's: an out-of-process
 * frame numbers its nodes from 1 again. Ids are prefixed with the frame's target id.
 */
function withIdPrefix(node: AxNode, prefix: string): AxNode {
	if (!prefix) return node;
	return {
		...node,
		nodeId: prefix + node.nodeId,
		...(node.parentId === undefined ? {} : { parentId: prefix + node.parentId }),
		...(node.childIds ? { childIds: node.childIds.map((id) => prefix + id) } : {}),
	};
}

/**
 * Splice a frame's tree under its owner, the iframe element's node, right after it, so the
 * page and its frames read as one tree. Nodes the tree already holds are left out. A tree
 * without the owner (an iframe that is not in the accessibility tree) gets the frame at its
 * end, unattached.
 */
function spliceFrame(
	tree: WebAxSourceNode[],
	ownerId: string | undefined,
	frame: WebAxSourceNode[],
): WebAxSourceNode[] {
	const present = new Set(tree.map((node) => node.nodeId));
	const added = frame.filter((node) => !present.has(node.nodeId));
	const at = tree.findIndex((node) => node.nodeId === ownerId);
	const owner = tree[at];
	if (!owner) return [...tree, ...added];
	const inFrame = new Set(added.map((node) => node.nodeId));
	const rootIds = new Set(
		added
			.filter((node) => node.parentId === undefined || !inFrame.has(node.parentId))
			.map((node) => node.nodeId),
	);
	const linked = added.map((node) =>
		rootIds.has(node.nodeId) ? { ...node, parentId: owner.nodeId } : node,
	);
	const childIds = [...(owner.childIds ?? [])];
	for (const id of rootIds) if (!childIds.includes(id)) childIds.push(id);
	return [...tree.slice(0, at), { ...owner, childIds }, ...linked, ...tree.slice(at + 1)];
}

/** A frame that went away while being read is left off the Screen. */
const unlessGone = <T>(promise: Promise<T>): Promise<T | null> =>
	promise.catch((error: unknown) => {
		if (error instanceof CdpCommandError) return null;
		throw error;
	});

/** One CDP command to a session: the page's, or one of its iframes'. */
export type SendTo = <M extends CdpMethod>(
	sessionId: string,
	method: M,
	params: CdpCommands[M]["params"],
) => Promise<CdpCommands[M]["result"]>;

export type WebScreenReader = {
	/** The tree of the page attached under `sessionId`, iframes spliced in, with boxes and ids. */
	read: (sessionId: string) => Promise<WebAxSourceNode[]>;
};

/**
 * A reader of the pages on `client`. It follows the out-of-process iframes attached under
 * each session (a page's, or another iframe's) from now on, so it is made before the first
 * page is attached, which announces its iframes at once. Commands go through `send`.
 */
export function createWebScreenReader(client: CdpClient, send: SendTo): WebScreenReader {
	const outOfProcessFrames = new Map<string, OutOfProcessFrame[]>();
	client.on("Target.attachedToTarget", (params, parentSession) => {
		const { sessionId, targetInfo } = params as { sessionId: string; targetInfo: TargetInfo };
		if (!parentSession || targetInfo.type !== "iframe") return;
		const siblings = outOfProcessFrames.get(parentSession) ?? [];
		outOfProcessFrames.set(parentSession, [
			...siblings,
			{ sessionId, frameId: targetInfo.targetId },
		]);
		// An iframe inside it may be out of its process too.
		void client.send("Target.setAutoAttach", AUTO_ATTACH, sessionId).catch(() => undefined);
	});
	client.on("Target.detachedFromTarget", (params, parentSession) => {
		const { sessionId } = (params ?? {}) as { sessionId?: string };
		if (!sessionId) return;
		outOfProcessFrames.delete(sessionId);
		if (!parentSession) return;
		const siblings = outOfProcessFrames.get(parentSession);
		if (!siblings) return;
		outOfProcessFrames.set(
			parentSession,
			siblings.filter((frame) => frame.sessionId !== sessionId),
		);
	});

	/**
	 * One process's frames as one tree: `nodes`, its first frame's tree, with each other
	 * frame in `snapshot` and each out-of-process iframe attached under `sessionId` spliced
	 * under its iframe element's node. Each node of a laid-out element carries its box in
	 * the page viewport and its ids.
	 */
	const frameTree = async (
		sessionId: string,
		read: { nodes: AxNode[]; snapshot: CdpCommands["DOMSnapshot.captureSnapshot"]["result"] },
		place: { scale: number; origin: PagePoint; idPrefix: string },
	): Promise<WebAxSourceNode[]> => {
		const { boxes, frames } = layoutFrames(read.snapshot, place.scale, place.origin);
		const withLayout = (nodes: AxNode[]) =>
			nodes.map((node): WebAxSourceNode => {
				const box =
					node.backendDOMNodeId === undefined ? undefined : boxes.get(node.backendDOMNodeId);
				const prefixed = withIdPrefix(node, place.idPrefix);
				return box ? { ...prefixed, ...box.layout } : prefixed;
			});
		const inProcess = frames.map(async ({ frameId, owner }) => {
			const tree = await unlessGone(send(sessionId, "Accessibility.getFullAXTree", { frameId }));
			return tree && { owner, nodes: withLayout(tree.nodes) };
		});
		const outOfProcess = (outOfProcessFrames.get(sessionId) ?? []).map(async (frame) => {
			const owner = await unlessGone(
				send(sessionId, "DOM.getFrameOwner", { frameId: frame.frameId }),
			);
			const ownerBox = owner ? boxes.get(owner.backendNodeId) : undefined;
			if (!owner || !ownerBox) return null;
			const [tree, snapshot] = await Promise.all([
				unlessGone(send(frame.sessionId, "Accessibility.getFullAXTree", {})),
				unlessGone(send(frame.sessionId, "DOMSnapshot.captureSnapshot", SNAPSHOT_PARAMS)),
			]);
			if (!tree || !snapshot) return null;
			const nodes = await frameTree(
				frame.sessionId,
				{ nodes: tree.nodes, snapshot },
				{ scale: place.scale, origin: ownerBox.content, idPrefix: `${frame.frameId}:` },
			);
			return { owner: owner.backendNodeId, nodes };
		});
		const sameProcess = (await Promise.all(inProcess)).filter((frame) => frame !== null);
		const ownProcess = withLayout(read.nodes);
		// Backend node ids are only unique in one process, so owners are found among its nodes.
		const ownerIds = new Map<number, string>();
		for (const node of [ownProcess, ...sameProcess.map((frame) => frame.nodes)].flat()) {
			if (node.backendDOMNodeId !== undefined && !ownerIds.has(node.backendDOMNodeId)) {
				ownerIds.set(node.backendDOMNodeId, node.nodeId);
			}
		}
		const otherProcesses = (await Promise.all(outOfProcess)).filter((frame) => frame !== null);
		let tree = ownProcess;
		for (const frame of [...sameProcess, ...otherProcesses]) {
			tree = spliceFrame(tree, ownerIds.get(frame.owner), frame.nodes);
		}
		return tree;
	};

	return {
		read: async (sessionId) => {
			const [{ nodes }, snapshot, metrics] = await Promise.all([
				send(sessionId, "Accessibility.getFullAXTree", {}),
				send(sessionId, "DOMSnapshot.captureSnapshot", SNAPSHOT_PARAMS),
				send(sessionId, "Page.getLayoutMetrics", {}),
			]);
			const scale = devicePixelsPerCss(metrics, snapshot.documents[0]);
			return frameTree(
				sessionId,
				{ nodes, snapshot },
				{ scale, origin: { x: 0, y: 0 }, idPrefix: "" },
			);
		},
	};
}
