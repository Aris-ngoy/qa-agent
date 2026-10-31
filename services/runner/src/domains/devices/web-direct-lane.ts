/**
 * The web Direct lane: CDP straight to a Chromium-family browser, with no driver in
 * between (ADR-0007). An installed browser (`web-chrome`) is launched as a Yoqa-owned
 * instance on its App's Kept profile, and disconnecting kills it and keeps the profile, so
 * logins survive. A connect may ask for a clean profile instead, deleted on disconnect. A
 * browser the user started with `--remote-debugging-port` is attached by its port
 * (`chromium-cdp-9222`), and disconnecting closes only the DevTools socket. Either way the
 * session drives the browser's first page, or a blank one it opens.
 *
 * The user's Everyday browser (`web-chrome-everyday`, ADR-0009) is attached by consent: one
 * socket from its port file, which waits for the user's Allow. There the session opens a
 * page in a new window of its own and never touches the user's tabs, and disconnecting
 * closes that window and the socket, never the browser.
 *
 * The session drives one page at a time. A page that page opens (`window.open`, a
 * `target=_blank` link, an OAuth popup) takes over, and when it closes the session goes back
 * to the page that opened it. Pages it did not open are left alone.
 *
 * Coordinates cross the Device Session as 0–1000 of the page viewport, never the browser
 * window, and reach the page in its CSS pixels. The screenshot is that viewport too (in
 * device pixels), so both coordinate spaces convert the same way. The viewport is the
 * session's Viewport preset, emulated on every page it drives, whatever the window's size:
 * `desktop` (1280×800) unless the connect named another. Under the `mobile` preset the page
 * is a phone's, with a mobile user agent and touch: a tap, swipe or drag is a finger.
 *
 * Shared cases keep their meaning in the browser. On desktop a swipe scrolls the content
 * under its start point with the wheel, as a finger would, and a drag is a mouse press,
 * move and release.
 * An alert is the page's JavaScript dialog. While one is open it leads the Screen as a
 * `modal` with its buttons, where a tap answers it; Chromium paints nothing and answers no
 * input, screenshot or tree read for the page until then, so the session asks it none of
 * these. A capture returns the last screenshot it took, and an Action that opens a dialog
 * ends there. On web, an app id is the App's Web URL:
 * terminate-app closes the App's page, activate-app opens it again, and restart-app does
 * both with the origin's storage cleared in between, except in the Everyday browser, where
 * nothing is ever cleared. A page has no background, so background-app fails.
 *
 * The browser closing its socket, or the page going away with no opener to go back to, is
 * a Dead Session; a Yoqa-owned instance is then quit too. The lane does not record.
 *
 * The Frame Feed is a Stream: while someone watches it, the page screencasts JPEG frames at
 * the preset's size, served as MJPEG. A screenshot under device emulation re-emulates and
 * resizes the browser's view, which the user sees as flicker, so the Stream never takes
 * one. Single shots (Run step screenshots, `/screenshot/image`) still do.
 */

import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	DEFAULT_VIEWPORT_PRESET,
	KEY_NAMES,
	type KeyModifier,
	type KeyName,
	VIEWPORT_PRESETS,
	type ViewportPreset,
	WEB_BROWSERS,
	installedBrowserId,
} from "@yoqa/runner-client";
import {
	type AxNode,
	type CdpClient,
	CdpClosedError,
	CdpCommandError,
	type CdpCommands,
	type CdpMethod,
	CdpSessionGoneError,
	type ConnectCdpOptions,
	type DocumentSnapshot,
	type KeyEvent,
	type ScreencastFrame,
	type ScreencastFrameMetadata,
	type TargetInfo,
	connectCdp,
} from "./cdp-client";
import { attachPortOf, browserSocketUrl } from "./chromium-attach";
import {
	type BrowserProcess,
	type ChromiumInstance,
	type InstalledBrowser,
	type ProfileRequest,
	findInstalledBrowsers,
	installedBrowserIdOf,
	launchChromium,
} from "./chromium-browsers";
import {
	type EverydayBrowser,
	everydayBrowserIdOf,
	findEverydayBrowsers,
	openEverydaySocket,
	readEverydayProfileName,
} from "./chromium-everyday";
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
import { startMjpegServer } from "./mjpeg-server";
import type { WebAxSource, WebAxSourceNode, WebDialogSource } from "./screen";
import { debounceScreenChanges } from "./screen-changes";
import { SCREENSHOT_DIR } from "./screenshot-retention";

export type WebDirectDeps = {
	/** The CDP WebSocket URL of the browser on `port`. */
	browserSocketUrl: (port: number) => Promise<string>;
	/** Open a CDP client on that URL. */
	connect: (url: string, options?: ConnectCdpOptions) => Promise<CdpClient>;
	/** The browsers installed on this machine. */
	installedBrowsers: () => Promise<InstalledBrowser[]>;
	/** Launch a Yoqa-owned instance of one, on the profile the connect asked for. */
	launch: (browser: InstalledBrowser, profile: ProfileRequest) => Promise<ChromiumInstance>;
	/** The installed browsers' Everyday browsers. */
	everydayBrowsers: () => Promise<EverydayBrowser[]>;
	/** Read a file in an Everyday browser's user-data folder. */
	readText: (path: string) => Promise<string>;
	/** How long an Everyday browser connect waits for Allow; 60 s by default. */
	allowTimeoutMs?: number;
};

/** Typed text is cut at a newline, which presses Enter. */
const NEWLINE = /(\r?\n)/;

/** A drag or touch swipe moves the pointer in this many steps, so the page sees it travel. */
const DRAG_STEPS = 10;
const DEFAULT_DRAG_MS = 800;
/** A touch swipe's length when the Action names none, as on Android. */
const DEFAULT_SWIPE_MS = 400;
/** The longest a navigation waits for its page to load before the session carries on. */
const NAVIGATE_LOAD_MS = 10_000;

/** Screencast JPEG quality: sharp enough to read text, small enough for 30 frames a second. */
const SCREENCAST_QUALITY = 70;
/** Every second frame the page paints: about 30 a second on a 60 Hz display. */
const SCREENCAST_EVERY_NTH_FRAME = 2;
/** How often a frame that is not the preset's makes the lane set the emulation again. */
const REEMULATE_MS = 500;
/**
 * A page loading or a scroll's frames is one screen-changed signal, once the page has been
 * quiet this long; a page that keeps painting (an animation, a caret) signals once a second.
 */
const SCREEN_CHANGE_TIMING = { quietMs: 200, maxWaitMs: 1000 };

/** The mobile preset's user agent: Safari on the iPhone whose screen it is. */
const MOBILE_USER_AGENT =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

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

/** `Page.javascriptDialogOpening`, as the browser sent it. */
type JavaScriptDialog = { type: string; message: string; defaultPrompt?: string };

/** What a JavaScript dialog's buttons do: every type but `alert` can also be cancelled. */
function dialogButtons(type: string): Array<{ label: string; accept: boolean }> {
	const ok = { label: "OK", accept: true };
	return type === "alert" ? [ok] : [{ label: "Cancel", accept: false }, ok];
}

/**
 * Where a dialog reads on the Screen. The browser draws it outside the page, so the box is
 * the lane's: a panel across the middle of the viewport, its buttons along the bottom,
 * OK last as Chrome lays them out.
 */
function dialogOnScreen(event: JavaScriptDialog, preset: ViewportPreset): WebDialogSource {
	const bounds = {
		x: preset.width * 0.1,
		y: preset.height * 0.3,
		width: preset.width * 0.8,
		height: preset.height * 0.3,
	};
	const gap = bounds.height * 0.1;
	const size = { width: bounds.width * 0.25, height: bounds.height * 0.2 };
	const buttons = dialogButtons(event.type);
	return {
		event,
		bounds,
		buttons: buttons.map((button, index) => ({
			...button,
			bounds: {
				x: bounds.x + bounds.width - (buttons.length - index) * (size.width + gap),
				y: bounds.y + bounds.height - size.height - gap,
				...size,
			},
		})),
	};
}

function dialogOpenError({ message }: JavaScriptDialog): Error {
	return new Error(`A JavaScript dialog is open: ${message}. Accept or dismiss it first.`);
}

type DrivenPage = { targetId: string; sessionId: string };

/** An out-of-process iframe's own session; its target id is its frame id. */
type OutOfProcessFrame = { sessionId: string; frameId: string };

/** A point on the page, in its CSS pixels. */
type PagePoint = { x: number; y: number };

/** One pointer that presses, moves while pressed, and releases. */
type Pointer = {
	press: (point: PagePoint) => Promise<unknown>;
	move: (point: PagePoint) => Promise<unknown>;
	release: (point: PagePoint) => Promise<unknown>;
};

export function webDirectDeps(
	overrides: {
		installedBrowsers?: () => Promise<InstalledBrowser[]>;
		spawn?: (command: string[]) => BrowserProcess;
		/** The home folder Kept profiles live under. */
		home?: string;
		/** Whether a pid holding a Kept profile's lock still runs. */
		isProcessAlive?: (pid: number) => boolean;
		everydayBrowsers?: () => Promise<EverydayBrowser[]>;
		allowTimeoutMs?: number;
	} = {},
): WebDirectDeps {
	return {
		browserSocketUrl: (port) => browserSocketUrl(port),
		connect: (url, options) => connectCdp(url, options),
		installedBrowsers: overrides.installedBrowsers ?? (() => findInstalledBrowsers()),
		launch: (browser, profile) =>
			launchChromium(
				browser,
				{ spawn: overrides.spawn, home: overrides.home, isProcessAlive: overrides.isProcessAlive },
				profile,
			),
		everydayBrowsers: overrides.everydayBrowsers ?? (() => findEverydayBrowsers()),
		readText: (path) => readFile(path, "utf8"),
		allowTimeoutMs: overrides.allowTimeoutMs,
	};
}

/** A browser the session is connected to, and what it knows of it before asking. */
type OpenedBrowser = {
	client: CdpClient;
	/** A browser Yoqa launched, quit with the session. */
	owned: ChromiumInstance | null;
	/** The name the browser is known by, when not from its own report. */
	name: string | null;
	/** The user's Everyday browser, where the session keeps to a window of its own. */
	everyday: { name: string; profileName: string | null } | null;
};

/** Firefox and Safari device ids, refused with the reason (ADR-0010) rather than as unknown. */
const UNSUPPORTED_BROWSER_ID = /^web-(firefox|safari)(-everyday)?$/;

const INSTALLED_BROWSER_IDS = WEB_BROWSERS.map(({ browser }) => installedBrowserId(browser)).join(
	", ",
);

/** The error for a web device id that names nothing: the kinds of web device id there are. */
const WEB_DEVICE_ID_HINT = `A web device is an installed browser (${INSTALLED_BROWSER_IDS}), its Everyday browser (web-chrome-everyday, web-dia-everyday, …), or a Chromium started with --remote-debugging-port, named chromium-cdp-<port>`;

/**
 * Connect to the browser a web device id names: a Yoqa-owned instance of an installed
 * browser, which this launches, the user's Everyday browser, by consent, or a user-started
 * one attached by its port.
 */
async function openBrowser(
	{ deviceId, appId, profile, signal }: SessionOptions,
	deps: WebDirectDeps,
): Promise<OpenedBrowser> {
	const port = attachPortOf(deviceId);
	if (port !== null) {
		const client = await deps.connect(await deps.browserSocketUrl(port));
		return { client, owned: null, name: null, everyday: null };
	}
	const everydayId = everydayBrowserIdOf(deviceId);
	if (everydayId !== null) {
		const browser = (await deps.everydayBrowsers()).find((found) => found.id === everydayId);
		if (!browser) {
			throw new Error(
				`${everydayId} is not installed. Run yoqa devices web to list the browsers here`,
			);
		}
		const client = await openEverydaySocket(browser, {
			readText: deps.readText,
			connect: deps.connect,
			allowTimeoutMs: deps.allowTimeoutMs,
			signal,
		});
		const profileName = await readEverydayProfileName(browser.userDataDir, deps.readText);
		return { client, owned: null, name: null, everyday: { name: browser.name, profileName } };
	}
	const browserId = installedBrowserIdOf(deviceId);
	if (browserId === null) {
		throw new Error(
			UNSUPPORTED_BROWSER_ID.test(deviceId)
				? `Firefox and Safari are not supported yet: the web lane drives Chromium browsers over CDP (ADR-0010). ${WEB_DEVICE_ID_HINT}`
				: WEB_DEVICE_ID_HINT,
		);
	}
	const browser = (await deps.installedBrowsers()).find((installed) => installed.id === browserId);
	if (!browser) {
		throw new Error(
			`${browserId} is not installed. Run yoqa devices web to list the browsers here`,
		);
	}
	const owned = await deps.launch(browser, { appId, profile });
	const name = browser.version ? `${browser.name} ${browser.version}` : browser.name;
	const client = await deps.connect(owned.socketUrl).catch(async (error: unknown) => {
		await owned.stop();
		throw error;
	});
	return { client, owned, name, everyday: null };
}

/**
 * The page the session drives: the browser's first page, or a blank one it opens. In the
 * Everyday browser it is always a blank page in a new window of its own.
 */
async function pickPage(client: CdpClient, everyday: boolean): Promise<string> {
	if (everyday) {
		return (await client.send("Target.createTarget", { url: "about:blank", newWindow: true }))
			.targetId;
	}
	const { targetInfos } = await client.send("Target.getTargets", {});
	const page = targetInfos.find(
		(target) => target.type === "page" && !target.url.startsWith("devtools://"),
	);
	if (page) return page.targetId;
	return (await client.send("Target.createTarget", { url: "about:blank" })).targetId;
}

/** How many pages may close under the session while it attaches, before the connect fails. */
const ATTACH_ATTEMPTS = 3;

/**
 * Pick a page and attach to it. A page that closes while it is being attached is picked
 * again: Dia restoring its last session after an unclean exit closes the page it opened at
 * launch, or the one the session opened, and puts the restored tabs in its place.
 */
async function pickAndAttachPage(
	client: CdpClient,
	everyday: boolean,
	preset: ViewportPreset,
	onPicked: (targetId: string) => void,
): Promise<DrivenPage> {
	for (let attempt = 1; ; attempt++) {
		const targetId = await pickPage(client, everyday);
		onPicked(targetId);
		try {
			return await attachPage(client, targetId, preset);
		} catch (error) {
			if (!(error instanceof CdpSessionGoneError) || attempt >= ATTACH_ATTEMPTS) throw error;
		}
	}
}

type ElementLayout = Pick<WebAxSourceNode, "bounds" | "testId" | "domId">;

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
 * A screencast frame shows the preset's viewport, and nothing else, so the Stream's 0–1000
 * is the page's. Chromium paints the whole browser window's view until the emulation is
 * set again after the screencast starts; such a frame is not one.
 */
export function showsPreset(metadata: ScreencastFrameMetadata, preset: ViewportPreset): boolean {
	return (
		Math.round(metadata.deviceWidth) === preset.width &&
		Math.round(metadata.deviceHeight) === preset.height &&
		Math.round(metadata.offsetTop) === 0
	);
}

/** The emulation that makes a page the preset's size and kind. */
function deviceMetrics({ width, height, deviceScaleFactor, mobile }: ViewportPreset) {
	return { width, height, deviceScaleFactor, mobile };
}

/**
 * Each out-of-process iframe in a session's page attaches as a session of its own, so the
 * Screen can read inside it. It runs on at once; nothing waits for a debugger.
 */
const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: false, flatten: true } as const;

/**
 * Attach to a page so the session can drive it, at the session's Viewport preset. Enabling
 * the Page domain is what makes a JavaScript dialog wait for the session's answer, and a
 * tab in the background never paints, so its screenshot would never come back.
 */
async function attachPage(
	client: CdpClient,
	targetId: string,
	preset: ViewportPreset,
): Promise<DrivenPage> {
	const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
	await client.send("Page.enable", {}, sessionId);
	await client.send("Page.setLifecycleEventsEnabled", { enabled: true }, sessionId);
	await client.send("Target.setAutoAttach", AUTO_ATTACH, sessionId);
	await client.send("Emulation.setDeviceMetricsOverride", deviceMetrics(preset), sessionId);
	if (preset.mobile) {
		await client.send(
			"Emulation.setTouchEmulationEnabled",
			{ enabled: true, maxTouchPoints: 5 },
			sessionId,
		);
		await client.send(
			"Emulation.setUserAgentOverride",
			{ userAgent: MOBILE_USER_AGENT },
			sessionId,
		);
	}
	await client.send("Page.bringToFront", {}, sessionId);
	return { targetId, sessionId };
}

export async function createWebDirectSession(
	options: SessionOptions,
	deps: WebDirectDeps = webDirectDeps(),
): Promise<DeviceSession> {
	if (options.platform !== "web") {
		throw new Error("The web Direct lane drives web devices only");
	}

	const preset = VIEWPORT_PRESETS[options.viewport ?? DEFAULT_VIEWPORT_PRESET];
	const { client, owned, name, everyday } = await openBrowser(options, deps);
	/**
	 * The out-of-process iframes attached under each session (a page's, or another iframe's),
	 * listening from before the first page is attached, which announces its iframes at once.
	 */
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
	/** The page the session drives. terminate-app swaps it for a blank one. */
	let page: DrivenPage;
	/**
	 * An attached browser names itself (`Chrome/140.0.0.0`); a launched one is known. An
	 * Everyday browser is known by name, and reports its version.
	 */
	let browser: string;
	/** The window it opened in an Everyday browser, closed again when setup fails. */
	let ownTarget: string | null = null;
	try {
		page = await pickAndAttachPage(client, everyday !== null, preset, (targetId) => {
			if (everyday) ownTarget = targetId;
		});
		await client.send("Target.setDiscoverTargets", { discover: true });
		const product = name ?? (await client.send("Browser.getVersion", {})).product;
		browser = everyday
			? `${everyday.name} ${product.split("/")[1] ?? ""}`.trim()
			: product.replace("/", " ");
	} catch (error) {
		if (ownTarget) {
			await client.send("Target.closeTarget", { targetId: ownTarget }).catch(() => undefined);
		}
		await client.close().catch(() => undefined);
		await owned?.stop();
		throw error;
	}

	let quitting = false;
	let sessionEnded: DeadSessionError | null = null;
	const screenChanges = debounceScreenChanges(
		() => options.onScreenChanged?.(),
		SCREEN_CHANGE_TIMING,
	);
	const dead = (reason: string) => {
		if (!sessionEnded) {
			sessionEnded = new DeadSessionError(`Device session ended: ${reason}`);
			screenChanges.stop();
			if (!quitting) {
				// Nobody quits a dead session, so a browser Yoqa launched is quit here.
				feed.stop();
				void owned?.stop();
				options.onSessionDead?.();
			}
		}
		return sessionEnded;
	};
	void client.closed.then(() => {
		if (!quitting) dead("the browser closed its DevTools connection");
	});
	void owned?.exited.then(() => {
		if (!quitting) dead("the browser quit");
	});

	let openDialog: JavaScriptDialog | null = null;

	/** The pages the session followed a popup away from, the newest opener last. */
	const openers: DrivenPage[] = [];
	/** A move to another page, which every command to the page waits for. */
	let switching: Promise<unknown> = Promise.resolve();
	const switchPage = (fn: () => Promise<unknown>) => {
		switching = switching.then(fn).catch(() => undefined);
	};
	client.on("Target.targetCreated", (params) => {
		const { targetInfo } = params as { targetInfo: TargetInfo };
		if (targetInfo.type !== "page" || !targetInfo.openerId) return;
		switchPage(async () => {
			if (targetInfo.openerId !== page.targetId || sessionEnded) return;
			const popup = await attachPage(client, targetInfo.targetId, preset);
			openers.push(page);
			page = popup;
			openDialog = null;
			followPage();
		});
	});
	client.on("Target.detachedFromTarget", (params) => {
		const { sessionId } = (params ?? {}) as { sessionId?: string };
		const closedOpener = openers.findIndex((opener) => opener.sessionId === sessionId);
		if (closedOpener >= 0) openers.splice(closedOpener, 1);
		if (sessionId !== page.sessionId || quitting) return;
		const opener = openers.pop();
		if (!opener) {
			dead("the page was closed");
			return;
		}
		// A tab in the background never paints, so the opener comes to the front again.
		page = opener;
		openDialog = null;
		switchPage(() => client.send("Page.bringToFront", {}, opener.sessionId));
		followPage();
	});
	/** The page whose screencast feeds the Stream, by its session; null while nobody watches. */
	let screencastOn: string | null = null;
	let reemulatedAt = 0;
	/**
	 * Screencast the page the session drives. Its emulation is set again first thing, so
	 * Chromium paints the preset's viewport, not the window's view.
	 */
	const startScreencast = async () => {
		const sessionId = page.sessionId;
		screencastOn = sessionId;
		await client.send(
			"Page.startScreencast",
			{
				format: "jpeg",
				quality: SCREENCAST_QUALITY,
				maxWidth: preset.width,
				maxHeight: preset.height,
				everyNthFrame: SCREENCAST_EVERY_NTH_FRAME,
			},
			sessionId,
		);
		reemulatedAt = performance.now();
		await client.send("Emulation.setDeviceMetricsOverride", deviceMetrics(preset), sessionId);
	};
	const stopScreencast = async () => {
		const sessionId = screencastOn;
		screencastOn = null;
		if (sessionId) await client.send("Page.stopScreencast", {}, sessionId);
	};
	/** The Stream shows whichever page the session drives: a popup, or the opener again. */
	const followPage = () => {
		if (screencastOn === null || screencastOn === page.sessionId || sessionEnded) return;
		void stopScreencast()
			.catch(() => undefined)
			.then(startScreencast)
			.catch(() => undefined);
	};
	const feed = startMjpegServer({
		onWatched: () => {
			if (!sessionEnded && !quitting) void startScreencast().catch(() => undefined);
		},
		onUnwatched: () => {
			void stopScreencast().catch(() => undefined);
		},
	});
	client.on("Page.screencastFrame", (params, eventSession) => {
		const frame = params as ScreencastFrame;
		// Unacked, the browser stops sending frames.
		void client
			.send("Page.screencastFrameAck", { sessionId: frame.sessionId }, eventSession)
			.catch(() => undefined);
		if (eventSession !== screencastOn || eventSession !== page.sessionId) return;
		if (showsPreset(frame.metadata, preset)) {
			feed.push(Uint8Array.from(Buffer.from(frame.data, "base64")));
			// Chromium paints a frame only when the view changed: a scroll, an animation, new content.
			screenChanges.changed();
			return;
		}
		// The window's view, not the preset's: set the emulation again, as at the start.
		if (performance.now() - reemulatedAt < REEMULATE_MS) return;
		reemulatedAt = performance.now();
		void client
			.send("Emulation.setDeviceMetricsOverride", deviceMetrics(preset), eventSession)
			.catch(() => undefined);
	});
	// The page's document, or one of its frames, navigated (in-document too) or moved on in loading.
	for (const event of [
		"Page.frameNavigated",
		"Page.navigatedWithinDocument",
		"Page.lifecycleEvent",
	]) {
		client.on(event, (_params, eventSession) => {
			if (eventSession === page.sessionId) screenChanges.changed();
		});
	}
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

	/** One command to the page, once any move to another page is done. */
	const call = <M extends CdpMethod>(method: M, params: CdpCommands[M]["params"]) =>
		guarded(async () => {
			await switching;
			return client.send(method, params, page.sessionId);
		});

	/**
	 * `read`, unless the page opens a JavaScript dialog first: Chromium answers nothing the
	 * page has to render until the dialog is answered. Null then, at once.
	 */
	const beforeDialog = async <T>(read: () => Promise<T>): Promise<T | null> => {
		if (openDialog) return null;
		let stopListening = () => {};
		const opened = new Promise<null>((resolve) => {
			stopListening = client.on("Page.javascriptDialogOpening", (_params, eventSession) => {
				if (eventSession === page.sessionId) resolve(null);
			});
		});
		try {
			return await Promise.race([read(), opened]);
		} finally {
			stopListening();
		}
	};

	/**
	 * Input to the page. Once the input before it opened a dialog, the page takes no more, so
	 * the rest of the Action is dropped: the Action ends at the dialog.
	 */
	const input = <M extends CdpMethod>(method: M, params: CdpCommands[M]["params"]) =>
		beforeDialog(() => call(method, params));

	/** One command to the browser itself (targets, storage). */
	const callBrowser = <M extends CdpMethod>(method: M, params: CdpCommands[M]["params"]) =>
		guarded(() => client.send(method, params));

	let chain: Promise<unknown> = Promise.resolve();
	/** An Action's work, one at a time; whatever it did, the Screen may have changed. */
	const withActionLock = <T>(fn: () => Promise<T>): Promise<T> => {
		const after = () => switching.then(fn);
		const run = chain.then(after, after);
		chain = run.catch(() => undefined).finally(screenChanges.changed);
		return run;
	};

	/** An Action that would reach the page: it fails while a dialog holds the page. */
	const withPageActionLock = (fn: () => Promise<void>): Promise<void> =>
		withActionLock(async () => {
			if (openDialog) throw dialogOpenError(openDialog);
			await fn();
		});

	/** The page viewport in CSS pixels: the preset's, on every page, however the window is sized. */
	const getWindowSize = () =>
		guarded(async () => {
			await switching;
			return { width: preset.width, height: preset.height };
		});

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
		point: PagePoint,
		held = false,
	) => {
		if (type === "mouseMoved") {
			return input("Input.dispatchMouseEvent", {
				type,
				...point,
				button: held ? "left" : "none",
				buttons: held ? 1 : 0,
			});
		}
		return input("Input.dispatchMouseEvent", {
			type,
			...point,
			button: "left",
			buttons: type === "mousePressed" ? 1 : 0,
			clickCount: 1,
		});
	};

	/** One finger: down, moved while down, or lifted (no fingers are left on the page). */
	const touch = (type: "touchStart" | "touchMove" | "touchEnd", point: PagePoint) =>
		input("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [point] });

	/** The left mouse button on desktop, a finger under a mobile preset. */
	const pointer: Pointer = preset.mobile
		? {
				press: (point) => touch("touchStart", point),
				move: (point) => touch("touchMove", point),
				release: (point) => touch("touchEnd", point),
			}
		: {
				press: async (point) => {
					await mouse("mouseMoved", point);
					await mouse("mousePressed", point);
				},
				move: (point) => mouse("mouseMoved", point, true),
				release: (point) => mouse("mouseReleased", point),
			};

	const click = async (xNorm: number, yNorm: number, holdMs = 0) => {
		const point = await toPage(xNorm, yNorm);
		await pointer.press(point);
		if (holdMs > 0) await Bun.sleep(holdMs);
		await pointer.release(point);
	};

	/** Press at `from`, move to `to` in DRAG_STEPS over `durationMs`, release there. */
	const stroke = async (from: PagePoint, to: PagePoint, durationMs: number) => {
		await pointer.press(from);
		for (let step = 1; step <= DRAG_STEPS; step++) {
			await Bun.sleep(durationMs / DRAG_STEPS);
			const t = step / DRAG_STEPS;
			await pointer.move({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
		}
		await pointer.release(to);
	};

	/**
	 * A swipe carries the content with the finger. Under a mobile preset it is that finger;
	 * on desktop it is the wheel, scrolling the other way.
	 */
	const scroll = async (
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		durationMs = DEFAULT_SWIPE_MS,
	) => {
		const from = await toPage(x1, y1);
		const to = await toPage(x2, y2);
		if (preset.mobile) {
			await stroke(from, to, durationMs);
			return;
		}
		await input("Input.dispatchMouseEvent", {
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
		await stroke(await toPage(x1, y1), await toPage(x2, y2), durationMs);
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

	/**
	 * A tap while a dialog is open is on the dialog: on one of its buttons it answers the
	 * dialog as that button does, and anywhere else it fails, as the page under it takes none.
	 */
	const tapDialog = async (dialog: JavaScriptDialog, xNorm: number, yNorm: number) => {
		const point = await toPage(xNorm, yNorm);
		const button = dialogOnScreen(dialog, preset).buttons.find(
			({ bounds }) =>
				point.x >= bounds.x &&
				point.x <= bounds.x + bounds.width &&
				point.y >= bounds.y &&
				point.y <= bounds.y + bounds.height,
		);
		if (!button) throw dialogOpenError(dialog);
		await answerDialog(button.accept);
	};

	/**
	 * `Page.navigate` answers as the navigation starts. Until the new document has loaded,
	 * Chrome may still be swapping it in, and a screenshot fails ("Not attached to an
	 * active page"), so wait for the load event. A page that never finishes loading is
	 * left to carry on after `NAVIGATE_LOAD_MS`.
	 */
	const navigate = async (url: string) => {
		let loaded = () => {};
		const load = new Promise<void>((resolve) => {
			loaded = resolve;
		});
		const stopListening = client.on("Page.loadEventFired", (_params, eventSession) => {
			if (eventSession === page.sessionId) loaded();
		});
		try {
			// The page's `beforeunload` dialog holds the navigation until it is answered.
			await beforeDialog(async () => {
				const { errorText, loaderId } = await call("Page.navigate", { url });
				if (errorText) throw new Error(`Could not open ${url}: ${errorText}`);
				if (loaderId) await Promise.race([load, client.closed, Bun.sleep(NAVIGATE_LOAD_MS)]);
			});
		} finally {
			stopListening();
		}
	};

	/**
	 * Closing the browser's last tab can quit it, so a blank page takes over first: in the
	 * Everyday browser, in a window of its own again.
	 */
	const closeAppPage = async () => {
		const appPage = page;
		const { targetId } = await callBrowser("Target.createTarget", {
			url: "about:blank",
			...(everyday ? { newWindow: true } : {}),
		});
		page = await guarded(() => attachPage(client, targetId, preset));
		openDialog = null;
		followPage();
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
			await input("Input.dispatchKeyEvent", { type: "rawKeyDown", ...key, modifiers: held });
		}
		const { text, ...key } = CDP_KEYS[name];
		const shortcut = modifiers.some((modifier) => modifier !== "Shift");
		await input(
			"Input.dispatchKeyEvent",
			text && !shortcut
				? { type: "keyDown", ...key, text, modifiers: held }
				: { type: "rawKeyDown", ...key, modifiers: held },
		);
		await input("Input.dispatchKeyEvent", { type: "keyUp", ...key, modifiers: held });
		for (const modifier of [...modifiers].reverse()) {
			const { bit, ...key } = CDP_MODIFIERS[modifier];
			held &= ~bit;
			await input("Input.dispatchKeyEvent", { type: "keyUp", ...key, modifiers: held });
		}
	};

	/** Text goes into the focused element as typed; a newline presses Enter. */
	const typeText = async (text: string) => {
		for (const part of text.split(NEWLINE)) {
			if (part === "") continue;
			if (part === "\n" || part === "\r\n") await pressKey("Enter");
			else await input("Input.insertText", { text: part });
		}
	};

	/** The last screenshot of the page the session drives, which a dialog leaves on show. */
	let lastShot: { sessionId: string; base64: string } | null = null;

	/**
	 * The page's viewport. Under an open dialog the page paints nothing until it is answered,
	 * so the capture is the last screenshot of the page, frozen, or fails at once without one.
	 */
	const captureFrame = async (): Promise<CapturedFrame> => {
		const shot = await beforeDialog(() => call("Page.captureScreenshot", { format: "png" }));
		if (!shot) {
			// The dialog opened and was answered while the capture waited: the page paints again.
			if (!openDialog) return captureFrame();
			if (lastShot?.sessionId !== page.sessionId) throw dialogOpenError(openDialog);
			return { base64: lastShot.base64, mime: "image/png", frozen: true };
		}
		if (!shot.data) throw new Error("The browser returned an empty screenshot");
		lastShot = { sessionId: page.sessionId, base64: shot.data };
		return { base64: shot.data, mime: "image/png" };
	};

	const screenshot = async () => {
		await mkdir(SCREENSHOT_DIR, { recursive: true });
		const frame = await captureFrame();
		const path = join(SCREENSHOT_DIR, `shot_${Date.now()}_${crypto.randomUUID()}.png`);
		await Bun.write(path, Uint8Array.from(Buffer.from(frame.base64, "base64")));
		return { path, base64: frame.base64 };
	};

	/** One command to a session other than the page's, such as an iframe's. */
	const callOn = <M extends CdpMethod>(
		sessionId: string,
		method: M,
		params: CdpCommands[M]["params"],
	) => guarded(() => client.send(method, params, sessionId));

	/** A frame that went away while being read is left off the Screen. */
	const unlessGone = <T>(promise: Promise<T>): Promise<T | null> =>
		promise.catch((error: unknown) => {
			if (error instanceof CdpCommandError) return null;
			throw error;
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
			const tree = await unlessGone(callOn(sessionId, "Accessibility.getFullAXTree", { frameId }));
			return tree && { owner, nodes: withLayout(tree.nodes) };
		});
		const outOfProcess = (outOfProcessFrames.get(sessionId) ?? []).map(async (frame) => {
			const owner = await unlessGone(
				callOn(sessionId, "DOM.getFrameOwner", { frameId: frame.frameId }),
			);
			const ownerBox = owner ? boxes.get(owner.backendNodeId) : undefined;
			if (!owner || !ownerBox) return null;
			const [tree, snapshot] = await Promise.all([
				unlessGone(callOn(frame.sessionId, "Accessibility.getFullAXTree", {})),
				unlessGone(callOn(frame.sessionId, "DOMSnapshot.captureSnapshot", SNAPSHOT_PARAMS)),
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

	/**
	 * The page's full accessibility tree, as the JSON the Screen reads, with each iframe's
	 * under its iframe element. Each node of an element that is laid out carries its box and
	 * ids, from one DOM snapshot per process, so a large page costs a few commands, not one
	 * per node.
	 */
	const pageSource = async () => {
		const sessionId = await guarded(async () => {
			await switching;
			return page.sessionId;
		});
		const axTree = await beforeDialog(async () => {
			const [{ nodes }, snapshot, metrics] = await Promise.all([
				callOn(sessionId, "Accessibility.getFullAXTree", {}),
				callOn(sessionId, "DOMSnapshot.captureSnapshot", SNAPSHOT_PARAMS),
				callOn(sessionId, "Page.getLayoutMetrics", {}),
			]);
			const scale = devicePixelsPerCss(metrics, snapshot.documents[0]);
			return frameTree(
				sessionId,
				{ nodes, snapshot },
				{ scale, origin: { x: 0, y: 0 }, idPrefix: "" },
			);
		});
		// The page under a dialog cannot be read, nor tapped, until it is answered.
		const dialog = openDialog ? dialogOnScreen(openDialog, preset) : undefined;
		return JSON.stringify({
			axTree: axTree ?? [],
			...(dialog ? { dialog } : {}),
		} satisfies WebAxSource);
	};

	/** The Everyday browser stays open: only the pages the session opened or followed close. */
	const closeOwnPages = async () => {
		for (const own of [page, ...openers]) {
			await client.send("Target.closeTarget", { targetId: own.targetId }).catch(() => undefined);
		}
	};

	let pointerDown = false;

	return {
		lane: "direct",
		stream: { ...feed.stream, survivesTreeRead: true },
		browser,
		...(everyday ? { browserProfileName: everyday.profileName } : {}),
		viewport: preset.name,
		noRecordingReason: "Run recording is not available on web",
		quit: async () => {
			quitting = true;
			screenChanges.stop();
			feed.stop();
			await stopScreencast().catch(() => undefined);
			if (everyday) await closeOwnPages();
			await client.close();
			await owned?.stop();
		},
		captureFrame,
		screenshot,
		pageSource,
		getWindowSize,
		tap: (x, y, tapOptions) =>
			withActionLock(() =>
				openDialog ? tapDialog(openDialog, x, y) : click(x, y, tapOptions?.durationMs),
			),
		swipe: (x1, y1, x2, y2, durationMs) =>
			withPageActionLock(() => scroll(x1, y1, x2, y2, durationMs)),
		drag: (x1, y1, x2, y2, durationMs) =>
			withPageActionLock(() => drag(x1, y1, x2, y2, durationMs)),
		type: (text) => withPageActionLock(() => typeText(text)),
		keySupport: WEB_KEY_SUPPORT,
		key: async (name, modifiers = []) => {
			assertKeySupported(WEB_KEY_SUPPORT, "on the web", name, modifiers);
			await withPageActionLock(() => pressKey(name, modifiers));
		},
		activateApp: (appId) => withActionLock(() => openApp(webUrlOf(appId))),
		// Every lifecycle Action names its Web URL, and a Run opens it itself, so none is kept.
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
				// Clearing the origin in the Everyday browser would sign the user out of their real account.
				const storage = everyday ? "kept" : "cleared";
				if (storage === "cleared") {
					await callBrowser("Storage.clearDataForOrigin", {
						origin: url.origin,
						storageTypes: "all",
					});
				}
				await navigate(url.href);
				return { storage };
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
				await pointer.press(point);
			} else if (phase === "move") {
				await pointer.move(point);
			} else {
				pointerDown = false;
				await pointer.release(point);
				screenChanges.changed();
			}
		},
		isPointerActive: () => pointerDown,
	};
}
