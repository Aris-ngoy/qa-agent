/**
 * A faked Chromium for tests: a local server that answers `/json/version` and speaks
 * enough CDP over its WebSocket for the web Direct lane. It records what reached the page
 * (clicks, mouse, wheel and touch events, text, navigations, keys, dialog answers, cleared
 * storage) in CSS pixels, and serves a viewport-sized PNG that darkens with each click,
 * plus an accessibility tree with whatever nodes it is given and a DOM snapshot that lays
 * them out. As in Chromium, the snapshot's boxes and scroll offset are in the display's
 * device pixels, whatever the emulation, and `Page.getLayoutMetrics` gives the ratio. Pages open and close as targets, the way tabs do, each with its own viewport,
 * and a page can open another as its popup. A page takes device emulation as Chromium
 * does: an emulated viewport replaces its window's, and a touch that ends where it
 * started is a click.
 *
 * A page screencasts as Chromium does: JPEG frames in the display's pixels, scaled down to
 * fit `maxWidth`×`maxHeight`, the next one only once the last is acked. Until the emulation
 * is set again after the screencast starts, a frame is the whole window's view, not the
 * emulated viewport, and its `metadata` says so.
 *
 * A page can hold iframes. A same-origin one is in the page's process: its document is in
 * the page's snapshot, under its owner element, and `Accessibility.getFullAXTree` reads it by
 * its `frameId`. An out-of-process one is a target of its own, attached through
 * `Target.setAutoAttach` as Chromium does with site isolation, with node ids that start
 * over. Either way its boxes are in its own document, which can scroll on its own.
 *
 * With `consent`, it is an everyday browser with the remote-debugging toggle on: `/json/*`
 * answers 404, and each WebSocket waits until the user allows or denies it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ServerWebSocket } from "bun";
import { encodeRgbaPng } from "../runs/coord-grid";
import type { AxNode, KeyEvent } from "./cdp-client";
import type { BrowserProcess } from "./chromium-browsers";

export type FakeAxNode = {
	role: string;
	name: string;
	/** In CSS pixels of the viewport. */
	box: { x: number; y: number; width: number; height: number };
	disabled?: boolean;
	/** The element's `id` attribute. */
	domId?: string;
	/** The element's `data-testid` attribute. */
	testId?: string;
	/** Hidden from assistive technology: an ignored node with no layout box. */
	hidden?: boolean;
};

type FakeBox = { x: number; y: number; width: number; height: number };

/** An iframe on the page, and what is inside it. */
export type FakeFrame = {
	/** A cross-site frame: a target of its own, as Chromium runs it under site isolation. */
	outOfProcess?: boolean;
	url: string;
	/** The iframe element's border box, in CSS pixels of the page viewport. */
	box: FakeBox;
	/** Its border width in CSS pixels: 2 unless given, as Chromium draws an iframe. */
	border?: number;
	/** Its padding in CSS pixels. */
	padding?: number;
	/** How far the frame's own document is scrolled, in CSS pixels. */
	scroll?: { x: number; y: number };
	/** Boxes in CSS pixels of the frame's viewport, its content box. */
	nodes: FakeAxNode[];
};

export type FakeCdpOptions = {
	/** The page viewport in CSS pixels, the window's, until the session emulates another. */
	viewport: { width: number; height: number };
	/** Screenshot pixels per CSS pixel, the display's, until the session emulates another. */
	deviceScaleFactor?: number;
	/** The whole page's height in CSS pixels, taller than the viewport when it scrolls. */
	pageHeight?: number;
	/** How far the page is scrolled, in CSS pixels. */
	scroll?: { x: number; y: number };
	/** `Page.navigate`'s `errorText` for a URL the page cannot load. */
	navigateError?: string;
	nodes?: FakeAxNode[];
	/** The page's iframes. */
	frames?: FakeFrame[];
	/**
	 * A tab that has never painted, such as one behind a browser's sign-in wall:
	 * `Page.getLayoutMetrics` answers zero sizes, as Chromium does.
	 */
	unpainted?: boolean;
	/**
	 * A page with nothing moving: once screencasting, it paints a frame only when something
	 * changes (a scroll, a navigation, a new emulation), as Chromium does. Otherwise a frame
	 * follows every ack, as on a page that keeps animating.
	 */
	still?: boolean;
	/**
	 * Remote debugging by consent (`chrome://inspect/#remote-debugging`): `/json/*` is 404,
	 * and each WebSocket opens only once `allow()` is called, or fails on `deny()`.
	 */
	consent?: boolean;
};

export type FakeMouseEvent = {
	type: "mousePressed" | "mouseReleased" | "mouseMoved";
	x: number;
	y: number;
	buttons: number;
};

export type FakeWheel = { x: number; y: number; deltaX: number; deltaY: number };

export type FakeDialogType = "alert" | "confirm" | "prompt" | "beforeunload";

export type FakeViewport = { width: number; height: number };

export type FakeTouch = {
	type: "touchStart" | "touchMove" | "touchEnd";
	/** The fingers down after the event, in CSS pixels. Empty once the last one lifts. */
	points: Array<{ x: number; y: number }>;
};

/** The device emulation a page is under, as the session set it. */
export type FakeEmulation = {
	viewport: FakeViewport;
	/** Screenshot pixels per CSS pixel. */
	scale: number;
	mobile: boolean;
	/** Touch emulation: the page reports touch support. */
	touch: boolean;
	userAgent?: string;
};

export type FakeCdp = {
	port: number;
	/** Where clicks landed, in CSS pixels. */
	clicks: Array<{ x: number; y: number }>;
	/** Every mouse press, move and release, in order. */
	mouse: FakeMouseEvent[];
	/** Every wheel scroll: where, and by how much. A positive deltaY scrolls the page down. */
	wheels: FakeWheel[];
	/** Every touch event, in order. */
	touches: FakeTouch[];
	insertedText: string[];
	/** The `key` of each key pressed down. */
	keys: string[];
	/** Every key event, down and up, as it reached the page. */
	keyEvents: KeyEvent[];
	navigations: string[];
	/** How each JavaScript dialog was answered. */
	dialogAnswers: Array<{ accept: boolean; promptText?: string }>;
	/** Origins whose storage was cleared. */
	clearedOrigins: string[];
	/** The method of every command the browser was sent, in order. */
	methods: string[];
	/** Every `Page.startScreencast`, with the page it started on. */
	screencastStarts: Array<{ targetId: string } & Record<string, unknown>>;
	/** Every screencast frame sent, in order. */
	screencastFrames: FakeScreencastFrame[];
	/** Whether a page is screencasting, the one in front by default. */
	screencasting: (targetId?: string) => boolean;
	/** The URLs of the open pages, oldest first. */
	pages: () => string[];
	/** Where clicks on one page landed, in its CSS pixels. */
	clicksOn: (targetId: string) => Array<{ x: number; y: number }>;
	/** The page in front, the one the user sees: the newest, or the last brought to front. */
	frontPage: () => string | undefined;
	/** The emulation one page is under, the one in front by default. */
	emulation: (targetId?: string) => FakeEmulation;
	/**
	 * A new page opens and comes to the front. With `fromFrontPage`, the page in front opened
	 * it (`window.open`, a `target=_blank` link, an OAuth popup); otherwise the user did.
	 * Returns its target id.
	 */
	openPage: (url: string, options?: { fromFrontPage?: boolean; viewport?: FakeViewport }) => string;
	/** The page the session drives opens a JavaScript dialog, which waits for an answer. */
	openDialog: (type: FakeDialogType, message?: string, defaultPrompt?: string) => void;
	/** The front page's viewport PNG after `clicks` clicks, base64-encoded. */
	frame: (clicks: number) => string;
	/**
	 * The user follows a link on the page in front: it navigates and loads, with the events
	 * Chromium sends for it.
	 */
	navigate: (url: string) => void;
	/** The user scrolls the page to `to`, in CSS pixels, and it paints the new view. */
	scroll: (to: { x: number; y: number }) => void;
	/** The user closes a page, the one in front by default; the browser stays open. */
	closePage: (targetId?: string) => void;
	/** The browser quits: every socket closes and the port stops answering. */
	kill: () => void;
	/** How many WebSockets were asked for, allowed or not. */
	socketRequests: () => number;
	/** The user clicks Allow on the waiting WebSocket, or the next one (`consent` only). */
	allow: () => void;
	/** The user clicks Deny: the waiting WebSocket, or the next one, fails (`consent` only). */
	deny: () => void;
	/** The params of every `Target.createTarget`, in order. */
	createdTargets: Array<Record<string, unknown>>;
	/** Every target a DevTools session attached to, in order. */
	attachedTargets: string[];
};

type Message = { id: number; method: string; params?: Record<string, unknown>; sessionId?: string };

/** One `Page.screencastFrame` the browser sent, as the session received it. */
export type FakeScreencastFrame = {
	targetId: string;
	/** The view the frame shows, in CSS pixels. */
	deviceWidth: number;
	deviceHeight: number;
	/** The JPEG's own size. */
	width: number;
	height: number;
};

type Screencast = {
	maxWidth?: number;
	maxHeight?: number;
	/** The emulation was set again since the screencast started: frames are the emulated viewport. */
	emulated: boolean;
	/** The frame sent and not yet acked. */
	unacked: number | null;
	/** A still page changed while a frame was unacked: the ack brings the next frame. */
	dirty?: boolean;
	timer?: ReturnType<typeof setTimeout>;
};

type Page = FakeEmulation & {
	targetId: string;
	url: string;
	clicks: Array<{ x: number; y: number }>;
	/** Where the finger now down went down, and whether it has moved since. */
	touchStart?: { x: number; y: number; moved: boolean };
	sessionId?: string;
	openerId?: string;
	/** Between `Page.navigate` and its load event, while the new document comes in. */
	loading?: boolean;
	screencast?: Screencast;
	/** `Page.setLifecycleEventsEnabled`: the page reports each step of a load. */
	lifecycleEvents?: boolean;
};

/** How long a navigation takes to load, as Chrome swaps in the new document. */
const FAKE_LOAD_MS = 20;
/** How long after an ack the next screencast frame comes. */
const FAKE_FRAME_MS = 10;

/**
 * A JPEG's markers without its pixels: SOI, a comment naming `shade`, a baseline frame
 * header of `width`×`height`, EOI. Enough for anything that reads a JPEG's size.
 */
export function fakeJpeg(width: number, height: number, shade: number): Uint8Array {
	const comment = new TextEncoder().encode(`shade ${shade}`);
	const bytes = [0xff, 0xd8, 0xff, 0xfe, 0, comment.length + 2, ...comment];
	bytes.push(0xff, 0xc0, 0, 17, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3);
	for (let component = 1; component <= 3; component++) bytes.push(component, 0x11, 0);
	bytes.push(0xff, 0xd9);
	return Uint8Array.from(bytes);
}

/**
 * The first `count` JPEGs of a multipart MJPEG response, read by each part's
 * Content-Length. Cancels the body once it has them, as a watcher hanging up does.
 */
export async function readMjpegFrames(response: Response, count: number): Promise<Uint8Array[]> {
	const reader = response.body?.getReader();
	if (!reader) throw new Error("The MJPEG response has no body");
	const frames: Uint8Array[] = [];
	let buffer = Buffer.alloc(0);
	while (frames.length < count) {
		const header = buffer.indexOf("\r\n\r\n");
		const length = /Content-Length: (\d+)/i.exec(buffer.subarray(0, header).toString("latin1"));
		if (header >= 0 && length && buffer.length >= header + 4 + Number(length[1])) {
			const start = header + 4;
			frames.push(Uint8Array.from(buffer.subarray(start, start + Number(length[1]))));
			buffer = buffer.subarray(start + Number(length[1]));
			continue;
		}
		const next = await reader.read();
		if (next.done) throw new Error(`The MJPEG stream ended after ${frames.length} frames`);
		buffer = Buffer.concat([buffer, next.value]);
	}
	await reader.cancel();
	return frames;
}

/** A JPEG's size, from its first frame header. */
export function jpegSize(jpeg: Uint8Array): { width: number; height: number } {
	let at = 2;
	while (at + 9 < jpeg.length) {
		const marker = jpeg[at + 1] ?? 0;
		const length = ((jpeg[at + 2] ?? 0) << 8) | (jpeg[at + 3] ?? 0);
		if (marker >= 0xc0 && marker <= 0xc3) {
			return {
				height: ((jpeg[at + 5] ?? 0) << 8) | (jpeg[at + 6] ?? 0),
				width: ((jpeg[at + 7] ?? 0) << 8) | (jpeg[at + 8] ?? 0),
			};
		}
		at += 2 + length;
	}
	throw new Error("Not a JPEG with a frame header");
}

export function startFakeCdp(options: FakeCdpOptions): FakeCdp {
	const scale = options.deviceScaleFactor ?? 1;
	const nodes = options.nodes ?? [];
	const clicks: FakeCdp["clicks"] = [];
	const mouse: FakeMouseEvent[] = [];
	const wheels: FakeWheel[] = [];
	const touches: FakeTouch[] = [];
	const insertedText: string[] = [];
	const keys: string[] = [];
	const keyEvents: KeyEvent[] = [];
	const navigations: string[] = [];
	const dialogAnswers: FakeCdp["dialogAnswers"] = [];
	const clearedOrigins: string[] = [];
	const methods: string[] = [];
	const screencastStarts: FakeCdp["screencastStarts"] = [];
	const screencastFrames: FakeScreencastFrame[] = [];
	let nextScreencastFrame = 1;
	const createdTargets: Array<Record<string, unknown>> = [];
	const attachedTargets: string[] = [];
	let socketRequests = 0;
	/** The WebSockets waiting on the user's Allow or Deny, oldest first. */
	const prompts: Array<(allowed: boolean) => void> = [];
	/** Answers given before their WebSocket was asked for. */
	const answers: boolean[] = [];
	const answerPrompt = (allowed: boolean) => {
		const prompt = prompts.shift();
		if (prompt) prompt(allowed);
		else answers.push(allowed);
	};
	const sockets = new Set<ServerWebSocket<unknown>>();
	const pages: Page[] = [];
	let nextPage = 1;
	let front: Page | undefined;
	let discovering = false;
	let dialogOpen: { sessionId: string } | null = null;
	/** How far the page is scrolled now; `options.scroll` is where its boxes were given. */
	let scrolled = options.scroll ?? { x: 0, y: 0 };

	const broadcast = (method: string, params: unknown, sessionId?: string) => {
		for (const ws of sockets) {
			ws.send(JSON.stringify({ method, params, ...(sessionId ? { sessionId } : {}) }));
		}
	};
	/** The page a command on `sessionId` reaches. */
	const pageOf = (sessionId: string | undefined) => {
		const page = pages.find((candidate) => sessionId && candidate.sessionId === sessionId);
		if (sessionId && !page) throw new Error(`Session with given id not found: ${sessionId}`);
		return page;
	};
	const targetOf = (targetId: unknown) => {
		const page = pages.find((candidate) => candidate.targetId === targetId);
		if (!page) throw new Error("No target with given id found");
		return page;
	};
	const infoOf = ({ targetId, url, openerId }: Page) => ({
		targetId,
		type: "page",
		url,
		...(openerId ? { openerId } : {}),
	});
	const createPage = (url: string, viewport = options.viewport, openerId?: string) => {
		const page: Page = {
			targetId: `page-${nextPage++}`,
			url,
			viewport,
			scale,
			mobile: false,
			touch: false,
			clicks: [],
			openerId,
		};
		pages.push(page);
		front = page;
		if (discovering) broadcast("Target.targetCreated", { targetInfo: infoOf(page) });
		return page;
	};
	createPage("about:blank");
	const stopScreencast = (page: Page) => {
		clearTimeout(page.screencast?.timer);
		page.screencast = undefined;
	};
	/** The page's next screencast frame, sent once the browser has painted it. */
	const sendScreencastFrame = (page: Page, afterMs: number) => {
		const screencast = page.screencast;
		if (!screencast) return;
		clearTimeout(screencast.timer);
		screencast.timer = setTimeout(() => {
			if (page.screencast !== screencast || !page.sessionId) return;
			const view = screencast.emulated ? page.viewport : options.viewport;
			const fit = Math.min(
				1,
				(screencast.maxWidth ?? Number.POSITIVE_INFINITY) / (view.width * scale),
				(screencast.maxHeight ?? Number.POSITIVE_INFINITY) / (view.height * scale),
			);
			const width = Math.round(view.width * scale * fit);
			const height = Math.round(view.height * scale * fit);
			const id = nextScreencastFrame++;
			screencast.unacked = id;
			screencastFrames.push({
				targetId: page.targetId,
				deviceWidth: view.width,
				deviceHeight: view.height,
				width,
				height,
			});
			broadcast(
				"Page.screencastFrame",
				{
					data: Buffer.from(fakeJpeg(width, height, clicks.length)).toString("base64"),
					metadata: {
						deviceWidth: view.width,
						deviceHeight: view.height,
						offsetTop: 0,
						pageScaleFactor: 1,
						scrollOffsetX: scrolled.x,
						scrollOffsetY: scrolled.y,
					},
					sessionId: id,
				},
				page.sessionId,
			);
		}, afterMs);
	};
	/** The page's view changed: a screencast paints it, after the frame in flight is acked. */
	const paint = (page: Page) => {
		const screencast = page.screencast;
		if (!screencast) return;
		if (screencast.unacked === null) sendScreencastFrame(page, FAKE_FRAME_MS);
		else screencast.dirty = true;
	};
	/** A page's document starts loading `url`: navigated, then each lifecycle step, then load. */
	const load = (page: Page, url: string) => {
		page.url = url;
		page.loading = true;
		const frame = { id: page.targetId, loaderId: `loader-${navigations.length}`, url };
		broadcast("Page.frameNavigated", { frame, type: "Navigation" }, page.sessionId);
		const lifecycle = (name: string) => {
			if (!page.lifecycleEvents) return;
			broadcast(
				"Page.lifecycleEvent",
				{ frameId: page.targetId, loaderId: frame.loaderId, name, timestamp: 0 },
				page.sessionId,
			);
		};
		lifecycle("init");
		paint(page);
		// The answer comes as the navigation starts; the load event once it is in.
		setTimeout(() => {
			page.loading = false;
			lifecycle("DOMContentLoaded");
			lifecycle("load");
			broadcast("Page.loadEventFired", { timestamp: 0 }, page.sessionId);
			paint(page);
		}, FAKE_LOAD_MS);
	};
	const closeTarget = (page: Page) => {
		stopScreencast(page);
		pages.splice(pages.indexOf(page), 1);
		if (front === page) front = pages.at(-1);
		if (page.sessionId) {
			broadcast("Target.detachedFromTarget", {
				sessionId: page.sessionId,
				targetId: page.targetId,
			});
		}
	};
	/** A capture beyond the viewport (or clipped to the page) is the whole page. */
	const frame = (count: number, page: FakeEmulation | undefined, wholePage = false) => {
		const viewport = page?.viewport ?? options.viewport;
		const pageScale = page?.scale ?? scale;
		const width = viewport.width * pageScale;
		const cssHeight = wholePage ? (options.pageHeight ?? viewport.height) : viewport.height;
		const height = cssHeight * pageScale;
		const rgba = new Uint8Array(width * height * 4).fill(Math.max(0, 255 - count));
		return Buffer.from(encodeRgbaPng({ width, height, rgba })).toString("base64");
	};

	const frames = options.frames ?? [];
	/**
	 * One document: its own node (`base`, which is also its root's accessibility node id),
	 * then each node from `base + 1` on, in its own coordinates. The page's ends with one
	 * owner element per iframe.
	 */
	type FakeDocument = {
		frameId: string;
		base: number;
		nodes: Array<FakeAxNode & { frame?: FakeFrame }>;
		size: { width: number; height: number };
		/** The scroll its nodes' boxes were given at, in the viewport. */
		given: { x: number; y: number };
		scroll: { x: number; y: number };
	};
	const pageDocument = (page: Page | undefined): FakeDocument => ({
		frameId: page?.targetId ?? "",
		base: 1,
		nodes: [
			...nodes,
			...frames.map((frame) => ({ role: "Iframe", name: "", box: frame.box, frame })),
		],
		size: { width: options.viewport.width, height: options.pageHeight ?? options.viewport.height },
		given: options.scroll ?? { x: 0, y: 0 },
		scroll: scrolled,
	});
	/** Where a frame's content box starts inside its iframe element: its border and padding. */
	const borderOf = (frame: FakeFrame) => frame.border ?? 2;
	const insetOf = (frame: FakeFrame) => borderOf(frame) + (frame.padding ?? 0);
	const frameIdOf = (frame: FakeFrame) => `frame-${frames.indexOf(frame) + 1}`;
	/** A same-origin frame's ids follow the page's in its process; an out-of-process one's start over. */
	const frameDocument = (frame: FakeFrame): FakeDocument => {
		const inset = insetOf(frame);
		return {
			frameId: frameIdOf(frame),
			base: frame.outOfProcess ? 1 : 1000 * (frames.indexOf(frame) + 1),
			nodes: frame.nodes,
			size: { width: frame.box.width - 2 * inset, height: frame.box.height - 2 * inset },
			given: frame.scroll ?? { x: 0, y: 0 },
			scroll: frame.scroll ?? { x: 0, y: 0 },
		};
	};
	/** The iframe element that owns a frame, by its backend node id in the page's document. */
	const ownerIdOf = (frameId: unknown) => {
		const frame = frames.find((candidate) => frameIdOf(candidate) === frameId);
		if (!frame) throw new Error("Frame with the given id was not found.");
		// The page's document is 1 and its nodes follow, then one owner element per frame.
		return 2 + nodes.length + frames.indexOf(frame);
	};

	/** `Accessibility.getFullAXTree` of one document: its root, then each node. */
	const axTree = ({ base, nodes: docNodes }: FakeDocument): AxNode[] => [
		{
			nodeId: String(base),
			role: { value: "RootWebArea" },
			name: { value: "" },
			childIds: docNodes.map((_, index) => String(base + 1 + index)),
			backendDOMNodeId: base,
		},
		...docNodes.map((node, index) => ({
			nodeId: String(base + 1 + index),
			...(node.hidden ? { ignored: true } : {}),
			role: { value: node.role },
			name: { value: node.name },
			properties: node.disabled ? [{ name: "disabled", value: { value: true } }] : [],
			parentId: String(base),
			childIds: [],
			backendDOMNodeId: base + 1 + index,
		})),
	];

	/**
	 * `DOMSnapshot.captureSnapshot` of some documents: each document node, then one element
	 * per node with its attributes, and a layout box in document coordinates for each node
	 * that is shown. As in Chromium, boxes and the scroll offset are in the display's device
	 * pixels; with `includeDOMRects`, each box's `offsetRects` and `clientRects` entries are
	 * in CSS pixels. An iframe element whose document is in the snapshot points at it.
	 */
	const domSnapshot = (
		docs: FakeDocument[],
		params: { includeDOMRects?: unknown; computedStyles?: unknown },
	) => {
		const strings: string[] = [];
		const ref = (text: string) => {
			const at = strings.indexOf(text);
			return at >= 0 ? at : strings.push(text) - 1;
		};
		const computedStyles = Array.isArray(params.computedStyles)
			? params.computedStyles.map(String)
			: [];
		const documents = docs.map((doc) => {
			const { given, scroll } = doc;
			const css = [[0, 0, doc.size.width, doc.size.height]];
			const client = [[0, 0, doc.size.width, doc.size.height]];
			const styles = [computedStyles.map(() => ref("0px"))];
			const nodeIndex = [0];
			const contentDocumentIndex = { index: [] as number[], value: [] as number[] };
			doc.nodes.forEach((node, index) => {
				const inProcess = node.frame && !node.frame.outOfProcess ? node.frame : undefined;
				const childDoc = inProcess ? docs.findIndex((d) => d.frameId === frameIdOf(inProcess)) : -1;
				if (childDoc >= 0) {
					contentDocumentIndex.index.push(index + 1);
					contentDocumentIndex.value.push(childDoc);
				}
				if (node.hidden) return;
				const { x, y, width, height } = node.box;
				const border = node.frame ? borderOf(node.frame) : 0;
				const padding = node.frame?.padding ?? 0;
				nodeIndex.push(index + 1);
				css.push([x + given.x, y + given.y, width, height]);
				client.push([border, border, width - 2 * border, height - 2 * border]);
				styles.push(
					computedStyles.map((name) =>
						ref(name === "padding-left" || name === "padding-top" ? `${padding}px` : ""),
					),
				);
			});
			const attributes = doc.nodes.map((node) => [
				...(node.domId ? [ref("id"), ref(node.domId)] : []),
				...(node.testId ? [ref("data-testid"), ref(node.testId)] : []),
			]);
			return {
				frameId: ref(doc.frameId),
				nodes: {
					parentIndex: [-1, ...doc.nodes.map(() => 0)],
					backendNodeId: [doc.base, ...doc.nodes.map((_, index) => doc.base + 1 + index)],
					attributes: [[], ...attributes],
					contentDocumentIndex,
				},
				layout: {
					nodeIndex,
					bounds: css.map((box) => box.map((value) => value * scale)),
					...(params.includeDOMRects ? { offsetRects: css, clientRects: client } : {}),
					...(computedStyles.length > 0 ? { styles } : {}),
				},
				scrollOffsetX: scroll.x * scale,
				scrollOffsetY: scroll.y * scale,
			};
		});
		return { documents, strings };
	};
	/** The page's document, then each same-origin frame's: one process's documents. */
	const pageDocuments = (page: Page | undefined) => [
		pageDocument(page),
		...frames.filter((frame) => !frame.outOfProcess).map(frameDocument),
	];
	/** The out-of-process frames attached to a page's session, by their own session. */
	const frameSessions = new Map<string, FakeFrame>();
	const frameSessionOf = (page: Page, frame: FakeFrame) => `${page.sessionId}-${frameIdOf(frame)}`;

	/** A command to an out-of-process frame's own session. */
	const answerFrame = (message: Message, frame: FakeFrame): unknown => {
		const params = message.params ?? {};
		switch (message.method) {
			case "Accessibility.getFullAXTree":
				return { nodes: axTree(frameDocument(frame)) };
			case "DOMSnapshot.captureSnapshot":
				return domSnapshot([frameDocument(frame)], params);
			default:
				return {};
		}
	};

	const answer = (message: Message): unknown => {
		const params = message.params ?? {};
		const outOfProcess = message.sessionId ? frameSessions.get(message.sessionId) : undefined;
		if (outOfProcess) return answerFrame(message, outOfProcess);
		const page = pageOf(message.sessionId);
		switch (message.method) {
			case "Browser.getVersion":
				return { product: "Chrome/140.0.0.0" };
			case "Target.getTargets":
				return { targetInfos: pages.map(infoOf) };
			case "Target.getTargetInfo":
				return { targetInfo: infoOf(targetOf(params.targetId)) };
			case "Target.setDiscoverTargets":
				// As Chrome does, the pages already open are announced before the answer.
				discovering = Boolean(params.discover);
				if (discovering) {
					for (const open of pages) broadcast("Target.targetCreated", { targetInfo: infoOf(open) });
				}
				return {};
			case "Target.createTarget":
				createdTargets.push(params);
				return { targetId: createPage(String(params.url)).targetId };
			case "Target.attachToTarget": {
				const target = targetOf(params.targetId);
				attachedTargets.push(target.targetId);
				target.sessionId = `session-${target.targetId}`;
				return { sessionId: target.sessionId };
			}
			case "Target.closeTarget": {
				const target = targetOf(params.targetId);
				closeTarget(target);
				return { success: true };
			}
			case "Page.bringToFront":
				if (page) front = page;
				return {};
			case "Page.captureScreenshot":
				// As in Chrome, a page swapping in a new document cannot be captured.
				if (page?.loading) throw new Error("Not attached to an active page");
				return {
					data: frame(clicks.length, page, Boolean(params.captureBeyondViewport || params.clip)),
				};
			case "Emulation.setDeviceMetricsOverride":
				if (page) {
					page.viewport = { width: Number(params.width), height: Number(params.height) };
					// 0 keeps the window's own scale, as in Chromium.
					if (Number(params.deviceScaleFactor) > 0) page.scale = Number(params.deviceScaleFactor);
					page.mobile = Boolean(params.mobile);
					if (page.screencast) page.screencast.emulated = true;
					if (options.still) paint(page);
				}
				return {};
			case "Page.startScreencast":
				if (!page) return {};
				stopScreencast(page);
				screencastStarts.push({ targetId: page.targetId, ...params });
				page.screencast = {
					maxWidth: params.maxWidth === undefined ? undefined : Number(params.maxWidth),
					maxHeight: params.maxHeight === undefined ? undefined : Number(params.maxHeight),
					emulated: false,
					unacked: null,
				};
				sendScreencastFrame(page, 0);
				return {};
			case "Page.screencastFrameAck":
				if (page?.screencast && page.screencast.unacked === Number(params.sessionId)) {
					page.screencast.unacked = null;
					if (!options.still || page.screencast.dirty) {
						page.screencast.dirty = false;
						sendScreencastFrame(page, FAKE_FRAME_MS);
					}
				}
				return {};
			case "Page.stopScreencast":
				if (page) stopScreencast(page);
				return {};
			case "Page.setLifecycleEventsEnabled":
				if (page) page.lifecycleEvents = Boolean(params.enabled);
				return {};
			case "Emulation.setTouchEmulationEnabled":
				if (page) page.touch = Boolean(params.enabled);
				return {};
			case "Emulation.setUserAgentOverride":
				if (page) page.userAgent = String(params.userAgent);
				return {};
			case "Input.dispatchTouchEvent": {
				const type = params.type as FakeTouch["type"];
				const points = ((params.touchPoints ?? []) as Array<{ x: number; y: number }>).map(
					({ x, y }) => ({ x, y }),
				);
				touches.push({ type, points });
				const [point] = points;
				if (!page) return {};
				if (type === "touchStart" && point) page.touchStart = { ...point, moved: false };
				if (type === "touchMove" && page.touchStart && point) {
					page.touchStart.moved ||= point.x !== page.touchStart.x || point.y !== page.touchStart.y;
				}
				if (type === "touchEnd" && page.touchStart) {
					const { x, y, moved } = page.touchStart;
					if (!moved) {
						clicks.push({ x, y });
						page.clicks.push({ x, y });
					}
					page.touchStart = undefined;
				}
				return {};
			}
			case "Page.navigate":
				navigations.push(String(params.url));
				if (page && !options.navigateError) load(page, String(params.url));
				return {
					frameId: page?.targetId ?? "",
					...(options.navigateError
						? { errorText: options.navigateError }
						: { loaderId: `loader-${navigations.length}` }),
				};
			case "Page.handleJavaScriptDialog":
				if (!dialogOpen || dialogOpen.sessionId !== message.sessionId) {
					throw new Error("No dialog is showing");
				}
				dialogOpen = null;
				dialogAnswers.push({
					accept: Boolean(params.accept),
					...(params.promptText !== undefined ? { promptText: String(params.promptText) } : {}),
				});
				return {};
			case "Storage.clearDataForOrigin":
				clearedOrigins.push(String(params.origin));
				return {};
			case "Input.dispatchMouseEvent": {
				const point = { x: Number(params.x), y: Number(params.y) };
				if (params.type === "mouseWheel") {
					wheels.push({ ...point, deltaX: Number(params.deltaX), deltaY: Number(params.deltaY) });
					return {};
				}
				if (params.type === "mousePressed") {
					clicks.push(point);
					page?.clicks.push(point);
				}
				mouse.push({
					type: params.type as FakeMouseEvent["type"],
					...point,
					buttons: Number(params.buttons ?? 0),
				});
				return {};
			}
			case "Input.insertText":
				insertedText.push(String(params.text));
				return {};
			case "Input.dispatchKeyEvent":
				keyEvents.push(params as KeyEvent);
				if (params.type !== "keyUp") keys.push(String(params.key));
				return {};
			case "Accessibility.getFullAXTree": {
				const doc = pageDocuments(page).find((candidate, index) =>
					params.frameId === undefined ? index === 0 : candidate.frameId === params.frameId,
				);
				if (!doc) throw new Error("Frame with the given frameId is not found.");
				return { nodes: axTree(doc) };
			}
			case "DOMSnapshot.captureSnapshot":
				return domSnapshot(pageDocuments(page), params);
			case "DOM.getFrameOwner":
				return { backendNodeId: ownerIdOf(params.frameId) };
			case "Target.setAutoAttach":
				// As Chrome does, the frames already there are attached before the answer.
				if (!page || !params.autoAttach || !params.flatten) return {};
				for (const outOfProcess of frames.filter((candidate) => candidate.outOfProcess)) {
					const sessionId = frameSessionOf(page, outOfProcess);
					if (frameSessions.has(sessionId)) continue;
					frameSessions.set(sessionId, outOfProcess);
					broadcast(
						"Target.attachedToTarget",
						{
							sessionId,
							targetInfo: {
								targetId: frameIdOf(outOfProcess),
								type: "iframe",
								url: outOfProcess.url,
								attached: true,
							},
							waitingForDebugger: false,
						},
						page.sessionId,
					);
				}
				return {};
			case "Page.getLayoutMetrics": {
				const { width, height } = page?.viewport ?? options.viewport;
				const ratio = options.unpainted ? 0 : 1;
				const viewport = (pixels: number) => ({
					pageX: 0,
					pageY: 0,
					clientWidth: width * pixels * ratio,
					clientHeight: height * pixels * ratio,
				});
				return { layoutViewport: viewport(scale), cssLayoutViewport: viewport(1) };
			}
			default:
				return {};
		}
	};

	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request, srv) {
			const url = new URL(request.url);
			if (options.consent && url.pathname.startsWith("/devtools/browser/")) {
				socketRequests += 1;
				const allowed =
					answers.shift() ?? (await new Promise<boolean>((resolve) => prompts.push(resolve)));
				if (allowed && srv.upgrade(request)) return;
				return new Response("denied", { status: 403 });
			}
			if (options.consent) return new Response("not found", { status: 404 });
			if (url.pathname === "/json/version") {
				return Response.json({
					Browser: "Chrome/140.0.0.0",
					webSocketDebuggerUrl: `ws://127.0.0.1:${srv.port}/devtools/browser/fake`,
				});
			}
			if (url.pathname.startsWith("/devtools/browser/")) {
				socketRequests += 1;
				if (srv.upgrade(request)) return;
			}
			return new Response("not found", { status: 404 });
		},
		websocket: {
			open(ws) {
				sockets.add(ws);
			},
			close(ws) {
				sockets.delete(ws);
				// A page's screencast ends with the DevTools session that started it.
				if (sockets.size === 0) for (const page of pages) stopScreencast(page);
			},
			message(ws, raw) {
				const message = JSON.parse(String(raw)) as Message;
				methods.push(message.method);
				const session = message.sessionId ? { sessionId: message.sessionId } : {};
				try {
					ws.send(JSON.stringify({ id: message.id, result: answer(message), ...session }));
				} catch (error) {
					const text = error instanceof Error ? error.message : String(error);
					ws.send(
						JSON.stringify({ id: message.id, error: { code: -32000, message: text }, ...session }),
					);
				}
			},
		},
	});
	server.unref();

	return {
		port: server.port ?? 0,
		clicks,
		mouse,
		wheels,
		touches,
		insertedText,
		keys,
		keyEvents,
		navigations,
		dialogAnswers,
		clearedOrigins,
		methods,
		screencastStarts,
		screencastFrames,
		screencasting: (targetId) => {
			const page = targetId === undefined ? front : targetOf(targetId);
			return Boolean(page?.screencast);
		},
		pages: () => pages.map((page) => page.url),
		clicksOn: (targetId) => targetOf(targetId).clicks,
		frontPage: () => front?.targetId,
		emulation: (targetId) => {
			const page = targetId === undefined ? front : targetOf(targetId);
			if (!page) throw new Error("No page is open");
			const { viewport, scale: pageScale, mobile, touch, userAgent } = page;
			return { viewport, scale: pageScale, mobile, touch, userAgent };
		},
		openPage: (url, { fromFrontPage = false, viewport } = {}) =>
			createPage(url, viewport, fromFrontPage ? front?.targetId : undefined).targetId,
		openDialog: (type, message = "", defaultPrompt = "") => {
			const driven = front;
			if (!driven?.sessionId) throw new Error("No page is attached");
			dialogOpen = { sessionId: driven.sessionId };
			broadcast(
				"Page.javascriptDialogOpening",
				{ url: driven.url, message, type, hasBrowserHandler: false, defaultPrompt },
				driven.sessionId,
			);
		},
		frame: (count) => frame(count, front),
		navigate: (url) => {
			if (!front) throw new Error("No page is open");
			navigations.push(url);
			load(front, url);
		},
		scroll: (to) => {
			scrolled = to;
			if (front) paint(front);
		},
		closePage: (targetId) => {
			const page = targetId === undefined ? front : targetOf(targetId);
			if (page) closeTarget(page);
		},
		kill: () => {
			for (const page of pages) stopScreencast(page);
			for (const ws of sockets) ws.close();
			for (const answer of prompts.splice(0)) answer(false);
			server.stop(true);
		},
		socketRequests: () => socketRequests,
		allow: () => answerPrompt(true),
		deny: () => answerPrompt(false),
		createdTargets,
		attachedTargets,
	};
}

/** The `--user-data-dir` a browser command line names, or null when it names none. */
export function profileDirOf(command: string[]): string | null {
	const flag = "--user-data-dir=";
	return command.find((arg) => arg.startsWith(flag))?.slice(flag.length) ?? null;
}

export type FakeChromium = {
	/** Stands in for `Bun.spawn` of an installed browser. */
	spawn: (command: string[]) => BrowserProcess;
	/** Every command line it was launched with. */
	launched: string[][];
	/** One faked CDP endpoint per launch, in launch order. */
	browsers: FakeCdp[];
	/** How many times a launched browser was killed. */
	kills: number;
};

/**
 * An installed Chromium at its launch protocol: each spawn starts a faked CDP endpoint and
 * writes its port to `DevToolsActivePort` in the `--user-data-dir` it was given, as Chrome
 * does for `--remote-debugging-port=0`, or in `portFileDir` under it, as Dia does. Killing
 * it quits that browser.
 */
export function fakeChromium(
	options: FakeCdpOptions,
	{ portFileDir = "" }: { portFileDir?: string } = {},
): FakeChromium {
	const fake: FakeChromium = {
		launched: [],
		browsers: [],
		kills: 0,
		spawn: (command) => {
			fake.launched.push(command);
			const profile = profileDirOf(command);
			if (!profile) throw new Error("fakeChromium: no --user-data-dir");
			const browser = startFakeCdp(options);
			fake.browsers.push(browser);
			mkdirSync(join(profile, portFileDir), { recursive: true });
			writeFileSync(
				join(profile, portFileDir, "DevToolsActivePort"),
				`${browser.port}\n/devtools/browser/fake\n`,
			);
			let exit: (code: number) => void = () => undefined;
			const exited = new Promise<number>((resolve) => {
				exit = resolve;
			});
			return {
				exited,
				stderr: null,
				kill: () => {
					fake.kills += 1;
					browser.kill();
					exit(143);
				},
			};
		},
	};
	return fake;
}
