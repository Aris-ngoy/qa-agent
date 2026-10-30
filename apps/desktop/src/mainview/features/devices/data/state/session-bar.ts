import type {
	DeveloperNotTrusted,
	DeviceKind,
	DevicePlatform,
	ViewportPresetName,
} from "@yoqa/runner-client";

export type { DevicePlatform };

/** A device as the bar shows and connects it. */
export type SelectedDevice = {
	id: string;
	label: string;
	name: string;
	osVersion: string;
	platform: DevicePlatform;
	kind: DeviceKind;
	/** Web only: the Viewport preset to connect at. */
	viewport?: ViewportPresetName;
};

/** What a connect names: the device, and a browser's Viewport preset. */
export type ConnectTarget = Pick<SelectedDevice, "id" | "platform" | "viewport">;

/** The top bar's own state; the Active Session itself lives in the shared query. */
export type SessionBarState = {
	platform: DevicePlatform;
	/** The picked device; a session's device replaces it while one is up. */
	device: SelectedDevice | null;
	connecting: boolean;
	/** A Personal Team's runner is installed but not trusted on the iPhone: the trust steps. */
	untrusted: { info: DeveloperNotTrusted; target: ConnectTarget } | null;
	/** The Everyday browser's first-use warning, asked before an App's first connect to it. */
	everydayWarning: { browserName: string; warning: string } | null;
	/** The Everyday browser a connect is waiting on for the user's Allow. */
	waitingForAllow: string | null;
};

export function initialSessionBarState(platform: DevicePlatform): SessionBarState {
	return {
		platform,
		device: null,
		connecting: false,
		untrusted: null,
		everydayWarning: null,
		waitingForAllow: null,
	};
}
