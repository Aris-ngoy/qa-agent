/**
 * A small typed client for the Chrome DevTools Protocol over Bun's WebSocket: send a
 * command, subscribe to an event, close. It speaks only the commands the web Direct lane
 * uses, with no Puppeteer or Playwright in between. Commands to a page go on that page's
 * flat session (`sessionId`), on the one browser socket.
 */

export type AxValue = { type?: string; value?: unknown };

/** One node of `Accessibility.getFullAXTree`. Only the fields the lane reads. */
export type AxNode = {
	nodeId: string;
	ignored?: boolean;
	role?: AxValue;
	name?: AxValue;
	/** A field's current text. */
	value?: AxValue;
	properties?: Array<{ name: string; value?: AxValue }>;
	parentId?: string;
	childIds?: string[];
	backendDOMNodeId?: number;
};

/**
 * One frame's document in `DOMSnapshot.captureSnapshot`: its nodes as parallel arrays,
 * and a layout box (x, y, width, height in document CSS pixels) for each node shown.
 * String fields index the snapshot's shared `strings` table.
 */
export type DocumentSnapshot = {
	nodes: {
		backendNodeId?: number[];
		/** Each node's attributes as name, value string indexes in turn. */
		attributes?: number[][];
	};
	layout: { nodeIndex: number[]; bounds: number[][] };
	scrollOffsetX?: number;
	scrollOffsetY?: number;
};

export type TargetInfo = { targetId: string; type: string; url: string; attached?: boolean };

type MouseEvent = {
	type: "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel";
	x: number;
	y: number;
	button?: "none" | "left";
	buttons?: number;
	clickCount?: number;
	/** Wheel only: how far to scroll, in CSS pixels. A positive deltaY scrolls down. */
	deltaX?: number;
	deltaY?: number;
};

type KeyEvent = {
	type: "keyDown" | "keyUp";
	key: string;
	code: string;
	windowsVirtualKeyCode: number;
	text?: string;
};

/** The commands this client sends, with their params and results. */
export type CdpCommands = {
	"Target.getTargets": { params: Record<string, never>; result: { targetInfos: TargetInfo[] } };
	"Target.getTargetInfo": {
		params: { targetId: string };
		result: { targetInfo: TargetInfo };
	};
	"Target.createTarget": { params: { url: string }; result: { targetId: string } };
	"Target.closeTarget": { params: { targetId: string }; result: { success?: boolean } };
	"Target.attachToTarget": {
		params: { targetId: string; flatten: true };
		result: { sessionId: string };
	};
	"Page.enable": { params: Record<string, never>; result: Record<string, never> };
	"Page.bringToFront": { params: Record<string, never>; result: Record<string, never> };
	"Page.handleJavaScriptDialog": {
		params: { accept: boolean; promptText?: string };
		result: Record<string, never>;
	};
	"Page.getLayoutMetrics": {
		params: Record<string, never>;
		result: { cssLayoutViewport: { clientWidth: number; clientHeight: number } };
	};
	"Page.captureScreenshot": { params: { format: "png" }; result: { data: string } };
	"Page.navigate": { params: { url: string }; result: { frameId: string; errorText?: string } };
	"Input.dispatchMouseEvent": { params: MouseEvent; result: Record<string, never> };
	"Input.dispatchKeyEvent": { params: KeyEvent; result: Record<string, never> };
	"Input.insertText": { params: { text: string }; result: Record<string, never> };
	"Storage.clearDataForOrigin": {
		params: { origin: string; storageTypes: string };
		result: Record<string, never>;
	};
	"Accessibility.getFullAXTree": { params: Record<string, never>; result: { nodes: AxNode[] } };
	"DOMSnapshot.captureSnapshot": {
		params: { computedStyles: string[] };
		result: { documents: DocumentSnapshot[]; strings: string[] };
	};
};

export type CdpMethod = keyof CdpCommands;

export type CdpClient = {
	send: <M extends CdpMethod>(
		method: M,
		params: CdpCommands[M]["params"],
		sessionId?: string,
	) => Promise<CdpCommands[M]["result"]>;
	/** Listen for an event; returns the unsubscribe. */
	on: (method: string, listener: (params: unknown, sessionId?: string) => void) => () => void;
	/** Settles once the socket has closed, for any reason. */
	closed: Promise<void>;
	/** Close the socket. Safe to call twice. */
	close: () => Promise<void>;
};

/** The socket to the browser is gone: every command after it fails with this. */
export class CdpClosedError extends Error {
	constructor(message = "The browser's DevTools connection closed") {
		super(message);
		this.name = "CdpClosedError";
	}
}

/** The browser answered a command with an error. */
export class CdpCommandError extends Error {
	constructor(
		readonly method: string,
		readonly code: number | undefined,
		message: string,
	) {
		super(`${method}: ${message}`);
		this.name = "CdpCommandError";
	}
}

/** A command the browser has not answered in this long fails; the socket stays open. */
const COMMAND_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 5_000;

type Pending = {
	method: string;
	resolve: (result: unknown) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
};

type Incoming = {
	id?: number;
	result?: unknown;
	error?: { code?: number; message?: string };
	method?: string;
	params?: unknown;
	sessionId?: string;
};

/** Open a CDP socket to `url` (a browser's `webSocketDebuggerUrl`). */
export async function connectCdp(
	url: string,
	options: { commandTimeoutMs?: number; connectTimeoutMs?: number } = {},
): Promise<CdpClient> {
	const connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
	const socket = new WebSocket(url);
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			socket.close();
			reject(new Error(`No DevTools socket at ${url} within ${connectTimeoutMs} ms`));
		}, connectTimeoutMs);
		socket.addEventListener("open", () => {
			clearTimeout(timer);
			resolve();
		});
		socket.addEventListener("error", () => {
			clearTimeout(timer);
			reject(new Error(`Could not open the DevTools socket at ${url}`));
		});
	});

	const commandTimeoutMs = options.commandTimeoutMs ?? COMMAND_TIMEOUT_MS;
	const pending = new Map<number, Pending>();
	const listeners = new Map<string, Set<(params: unknown, sessionId?: string) => void>>();
	let nextId = 1;
	let isClosed = false;
	let markClosed: () => void = () => undefined;
	const closed = new Promise<void>((resolve) => {
		markClosed = resolve;
	});

	const onClosed = () => {
		if (isClosed) return;
		isClosed = true;
		for (const entry of pending.values()) {
			clearTimeout(entry.timer);
			entry.reject(new CdpClosedError());
		}
		pending.clear();
		markClosed();
	};
	socket.addEventListener("close", onClosed);
	socket.addEventListener("error", onClosed);

	socket.addEventListener("message", (event) => {
		let message: Incoming;
		try {
			message = JSON.parse(String(event.data)) as Incoming;
		} catch {
			return;
		}
		if (message.id !== undefined) {
			const entry = pending.get(message.id);
			if (!entry) return;
			pending.delete(message.id);
			clearTimeout(entry.timer);
			if (message.error) {
				entry.reject(
					new CdpCommandError(entry.method, message.error.code, message.error.message ?? "failed"),
				);
			} else {
				entry.resolve(message.result ?? {});
			}
			return;
		}
		if (message.method) {
			for (const listener of listeners.get(message.method) ?? []) {
				listener(message.params, message.sessionId);
			}
		}
	});

	return {
		send: (method, params, sessionId) => {
			if (isClosed) return Promise.reject(new CdpClosedError());
			const id = nextId++;
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					pending.delete(id);
					reject(new Error(`${method}: the browser did not answer within ${commandTimeoutMs} ms`));
				}, commandTimeoutMs);
				pending.set(id, {
					method,
					resolve: resolve as (result: unknown) => void,
					reject,
					timer,
				});
				socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
			});
		},
		on: (method, listener) => {
			const set = listeners.get(method) ?? new Set();
			set.add(listener);
			listeners.set(method, set);
			return () => {
				set.delete(listener);
			};
		},
		closed,
		close: async () => {
			if (isClosed) return;
			socket.close();
			await closed;
		},
	};
}
