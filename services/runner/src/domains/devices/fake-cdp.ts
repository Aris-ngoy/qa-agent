/**
 * A faked Chromium for tests: a local server that answers `/json/version` and speaks
 * enough CDP over its WebSocket for the web Direct lane. It records what reached the page
 * (clicks, mouse and wheel events, text, navigations, keys, dialog answers, cleared
 * storage) in CSS pixels, and serves a viewport-sized PNG that darkens with each click,
 * plus an accessibility tree with whatever nodes it is given and a DOM snapshot that lays
 * them out. Pages open and close as targets, the way tabs do.
 */
import { writeFileSync } from "node:fs";
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

export type FakeMouseEvent = {
	type: "mousePressed" | "mouseReleased" | "mouseMoved";
	x: number;
	y: number;
	buttons: number;
};

export type FakeWheel = { x: number; y: number; deltaX: number; deltaY: number };

export type FakeDialogType = "alert" | "confirm" | "prompt" | "beforeunload";

export type FakeCdp = {
	port: number;
	/** Where clicks landed, in CSS pixels. */
	clicks: Array<{ x: number; y: number }>;
	/** Every mouse press, move and release, in order. */
	mouse: FakeMouseEvent[];
	/** Every wheel scroll: where, and by how much. A positive deltaY scrolls the page down. */
	wheels: FakeWheel[];
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
	/** The URLs of the open pages, oldest first. */
	pages: () => string[];
	/** The page the session drives opens a JavaScript dialog, which waits for an answer. */
	openDialog: (type: FakeDialogType, message?: string, defaultPrompt?: string) => void;
	/** The viewport PNG after `clicks` clicks, base64-encoded. */
	frame: (clicks: number) => string;
	/** The user closes the page the session drives; the browser stays open. */
	closePage: () => void;
	/** The browser quits: every socket closes and the port stops answering. */
	kill: () => void;
};

type Message = { id: number; method: string; params?: Record<string, unknown>; sessionId?: string };

type Page = { targetId: string; url: string; sessionId?: string };

export function startFakeCdp(options: FakeCdpOptions): FakeCdp {
	const scale = options.deviceScaleFactor ?? 1;
	const nodes = options.nodes ?? [];
	const clicks: FakeCdp["clicks"] = [];
	const mouse: FakeMouseEvent[] = [];
	const wheels: FakeWheel[] = [];
	const insertedText: string[] = [];
	const keys: string[] = [];
	const keyEvents: KeyEvent[] = [];
	const navigations: string[] = [];
	const dialogAnswers: FakeCdp["dialogAnswers"] = [];
	const clearedOrigins: string[] = [];
	const sockets = new Set<ServerWebSocket<unknown>>();
	const pages: Page[] = [{ targetId: "page-1", url: "about:blank" }];
	let nextPage = 2;
	let dialogOpen: { sessionId: string } | null = null;

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
	const closeTarget = (page: Page) => {
		pages.splice(pages.indexOf(page), 1);
		if (page.sessionId) {
			broadcast("Target.detachedFromTarget", {
				sessionId: page.sessionId,
				targetId: page.targetId,
			});
		}
	};
	/** The page a session drives now: the last one attached. */
	const drivenPage = () => pages.filter((page) => page.sessionId).at(-1);

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
		const page = pageOf(message.sessionId);
		switch (message.method) {
			case "Target.getTargets":
				return {
					targetInfos: pages.map(({ targetId, url }) => ({ targetId, type: "page", url })),
				};
			case "Target.getTargetInfo": {
				const target = targetOf(params.targetId);
				return { targetInfo: { targetId: target.targetId, type: "page", url: target.url } };
			}
			case "Target.createTarget": {
				const created = { targetId: `page-${nextPage++}`, url: String(params.url) };
				pages.push(created);
				return { targetId: created.targetId };
			}
			case "Target.attachToTarget": {
				const target = targetOf(params.targetId);
				target.sessionId = `session-${target.targetId}`;
				return { sessionId: target.sessionId };
			}
			case "Target.closeTarget": {
				const target = targetOf(params.targetId);
				closeTarget(target);
				return { success: true };
			}
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
				if (page && !options.navigateError) page.url = String(params.url);
				return {
					frameId: page?.targetId ?? "",
					...(options.navigateError ? { errorText: options.navigateError } : {}),
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
				if (params.type === "mousePressed") clicks.push(point);
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
		mouse,
		wheels,
		insertedText,
		keys,
		keyEvents,
		navigations,
		dialogAnswers,
		clearedOrigins,
		pages: () => pages.map((page) => page.url),
		openDialog: (type, message = "", defaultPrompt = "") => {
			const driven = drivenPage();
			if (!driven?.sessionId) throw new Error("No page is attached");
			dialogOpen = { sessionId: driven.sessionId };
			broadcast(
				"Page.javascriptDialogOpening",
				{ url: driven.url, message, type, hasBrowserHandler: false, defaultPrompt },
				driven.sessionId,
			);
		},
		frame,
		closePage: () => {
			const driven = drivenPage();
			if (driven) closeTarget(driven);
		},
		kill: () => {
			for (const ws of sockets) ws.close();
			server.stop(true);
		},
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
 * does for `--remote-debugging-port=0`. Killing it quits that browser.
 */
export function fakeChromium(options: FakeCdpOptions): FakeChromium {
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
			writeFileSync(
				join(profile, "DevToolsActivePort"),
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
