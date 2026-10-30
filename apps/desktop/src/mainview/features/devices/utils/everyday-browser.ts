import { REMOTE_DEBUGGING_SETTING_URL } from "@/../shared/everyday-browser";
import {
	type ActiveDeviceResponse,
	type ConnectDeviceRequest,
	type Device,
	type EverydayWarningRequired,
	everydayWarningRequired,
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

/** An Everyday browser in the picker: ready to connect, or with remote debugging off. */
export type EverydayEntry = Pick<Device, "id" | "name" | "osVersion" | "kind" | "state"> & {
	browserName: string;
	ready: boolean;
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
		}));
}

/** What the bar says while the runner waits for the user's Allow. */
export function allowPrompt(browserName: string): string {
	return `Click Allow in ${browserName}`;
}

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
 */
export async function connectAcceptingWarning(
	request: ConnectDeviceRequest,
	deps: {
		connect: (request: ConnectDeviceRequest) => Promise<ActiveDeviceResponse>;
		confirm: (warning: EverydayWarningRequired) => Promise<boolean>;
	},
): Promise<ActiveDeviceResponse> {
	try {
		return await deps.connect(request);
	} catch (error) {
		const warning = everydayWarningRequired(error);
		if (!warning) throw error;
		if (!(await deps.confirm(warning))) throw new ConnectCancelledError();
		return deps.connect({ ...request, acceptEverydayWarning: true });
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
