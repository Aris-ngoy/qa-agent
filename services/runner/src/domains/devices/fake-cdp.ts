/**
 * A faked Chromium for tests: a local server that answers `/json/version` and speaks
 * enough CDP over its WebSocket for the web Direct lane. It records what reached the page
 * (clicks, text, navigations, keys) in CSS pixels, and serves a viewport-sized PNG that
 * darkens with each click, plus an accessibility tree with whatever nodes it is given and
 * a DOM snapshot that lays them out.
 */
import type { ServerWebSocket } from "bun";
import { encodeRgbaPng } from "../runs/coord-grid";
import type { AxNode } from "./cdp-client";

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

export type FakeCdpOptions = {
	/** The page viewport in CSS pixels. */
	viewport: { width: number; height: number };
	/** Screenshot pixels per CSS pixel. */
	deviceScaleFactor?: number;
	/** The whole page's height in CSS pixels, taller than the viewport when it scrolls. */
	pageHeight?: number;
	/** How far the page is scrolled, in CSS pixels. */
	scroll?: { x: number; y: number };
	/** `Page.navigate`'s `errorText` for a URL the page cannot load. */
	navigateError?: string;
	nodes?: FakeAxNode[];
};

export type FakeCdp = {
	port: number;
	/** Where clicks landed, in CSS pixels. */
	clicks: Array<{ x: number; y: number }>;
	insertedText: string[];
	keys: string[];
	navigations: string[];
	/** The viewport PNG after `clicks` clicks, base64-encoded. */
	frame: (clicks: number) => string;
	/** The user closes the page the session drives; the browser stays open. */
	closePage: () => void;
	/** The browser quits: every socket closes and the port stops answering. */
	kill: () => void;
};

type Message = { id: number; method: string; params?: Record<string, unknown>; sessionId?: string };

const PAGE_ID = "page-1";
const PAGE_SESSION = "session-1";

export function startFakeCdp(options: FakeCdpOptions): FakeCdp {
	const scale = options.deviceScaleFactor ?? 1;
	const nodes = options.nodes ?? [];
	const clicks: FakeCdp["clicks"] = [];
	const insertedText: string[] = [];
	const keys: string[] = [];
	const navigations: string[] = [];
	const sockets = new Set<ServerWebSocket<unknown>>();

	/** A capture beyond the viewport (or clipped to the page) is the whole page. */
	const frame = (count: number, wholePage = false) => {
		const width = options.viewport.width * scale;
		const cssHeight = wholePage
			? (options.pageHeight ?? options.viewport.height)
			: options.viewport.height;
		const height = cssHeight * scale;
		const rgba = new Uint8Array(width * height * 4).fill(Math.max(0, 255 - count));
		return Buffer.from(encodeRgbaPng({ width, height, rgba })).toString("base64");
	};

	const axTree = (): AxNode[] => [
		{
			nodeId: "1",
			role: { value: "RootWebArea" },
			name: { value: "" },
			childIds: nodes.map((_, index) => String(index + 2)),
			backendDOMNodeId: 1,
		},
		...nodes.map((node, index) => ({
			nodeId: String(index + 2),
			...(node.hidden ? { ignored: true } : {}),
			role: { value: node.role },
			name: { value: node.name },
			properties: node.disabled ? [{ name: "disabled", value: { value: true } }] : [],
			parentId: "1",
			childIds: [],
			backendDOMNodeId: index + 2,
		})),
	];

	/**
	 * `DOMSnapshot.captureSnapshot`: the document node, then one element per node with its
	 * attributes, and a layout box in document coordinates for each node that is shown.
	 */
	const domSnapshot = () => {
		const strings: string[] = [];
		const ref = (text: string) => {
			const at = strings.indexOf(text);
			return at >= 0 ? at : strings.push(text) - 1;
		};
		const scroll = options.scroll ?? { x: 0, y: 0 };
		const pageHeight = options.pageHeight ?? options.viewport.height;
		const layout = { nodeIndex: [0], bounds: [[0, 0, options.viewport.width, pageHeight]] };
		nodes.forEach((node, index) => {
			if (node.hidden) return;
			const { x, y, width, height } = node.box;
			layout.nodeIndex.push(index + 1);
			layout.bounds.push([x + scroll.x, y + scroll.y, width, height]);
		});
		const attributes = nodes.map((node) => [
			...(node.domId ? [ref("id"), ref(node.domId)] : []),
			...(node.testId ? [ref("data-testid"), ref(node.testId)] : []),
		]);
		return {
			documents: [
				{
					nodes: {
						parentIndex: [-1, ...nodes.map(() => 0)],
						backendNodeId: [1, ...nodes.map((_, index) => index + 2)],
						attributes: [[], ...attributes],
					},
					layout,
					scrollOffsetX: scroll.x,
					scrollOffsetY: scroll.y,
				},
			],
			strings,
		};
	};

	const answer = (message: Message): unknown => {
		const params = message.params ?? {};
		switch (message.method) {
			case "Target.getTargets":
				return { targetInfos: [{ targetId: PAGE_ID, type: "page", url: "about:blank" }] };
			case "Target.attachToTarget":
				return { sessionId: PAGE_SESSION };
			case "Page.getLayoutMetrics":
				return {
					cssLayoutViewport: {
						clientWidth: options.viewport.width,
						clientHeight: options.viewport.height,
					},
				};
			case "Page.captureScreenshot":
				return {
					data: frame(clicks.length, Boolean(params.captureBeyondViewport || params.clip)),
				};
			case "Page.navigate":
				navigations.push(String(params.url));
				return {
					frameId: PAGE_ID,
					...(options.navigateError ? { errorText: options.navigateError } : {}),
				};
			case "Input.dispatchMouseEvent":
				if (params.type === "mousePressed")
					clicks.push({ x: Number(params.x), y: Number(params.y) });
				return {};
			case "Input.insertText":
				insertedText.push(String(params.text));
				return {};
			case "Input.dispatchKeyEvent":
				if (params.type === "keyDown") keys.push(String(params.key));
				return {};
			case "Accessibility.getFullAXTree":
				return { nodes: axTree() };
			case "DOMSnapshot.captureSnapshot":
				return domSnapshot();
			default:
				return {};
		}
	};

	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request, srv) {
			const url = new URL(request.url);
			if (url.pathname === "/json/version") {
				return Response.json({
					Browser: "Chrome/140.0.0.0",
					webSocketDebuggerUrl: `ws://127.0.0.1:${srv.port}/devtools/browser/fake`,
				});
			}
			if (url.pathname.startsWith("/devtools/browser/") && srv.upgrade(request)) return;
			return new Response("not found", { status: 404 });
		},
		websocket: {
			open(ws) {
				sockets.add(ws);
			},
			close(ws) {
				sockets.delete(ws);
			},
			message(ws, raw) {
				const message = JSON.parse(String(raw)) as Message;
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
		insertedText,
		keys,
		navigations,
		frame,
		closePage: () => {
			for (const ws of sockets) {
				ws.send(
					JSON.stringify({
						method: "Target.detachedFromTarget",
						params: { sessionId: PAGE_SESSION, targetId: PAGE_ID },
					}),
				);
			}
		},
		kill: () => {
			for (const ws of sockets) ws.close();
			server.stop(true);
		},
	};
}
