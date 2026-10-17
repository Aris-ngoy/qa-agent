/**
 * The web Direct lane: CDP straight to a Chromium-family browser, with no driver in
 * between (ADR-0007). This slice attaches to a browser the user started with
 * `--remote-debugging-port`, named by its port (`chromium-cdp-9222`), and drives the first
 * page it has, or a blank one it opens. Disconnecting closes only the DevTools socket;
 * the browser stays open.
 *
 * Coordinates cross the Device Session as 0–1000 of the page viewport, never the browser
 * window, and reach the page in its CSS pixels. The screenshot is that viewport too (in
 * device pixels), so both coordinate spaces convert the same way.
 *
 * The browser closing its socket, or the page going away, is a Dead Session. The Frame
 * Feed is Screenshot Poll (no stream) and the lane does not record. Swipe, drag, alerts
 * and app lifecycle arrive in later slices; until then they reject with a clear message.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
	type CdpClient,
	CdpClosedError,
	type CdpCommands,
	type CdpMethod,
	type DocumentSnapshot,
	connectCdp,
} from "./cdp-client";
import { attachPortOf, browserSocketUrl } from "./chromium-attach";
import {
	type CapturedFrame,
	DeadSessionError,
	type DeviceSession,
	type PointerPhase,
	type SessionOptions,
} from "./lane";
import type { WebAxSource, WebAxSourceNode } from "./screen";
import { SCREENSHOT_DIR } from "./screenshot-retention";

export type WebDirectDeps = {
	/** The CDP WebSocket URL of the browser on `port`. */
	browserSocketUrl: (port: number) => Promise<string>;
	/** Open a CDP client on that URL. */
	connect: (url: string) => Promise<CdpClient>;
};

/** Typed text is cut at a newline, which presses Enter. */
const NEWLINE = /(\r?\n)/;

function notYet(what: string): () => Promise<never> {
	return () => Promise.reject(new Error(`${what} is not available on the web Direct lane yet`));
}

export function webDirectDeps(): WebDirectDeps {
	return { browserSocketUrl: (port) => browserSocketUrl(port), connect: (url) => connectCdp(url) };
}

/** The page the session drives: the browser's first page, or a blank one it opens. */
async function pickPage(client: CdpClient): Promise<string> {
	const { targetInfos } = await client.send("Target.getTargets", {});
	const page = targetInfos.find(
		(target) => target.type === "page" && !target.url.startsWith("devtools://"),
	);
	if (page) return page.targetId;
	return (await client.send("Target.createTarget", { url: "about:blank" })).targetId;
}

type ElementLayout = Pick<WebAxSourceNode, "bounds" | "testId" | "domId">;

/**
 * Each laid-out element of the main frame by its backend node id: its box in the
 * viewport's CSS pixels (the snapshot's are in the document's, so scrolling is taken
 * off) and its `data-testid` and `id` attributes.
 */
function layoutByBackendId(
	documents: DocumentSnapshot[],
	strings: string[],
): Map<number, ElementLayout> {
	const layouts = new Map<number, ElementLayout>();
	const doc = documents[0];
	if (!doc) return layouts;
	const scrollX = doc.scrollOffsetX ?? 0;
	const scrollY = doc.scrollOffsetY ?? 0;
	doc.layout.nodeIndex.forEach((nodeIndex, layoutIndex) => {
		const backendId = doc.nodes.backendNodeId?.[nodeIndex];
		const [x = 0, y = 0, width = 0, height = 0] = doc.layout.bounds[layoutIndex] ?? [];
		if (backendId === undefined || layouts.has(backendId)) return;
		const layout: ElementLayout = { bounds: { x: x - scrollX, y: y - scrollY, width, height } };
		const attributes = doc.nodes.attributes?.[nodeIndex] ?? [];
		for (let at = 0; at + 1 < attributes.length; at += 2) {
			const name = strings[attributes[at] ?? -1];
			const value = strings[attributes[at + 1] ?? -1];
			if (name === "data-testid" && value) layout.testId = value;
			if (name === "id" && value) layout.domId = value;
		}
		layouts.set(backendId, layout);
	});
	return layouts;
}

export async function createWebDirectSession(
	options: SessionOptions,
	deps: WebDirectDeps = webDirectDeps(),
): Promise<DeviceSession> {
	const port = attachPortOf(options.deviceId);
	if (options.platform !== "web" || port === null) {
		throw new Error(
			"The web Direct lane attaches to a Chromium started with --remote-debugging-port; name it chromium-cdp-<port>",
		);
	}

	const client = await deps.connect(await deps.browserSocketUrl(port));
	let sessionId: string;
	try {
		const targetId = await pickPage(client);
		sessionId = (await client.send("Target.attachToTarget", { targetId, flatten: true })).sessionId;
		// A tab in the background never paints, so its screenshot would never come back.
		await client.send("Page.bringToFront", {}, sessionId);
	} catch (error) {
		await client.close().catch(() => undefined);
		throw error;
	}

	let quitting = false;
	let sessionEnded: DeadSessionError | null = null;
	const dead = (reason: string) => {
		if (!sessionEnded) {
			sessionEnded = new DeadSessionError(`Device session ended: ${reason}`);
			if (!quitting) options.onSessionDead?.();
		}
		return sessionEnded;
	};
	void client.closed.then(() => {
		if (!quitting) dead("the browser closed its DevTools connection");
	});
	client.on("Target.detachedFromTarget", (params) => {
		if ((params as { sessionId?: string })?.sessionId === sessionId && !quitting) {
			dead("the page was closed");
		}
	});

	/** One command to the page. A closed socket is a Dead Session. */
	const call = async <M extends CdpMethod>(
		method: M,
		params: CdpCommands[M]["params"],
	): Promise<CdpCommands[M]["result"]> => {
		if (sessionEnded) throw sessionEnded;
		try {
			return await client.send(method, params, sessionId);
		} catch (error) {
			if (error instanceof CdpClosedError && !quitting) throw dead(error.message);
			throw error;
		}
	};

	let chain: Promise<unknown> = Promise.resolve();
	const withActionLock = <T>(fn: () => Promise<T>): Promise<T> => {
		const run = chain.then(fn, fn);
		chain = run.catch(() => undefined);
		return run;
	};

	/** The page viewport in CSS pixels, read each time: the user may resize the window. */
	const getWindowSize = async () => {
		const { cssLayoutViewport } = await call("Page.getLayoutMetrics", {});
		return { width: cssLayoutViewport.clientWidth, height: cssLayoutViewport.clientHeight };
	};

	/** 0–1000 of the viewport to the page's CSS pixels. */
	const toPage = async (xNorm: number, yNorm: number) => {
		const viewport = await getWindowSize();
		return { x: (xNorm / 1000) * viewport.width, y: (yNorm / 1000) * viewport.height };
	};

	/** A left-button mouse event; only a press holds the button down. */
	const mouse = (
		type: "mousePressed" | "mouseReleased" | "mouseMoved",
		point: { x: number; y: number },
	) => {
		if (type === "mouseMoved") {
			return call("Input.dispatchMouseEvent", { type, ...point, button: "none", buttons: 0 });
		}
		return call("Input.dispatchMouseEvent", {
			type,
			...point,
			button: "left",
			buttons: type === "mousePressed" ? 1 : 0,
			clickCount: 1,
		});
	};

	const click = async (xNorm: number, yNorm: number, holdMs = 0) => {
		const point = await toPage(xNorm, yNorm);
		await mouse("mouseMoved", point);
		await mouse("mousePressed", point);
		if (holdMs > 0) await Bun.sleep(holdMs);
		await mouse("mouseReleased", point);
	};

	const pressEnter = async () => {
		const key = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 };
		await call("Input.dispatchKeyEvent", { type: "keyDown", ...key, text: "\r" });
		await call("Input.dispatchKeyEvent", { type: "keyUp", ...key });
	};

	/** Text goes into the focused element as typed; a newline presses Enter. */
	const typeText = async (text: string) => {
		for (const part of text.split(NEWLINE)) {
			if (part === "") continue;
			if (part === "\n" || part === "\r\n") await pressEnter();
			else await call("Input.insertText", { text: part });
		}
	};

	const captureFrame = async (): Promise<CapturedFrame> => {
		const { data } = await call("Page.captureScreenshot", { format: "png" });
		if (!data) throw new Error("The browser returned an empty screenshot");
		return { base64: data, mime: "image/png" };
	};

	const screenshot = async () => {
		await mkdir(SCREENSHOT_DIR, { recursive: true });
		const frame = await captureFrame();
		const path = join(SCREENSHOT_DIR, `shot_${Date.now()}_${crypto.randomUUID()}.png`);
		await Bun.write(path, Uint8Array.from(Buffer.from(frame.base64, "base64")));
		return { path, base64: frame.base64 };
	};

	/**
	 * The page's full accessibility tree, as the JSON the Screen reads. Each node of an
	 * element that is laid out carries its box and ids, from one DOM snapshot, so a large
	 * page costs two commands, not one per node.
	 */
	const pageSource = async () => {
		const [{ nodes }, snapshot] = await Promise.all([
			call("Accessibility.getFullAXTree", {}),
			call("DOMSnapshot.captureSnapshot", { computedStyles: [] }),
		]);
		const layouts = layoutByBackendId(snapshot.documents, snapshot.strings);
		const axTree = nodes.map((node): WebAxSourceNode => {
			const layout =
				node.backendDOMNodeId === undefined ? undefined : layouts.get(node.backendDOMNodeId);
			return layout ? { ...node, ...layout } : node;
		});
		return JSON.stringify({ axTree } satisfies WebAxSource);
	};

	let pointerDown = false;

	return {
		lane: "direct",
		stream: null,
		quit: async () => {
			quitting = true;
			await client.close();
		},
		captureFrame,
		screenshot,
		pageSource,
		getWindowSize,
		tap: (x, y, tapOptions) => withActionLock(() => click(x, y, tapOptions?.durationMs)),
		swipe: notYet("Swiping"),
		drag: notYet("Dragging"),
		type: (text) => withActionLock(() => typeText(text)),
		activateApp: notYet("Activating an app"),
		// A web session opens no app until the App has a Web URL.
		setTargetApp: () => undefined,
		terminateApp: notYet("Terminating an app"),
		backgroundApp: notYet("Backgrounding an app"),
		openUrl: (url) =>
			withActionLock(async () => {
				const { errorText } = await call("Page.navigate", { url });
				if (errorText) throw new Error(`Could not open ${url}: ${errorText}`);
			}),
		acceptAlert: notYet("Accepting an alert"),
		dismissAlert: notYet("Dismissing an alert"),
		withActionLock,
		pointerEvent: async (phase: PointerPhase, xNorm: number, yNorm: number) => {
			const point = await toPage(xNorm, yNorm);
			if (phase === "begin") {
				pointerDown = true;
				await mouse("mouseMoved", point);
				await mouse("mousePressed", point);
			} else if (phase === "move") {
				await call("Input.dispatchMouseEvent", { type: "mouseMoved", ...point, buttons: 1 });
			} else {
				pointerDown = false;
				await mouse("mouseReleased", point);
			}
		},
		isPointerActive: () => pointerDown,
	};
}
