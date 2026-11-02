import { REMOTE_DEBUGGING_SETTING_URL } from "@/../shared/everyday-browser";
import {
	type ActiveDeviceResponse,
	type ConnectDeviceRequest,
	type Device,
	type EverydayWarningRequired,
	everydayWarningRequired,
	formatDeviceState,
} from "@yoqa/runner-client";

const EVERYDAY_ID = /^web-[a-z]+-everyday$/;
const EVERYDAY_TAG = / \(everyday\)$/;

/** The user's own browser, reached by consent (`web-dia-everyday`). */
export function isEverydayDeviceId(deviceId: string): boolean {
	return EVERYDAY_ID.test(deviceId);
}

/**
 * `Dia` for the runner's `Dia (everyday)`: the browser as the user knows it, and "your
 * browser" while the device is unlisted.
 */
export function everydayBrowserName(name: string | undefined): string {
	return name?.replace(EVERYDAY_TAG, "") ?? "your browser";
}

/** An Everyday browser in the picker: ready to connect, with remote debugging off, or not running. */
export type EverydayEntry = Pick<Device, "id" | "name" | "osVersion" | "kind" | "state"> & {
	browserName: string;
	ready: boolean;
	/** False until a hands-on check has cleared the browser (Arc, Opera, Vivaldi). */
	verified: boolean;
};

/** The Everyday browsers in the runner's web device list, as the picker shows them. */
export function everydayEntries(devices: readonly Device[]): EverydayEntry[] {
	return devices
		.filter((device) => device.kind === "browser" && isEverydayDeviceId(device.id))
		.map((device) => ({
			id: device.id,
			name: device.name,
			browserName: everydayBrowserName(device.name),
			osVersion: device.osVersion,
			kind: device.kind,
			state: device.state,
			ready: device.state === "ready",
			verified: device.verified !== false,
		}));
}

/** How often the picker re-checks while an Everyday browser is not ready. */
const RECHECK_MS = 2_000;

/**
 * The picker's re-check: every 2 s while any Everyday browser in `devices` is not ready, so
 * turning the setting on (or opening the browser) shows without reopening the picker. A
 * re-check is discovery, which never opens a socket, so it never raises the Allow prompt.
 */
export function everydayRecheckInterval(devices: readonly Device[] | undefined): number | false {
	return everydayEntries(devices ?? []).some((entry) => !entry.ready) ? RECHECK_MS : false;
}

/** `remote debugging off · unverified`: an entry's state, and whether it is unverified. */
export function everydayStateLine(entry: Pick<EverydayEntry, "state" | "verified">): string {
	return formatDeviceState(entry) ?? "";
}

/**
 * The line under an entry that is not ready: open a closed browser first (Open the setting
 * starts it), then turn remote debugging on. An unverified browser may not take the
 * setting's `chrome://` page (Opera may name it `opera://`), so it also says how by hand.
 */
export function turnOnHint(
	entry: Pick<EverydayEntry, "browserName" | "state" | "verified">,
): string {
	const hint =
		entry.state === "not running"
			? `${entry.browserName} is not running. Open the setting to start it, turn on remote debugging in the page that opens, then come back. Your browser asks you to Allow each connect.`
			: "Turn on remote debugging in the page that opens, then come back. Your browser asks you to Allow each connect.";
	return entry.verified
		? hint
		: `${hint} If the page doesn't load, open ${REMOTE_DEBUGGING_SETTING_URL} in ${entry.browserName} yourself.`;
}

/**
 * What the bar says while the runner waits for the user's Allow, with the seconds left
 * until the runner gives up (`EVERYDAY_ALLOW_TIMEOUT_MS`), once any are known.
 */
export function allowPrompt(browserName: string, secondsLeft?: number): string {
	const prompt = `Click Allow in ${browserName}`;
	return secondsLeft ? `${prompt} · ${secondsLeft} s` : prompt;
}

/** Whole seconds from `now` until `deadline`, rounded up, and never below zero. */
export function allowSecondsLeft(deadline: number, now: number): number {
	return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/**
 * How long a connect runs before the bar says it waits on Allow. The runner refuses an App
 * that has not accepted the warning at once, and a closed browser too, so neither is ever
 * told to click Allow. The CLI waits as long before its Allow line.
 */
const WAITING_DELAY_MS = 250;

/** The first line of the first-use warning, naming the browser. */
export function everydayWarningLine(browserName: string): string {
	return `The agent will act in your signed-in ${browserName}. It can read and change anything your accounts there can.`;
}

/** The user said no: Cancel on the warning, or while the browser waited for Allow. */
export class ConnectCancelledError extends Error {
	constructor() {
		super("Connect cancelled");
		this.name = "ConnectCancelledError";
	}
}

/** Whether a connect ended because the user cancelled it, which needs no error toast. */
export function isConnectCancelled(error: unknown): boolean {
	return (
		error instanceof ConnectCancelledError ||
		(error instanceof Error && error.name === "AbortError")
	);
}

/**
 * Connect, and when the runner asks for the Everyday browser's first-use warning (428),
 * `confirm` it with the user and connect again with it accepted. The runner remembers the
 * acceptance per App, so each App asks once. A Cancel rejects with `ConnectCancelledError`.
 *
 * `onWaiting` says the runner now waits on the user's Allow: right away on the connect
 * after the warning was accepted, and on the first connect only once it has run
 * `waitingDelayMs` without an answer, so a refusal never flashes "Click Allow" first.
 */
export async function connectAcceptingWarning(
	request: ConnectDeviceRequest,
	deps: {
		connect: (request: ConnectDeviceRequest) => Promise<ActiveDeviceResponse>;
		confirm: (warning: EverydayWarningRequired) => Promise<boolean>;
		onWaiting?: () => void;
		waitingDelayMs?: number;
	},
): Promise<ActiveDeviceResponse> {
	const onWaiting = deps.onWaiting ?? (() => undefined);
	const waitingLater = setTimeout(onWaiting, deps.waitingDelayMs ?? WAITING_DELAY_MS);
	try {
		return await deps.connect(request);
	} catch (error) {
		const warning = everydayWarningRequired(error);
		if (!warning) throw error;
		clearTimeout(waitingLater);
		if (!(await deps.confirm(warning))) throw new ConnectCancelledError();
		onWaiting();
		return deps.connect({ ...request, acceptEverydayWarning: true });
	} finally {
		clearTimeout(waitingLater);
	}
}

type NoteStorage = Pick<Storage, "getItem" | "setItem">;

const DISCONNECT_NOTE_KEY = "yoqa.everydayDisconnectNoteShown";

function defaultStorage(): NoteStorage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

/**
 * The one-time note after the first disconnect from an Everyday browser: Yoqa leaves the
 * toggle as it was, so it is still on. Null for any other device and once it was shown.
 */
export function takeDisconnectNote(
	deviceId: string,
	browserName: string,
	storage: NoteStorage | null = defaultStorage(),
): string | null {
	if (!isEverydayDeviceId(deviceId)) return null;
	try {
		if (storage?.getItem(DISCONNECT_NOTE_KEY)) return null;
		storage?.setItem(DISCONNECT_NOTE_KEY, "1");
	} catch {
		// a restricted webview shows it each time rather than never
	}
	return `Remote debugging is still on in ${browserName}. Turn it off at ${REMOTE_DEBUGGING_SETTING_URL} when you no longer want Yoqa to connect.`;
}
