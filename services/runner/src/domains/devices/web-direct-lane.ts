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
 * Shared cases keep their meaning in the browser. A swipe scrolls the content under its
 * start point with the wheel, as a finger would. A drag is a mouse press, move and release.
 * An alert is the page's JavaScript dialog. On web, an app id is the App's Web URL:
 * terminate-app closes the App's page, activate-app opens it again, and restart-app does
 * both with the origin's storage cleared in between. A page has no background, so
 * background-app fails.
 *
 * The browser closing its socket, or the page going away, is a Dead Session. The Frame
 * Feed is Screenshot Poll (no stream) and the lane does not record.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { KEY_NAMES, type KeyModifier, type KeyName } from "@yoqa/runner-client";
import {
	type CdpClient,
	CdpClosedError,
	CdpCommandError,
	type CdpCommands,
	type CdpMethod,
	type DocumentSnapshot,
	type KeyEvent,
	connectCdp,
} from "./cdp-client";
import { attachPortOf, browserSocketUrl } from "./chromium-attach";
import {
	ActionUnsupportedError,
	type CapturedFrame,
	DeadSessionError,
	type DeviceSession,
	type KeySupport,
	type PointerPhase,
	type SessionOptions,
	assertKeySupported,
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

/** A drag moves the held button in this many steps, so the page sees it travel. */
const DRAG_STEPS = 10;
const DEFAULT_DRAG_MS = 800;

type CdpKey = Pick<KeyEvent, "key" | "code" | "windowsVirtualKeyCode" | "text">;

/** The `key` Action's keys as the page sees them. Only Enter and Space type a character. */
export const CDP_KEYS: Record<KeyName, CdpKey> = {
	Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
	Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
	Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
	Backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
	Delete: { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 },
	ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
	ArrowDown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
	ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
	ArrowRight: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
	Home: { key: "Home", code: "Home", windowsVirtualKeyCode: 36 },
	End: { key: "End", code: "End", windowsVirtualKeyCode: 35 },
	PageUp: { key: "PageUp", code: "PageUp", windowsVirtualKeyCode: 33 },
	PageDown: { key: "PageDown", code: "PageDown", windowsVirtualKeyCode: 34 },
	Space: { key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " },
};

/** The left-hand modifier keys, and the bit each sets in a key event's `modifiers`. */
export const CDP_MODIFIERS: Record<KeyModifier, CdpKey & { bit: number }> = {
	Shift: { key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16, bit: 8 },
	Control: { key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17, bit: 2 },
	Alt: { key: "Alt", code: "AltLeft", windowsVirtualKeyCode: 18, bit: 1 },
	Meta: { key: "Meta", code: "MetaLeft", windowsVirtualKeyCode: 91, bit: 4 },
};

/** A page takes every key, with any modifiers. */
const WEB_KEY_SUPPORT: KeySupport = { keys: KEY_NAMES, modifiers: true };

type JavaScriptDialog = { type: string; defaultPrompt?: string };

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

/** On web an app id is the App's Web URL, the page the App starts on. */
function webUrlOf(appId: string): URL {
	const url = URL.canParse(appId) ? new URL(appId) : null;
	if (url?.protocol !== "http:" && url?.protocol !== "https:") {
		throw new Error(`On web an app is its Web URL (http or https), and "${appId}" is not one`);
	}
	return url;
}

function originOf(url: string): string | null {
	return URL.canParse(url) ? new URL(url).origin : null;
}

/**
 * Attach to a page so the session can drive it. Enabling the Page domain is what makes a
 * JavaScript dialog wait for the session's answer, and a tab in the background never
 * paints, so its screenshot would never come back.
 */
async function attachPage(
	client: CdpClient,
	targetId: string,
): Promise<{ targetId: string; sessionId: string }> {
	const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
	await client.send("Page.enable", {}, sessionId);
	await client.send("Page.bringToFront", {}, sessionId);
	return { targetId, sessionId };
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
	/** The page the session drives. terminate-app swaps it for a blank one. */
	let page: { targetId: string; sessionId: string };
	try {
		page = await attachPage(client, await pickPage(client));
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
		if ((params as { sessionId?: string })?.sessionId === page.sessionId && !quitting) {
			dead("the page was closed");
		}
	});

	let openDialog: JavaScriptDialog | null = null;
	client.on("Page.javascriptDialogOpening", (params, eventSession) => {
		if (eventSession === page.sessionId) openDialog = params as JavaScriptDialog;
	});
	client.on("Page.javascriptDialogClosed", (_params, eventSession) => {
		if (eventSession === page.sessionId) openDialog = null;
	});

	/** Talk to the browser once the session is up. A closed socket is a Dead Session. */
	const guarded = async <T>(fn: () => Promise<T>): Promise<T> => {
		if (sessionEnded) throw sessionEnded;
		try {
			return await fn();
		} catch (error) {
			if (error instanceof CdpClosedError && !quitting) throw dead(error.message);
			throw error;
		}
	};

	/** One command to the page. */
	const call = <M extends CdpMethod>(method: M, params: CdpCommands[M]["params"]) =>
		guarded(() => client.send(method, params, page.sessionId));

	/** One command to the browser itself (targets, storage). */
	const callBrowser = <M extends CdpMethod>(method: M, params: CdpCommands[M]["params"]) =>
		guarded(() => client.send(method, params));

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

	/**
	 * A left-button mouse event; a press holds the button down, and a move carries it while
	 * `held`.
	 */
	const mouse = (
		type: "mousePressed" | "mouseReleased" | "mouseMoved",
		point: { x: number; y: number },
		held = false,
	) => {
		if (type === "mouseMoved") {
			return call("Input.dispatchMouseEvent", {
				type,
				...point,
				button: held ? "left" : "none",
				buttons: held ? 1 : 0,
			});
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

	/** A swipe carries the content with the finger, so the page scrolls the other way. */
	const scroll = async (x1: number, y1: number, x2: number, y2: number) => {
		const from = await toPage(x1, y1);
		const to = await toPage(x2, y2);
		await call("Input.dispatchMouseEvent", {
			type: "mouseWheel",
			...from,
			deltaX: from.x - to.x,
			deltaY: from.y - to.y,
		});
	};

	const drag = async (
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		durationMs = DEFAULT_DRAG_MS,
	) => {
		const from = await toPage(x1, y1);
		const to = await toPage(x2, y2);
		await mouse("mouseMoved", from);
		await mouse("mousePressed", from);
		for (let step = 1; step <= DRAG_STEPS; step++) {
			await Bun.sleep(durationMs / DRAG_STEPS);
			const t = step / DRAG_STEPS;
			const point = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
			await mouse("mouseMoved", point, true);
		}
		await mouse("mouseReleased", to);
	};

	/** Accepting a prompt keeps its default answer, as pressing OK would. */
	const answerDialog = async (accept: boolean) => {
		const promptText =
			accept && openDialog?.type === "prompt" ? (openDialog.defaultPrompt ?? "") : undefined;
		try {
			await call("Page.handleJavaScriptDialog", {
				accept,
				...(promptText !== undefined ? { promptText } : {}),
			});
		} catch (error) {
			if (error instanceof CdpCommandError && /no dialog is showing/i.test(error.message)) {
				throw new Error("No JavaScript dialog is open on the page");
			}
			throw error;
		}
		openDialog = null;
	};

	const navigate = async (url: string) => {
		const { errorText } = await call("Page.navigate", { url });
		if (errorText) throw new Error(`Could not open ${url}: ${errorText}`);
	};

	/** Closing the browser's last tab can quit it, so a blank page takes over first. */
	const closeAppPage = async () => {
		const appPage = page;
		const { targetId } = await callBrowser("Target.createTarget", { url: "about:blank" });
		page = await guarded(() => attachPage(client, targetId));
		openDialog = null;
		await callBrowser("Target.closeTarget", { targetId: appPage.targetId });
	};

	/** A page already on the App's origin is the App running; anything else opens it. */
	const openApp = async (url: URL) => {
		const { targetInfo } = await callBrowser("Target.getTargetInfo", { targetId: page.targetId });
		if (originOf(targetInfo.url) === url.origin) await call("Page.bringToFront", {});
		else await navigate(url.href);
	};

	/**
	 * Press `name` with `modifiers` held: each modifier goes down first and comes up last,
	 * as on a keyboard. Under Control, Alt or Meta the key types nothing (a shortcut).
	 */
	const pressKey = async (name: KeyName, modifiers: readonly KeyModifier[] = []) => {
		let held = 0;
		for (const modifier of modifiers) {
			const { bit, ...key } = CDP_MODIFIERS[modifier];
			held |= bit;
			await call("Input.dispatchKeyEvent", { type: "rawKeyDown", ...key, modifiers: held });
		}
		const { text, ...key } = CDP_KEYS[name];
		const shortcut = modifiers.some((modifier) => modifier !== "Shift");
		await call(
			"Input.dispatchKeyEvent",
			text && !shortcut
				? { type: "keyDown", ...key, text, modifiers: held }
				: { type: "rawKeyDown", ...key, modifiers: held },
		);
		await call("Input.dispatchKeyEvent", { type: "keyUp", ...key, modifiers: held });
		for (const modifier of [...modifiers].reverse()) {
			const { bit, ...key } = CDP_MODIFIERS[modifier];
			held &= ~bit;
			await call("Input.dispatchKeyEvent", { type: "keyUp", ...key, modifiers: held });
		}
	};

	/** Text goes into the focused element as typed; a newline presses Enter. */
	const typeText = async (text: string) => {
		for (const part of text.split(NEWLINE)) {
			if (part === "") continue;
			if (part === "\n" || part === "\r\n") await pressKey("Enter");
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
		swipe: (x1, y1, x2, y2) => withActionLock(() => scroll(x1, y1, x2, y2)),
		drag: (x1, y1, x2, y2, durationMs) => withActionLock(() => drag(x1, y1, x2, y2, durationMs)),
		type: (text) => withActionLock(() => typeText(text)),
		keySupport: WEB_KEY_SUPPORT,
		key: async (name, modifiers = []) => {
			assertKeySupported(WEB_KEY_SUPPORT, "on the web", name, modifiers);
			await withActionLock(() => pressKey(name, modifiers));
		},
		activateApp: (appId) => withActionLock(() => openApp(webUrlOf(appId))),
		// A web session opens no app until the App has a Web URL.
		setTargetApp: () => undefined,
		terminateApp: (appId) =>
			withActionLock(async () => {
				webUrlOf(appId);
				await closeAppPage();
			}),
		restartApp: (appId) =>
			withActionLock(async () => {
				const url = webUrlOf(appId);
				await closeAppPage();
				await callBrowser("Storage.clearDataForOrigin", {
					origin: url.origin,
					storageTypes: "all",
				});
				await navigate(url.href);
			}),
		backgroundApp: () =>
			Promise.reject(
				new ActionUnsupportedError(
					"background-app is not supported on web: a browser page has no background to send it to",
				),
			),
		openUrl: (url) => withActionLock(() => navigate(url)),
		acceptAlert: () => withActionLock(() => answerDialog(true)),
		dismissAlert: () => withActionLock(() => answerDialog(false)),
		withActionLock,
		pointerEvent: async (phase: PointerPhase, xNorm: number, yNorm: number) => {
			const point = await toPage(xNorm, yNorm);
			if (phase === "begin") {
				pointerDown = true;
				await mouse("mouseMoved", point);
				await mouse("mousePressed", point);
			} else if (phase === "move") {
				await mouse("mouseMoved", point, true);
			} else {
				pointerDown = false;
				await mouse("mouseReleased", point);
			}
		},
		isPointerActive: () => pointerDown,
	};
}
