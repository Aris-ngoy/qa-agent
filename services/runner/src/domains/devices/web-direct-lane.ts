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
	type AxNode,
	type CdpClient,
	CdpClosedError,
	type CdpCommands,
	type CdpMethod,
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
import { SCREENSHOT_DIR } from "./screenshot-retention";

export type WebDirectDeps = {
	/** The CDP WebSocket URL of the browser on `port`. */
	browserSocketUrl: (port: number) => Promise<string>;
	/** Open a CDP client on that URL. */
	connect: (url: string) => Promise<CdpClient>;
};

/** Typed text is cut at a newline, which presses Enter. */
const NEWLINE = /(\r?\n)/;

/** Roles that only hold the page together; the Screen never names them. */
const STRUCTURAL_ROLES = new Set(["RootWebArea", "InlineTextBox", "LineBreak", "none"]);

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

/** A node's border box as x, y, width, height. */
function boxOf(border: number[]): { x: number; y: number; width: number; height: number } {
	const xs = [border[0], border[2], border[4], border[6]].map(Number);
	const ys = [border[1], border[3], border[5], border[7]].map(Number);
	const x = Math.min(...xs);
	const y = Math.min(...ys);
	return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function textOf(value: AxNode["name"]): string {
	return typeof value?.value === "string" ? value.value : "";
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

	const mouse = (
		type: "mousePressed" | "mouseReleased" | "mouseMoved",
		point: { x: number; y: number },
	) =>
		call("Input.dispatchMouseEvent", {
			type,
			...point,
			button: type === "mouseMoved" ? "none" : "left",
			buttons: type === "mouseReleased" ? 0 : type === "mousePressed" ? 1 : 0,
			...(type === "mouseMoved" ? {} : { clickCount: 1 }),
		});

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
	 * The page's named accessibility nodes with their boxes, as the JSON the Screen reads,
	 * in the viewport's CSS pixels. A node with no layout box is left out.
	 */
	const pageSource = async () => {
		const { nodes } = await call("Accessibility.getFullAXTree", {});
		const elements = [];
		for (const node of nodes) {
			const role = textOf(node.role);
			const label = textOf(node.name);
			if (node.ignored || !label || STRUCTURAL_ROLES.has(role)) continue;
			if (node.backendDOMNodeId === undefined) continue;
			const box = await call("DOM.getBoxModel", { backendNodeId: node.backendDOMNodeId }).catch(
				(error: unknown) => {
					if (error instanceof DeadSessionError) throw error;
					return null;
				},
			);
			if (!box) continue;
			const disabled = node.properties?.some(
				(property) => property.name === "disabled" && property.value?.value === true,
			);
			elements.push({ type: role, label, frame: boxOf(box.model.border), enabled: !disabled });
		}
		return JSON.stringify({ elements });
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
