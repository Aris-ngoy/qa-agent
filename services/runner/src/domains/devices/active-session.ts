import {
	type BrowserProfile,
	DEFAULT_VIEWPORT_PRESET,
	type DevicePlatform,
	type StreamState,
	type ViewportPresetName,
} from "@yoqa/runner-client";
import {
	DEFAULT_PROFILE_APP,
	type InstalledBrowserId,
	type LaunchDeps,
	installedBrowserIdOf,
	resetKeptProfiles,
} from "./chromium-browsers";
import { everydayBrowserIdOf } from "./chromium-everyday";
import { abortAllMjpegProxies } from "./mjpeg-proxy";
import { quitOpenDeviceSessions } from "./open-session";
import { type DeviceSession, createDeviceSession } from "./session";

export type ActiveSessionInfo = {
	deviceId: string;
	platform: DevicePlatform;
	connectedAt: number;
	/** Port of the live MJPEG broadcaster, when the Lane offers one. */
	mjpegPort?: number;
	/** Compat for older clients: `streamState === "ready"`. */
	streamReady: boolean;
	/** The Frame Feed: a live Stream, or Screenshot Poll because the Lane has none or it failed. */
	streamState: StreamState;
	/** Relative path on the runner for the MJPEG proxy. */
	streamUrl: string;
	/** A Run currently owns this session for test execution (interactive actions are view-only). */
	heldByRun: boolean;
	/** The id of the Run that holds this session, while one does. */
	heldByRunId?: string;
	lane: import("./lane").LaneName;
	laneWarning?: string;
	/** The Viewport preset a web session emulates. */
	viewport?: ViewportPresetName;
	/** An Everyday browser's profile the session's window opened in; null when unreadable. */
	browserProfileName?: string | null;
	/** The app the session reads now, on a Lane that remembers one. */
	targetApp?: string;
};

type ActiveSession = {
	deviceId: string;
	platform: DevicePlatform;
	connectedAt: number;
	/** Relative path on the runner for the MJPEG proxy. */
	streamUrl: string;
	session: DeviceSession;
	/** Run id currently executing on this session, when a Run owns it. */
	heldByRunId: string | null;
	/** Web only: the App and profile a launched browser was opened on. */
	appId?: string;
	profile?: BrowserProfile;
};

let active: ActiveSession | null = null;

/** Who hears that the Active Session's Screen may have changed: the open control sockets. */
const screenChangedListeners = new Set<() => void>();

/**
 * Hear the Active Session's screen-changed signal (a web page navigating, scrolling or
 * painting), whichever session is active when it comes. Returns the unsubscribe.
 */
export function onActiveScreenChanged(listener: () => void): () => void {
	screenChangedListeners.add(listener);
	return () => {
		screenChangedListeners.delete(listener);
	};
}

/** The device session is in use by a Run and cannot be replaced or disconnected interactively. */
export class SessionBusyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SessionBusyError";
	}
}

function streamStateOf(stream: DeviceSession["stream"]): StreamState {
	if (!stream) return "none";
	return stream.ready ? "ready" : "failed";
}

function toInfo(current: ActiveSession): ActiveSessionInfo {
	const streamState = streamStateOf(current.session.stream);
	const targetApp = current.session.targetApp?.();
	return {
		deviceId: current.deviceId,
		platform: current.platform,
		connectedAt: current.connectedAt,
		mjpegPort: current.session.stream?.port,
		streamReady: streamState === "ready",
		streamState,
		streamUrl: current.streamUrl,
		heldByRun: current.heldByRunId != null,
		...(current.heldByRunId != null ? { heldByRunId: current.heldByRunId } : {}),
		lane: current.session.lane,
		...(current.session.laneWarning ? { laneWarning: current.session.laneWarning } : {}),
		...(current.session.viewport ? { viewport: current.session.viewport } : {}),
		...(current.session.browserProfileName !== undefined
			? { browserProfileName: current.session.browserProfileName }
			: {}),
		...(targetApp ? { targetApp } : {}),
	};
}

export function getActiveSession(): ActiveSession | null {
	return active;
}

export function getActiveSessionInfo(): ActiveSessionInfo | null {
	if (!active) return null;
	return toInfo(active);
}

export function requireActiveSession(): ActiveSession {
	if (!active) {
		throw new Error("No active device session. Run: yoqa devices connect <device_id>");
	}
	return active;
}

/** True while a Run owns the shared session (view-only interactive mode). */
export function isActiveSessionHeldByRun(): boolean {
	return active?.heldByRunId != null;
}

/**
 * Drop the in-memory active session without calling deleteSession
 * (the remote session is already gone).
 */
export function abandonActiveSession(): ActiveSessionInfo | null {
	if (!active) return null;
	const info = getActiveSessionInfo();
	active = null;
	abortAllMjpegProxies();
	console.warn(
		`[yoqa-runner] abandoned dead device session for ${info?.platform} ${info?.deviceId}`,
	);
	return info;
}

async function createAndRegister(options: {
	deviceId: string;
	platform: DevicePlatform;
	bundleId?: string;
	appPackage?: string;
	requestedLane?: import("./lane").LaneName | "auto";
	viewport?: ViewportPresetName;
	appId?: string;
	profile?: BrowserProfile;
	signal?: AbortSignal;
	heldByRunId: string | null;
}): Promise<DeviceSession> {
	let opened: DeviceSession | null = null;
	const session = await createDeviceSession({
		platform: options.platform,
		deviceId: options.deviceId,
		bundleId: options.bundleId,
		appPackage: options.appPackage,
		requestedLane: options.requestedLane,
		viewport: options.viewport,
		appId: options.appId,
		profile: options.profile,
		signal: options.signal,
		onSessionDead: () => {
			abandonActiveSession();
		},
		onScreenChanged: () => {
			if (!opened || active?.session !== opened) return;
			for (const listener of screenChangedListeners) listener();
		},
	});
	opened = session;

	active = {
		deviceId: options.deviceId,
		platform: options.platform,
		connectedAt: Date.now(),
		streamUrl: "/stream.mjpeg",
		session,
		heldByRunId: options.heldByRunId,
		appId: options.appId,
		profile: options.profile,
	};

	return session;
}

/** Whether a web session was opened on the App and profile asked for, `default` and `kept` when omitted. */
function isOnProfile(
	current: ActiveSession,
	options: { appId?: string; profile?: BrowserProfile },
): boolean {
	return (
		(current.appId ?? DEFAULT_PROFILE_APP) === (options.appId ?? DEFAULT_PROFILE_APP) &&
		(current.profile ?? "kept") === (options.profile ?? "kept")
	);
}

/**
 * Whether a connect asks for the browser the Active Session already drives: the same web
 * device, App, profile and Viewport preset. A second launch on a Kept profile would find
 * it locked by the first.
 */
function isActiveBrowser(
	current: ActiveSession,
	options: {
		deviceId: string;
		platform: DevicePlatform;
		viewport?: ViewportPresetName;
		appId?: string;
		profile?: BrowserProfile;
	},
): boolean {
	return (
		options.platform === "web" &&
		current.platform === "web" &&
		current.deviceId === options.deviceId &&
		isOnProfile(current, options) &&
		(current.session.viewport ?? DEFAULT_VIEWPORT_PRESET) ===
			(options.viewport ?? DEFAULT_VIEWPORT_PRESET)
	);
}

/**
 * Reset `appId`'s Kept profile for `browserId`, or every browser's, and return the browsers
 * that had one. Refused while the Active Session's browser is open on one of them, or
 * another browser holds one.
 */
export async function resetKeptProfile(
	request: { appId?: string; browserId?: InstalledBrowserId },
	deps: Pick<LaunchDeps, "home" | "isProcessAlive"> = {},
): Promise<string[]> {
	const appId = request.appId ?? DEFAULT_PROFILE_APP;
	if (
		active?.platform === "web" &&
		installedBrowserIdOf(active.deviceId) &&
		(active.profile ?? "kept") === "kept" &&
		(active.appId ?? DEFAULT_PROFILE_APP) === appId &&
		(!request.browserId || request.browserId === active.deviceId)
	) {
		throw new SessionBusyError(
			`${active.deviceId} is open on the Kept profile of ${appId}. Disconnect it before resetting the profile.`,
		);
	}
	return resetKeptProfiles({ appId, browserId: request.browserId }, deps);
}

/**
 * Interactive connect (inspector / CLI). Replaces any existing session unless
 * a Run holds it — cancel the run first. A web session opens at `viewport`, and a browser
 * Yoqa launches uses `appId`'s Kept profile unless `profile` is `clean`. A connect to the
 * browser the Active Session already drives returns that session.
 */
export async function connectDevice(options: {
	deviceId: string;
	platform: DevicePlatform;
	bundleId?: string;
	appPackage?: string;
	requestedLane?: import("./lane").LaneName | "auto";
	viewport?: ViewportPresetName;
	appId?: string;
	profile?: BrowserProfile;
	/** Cancels a connect still waiting, such as on an Everyday browser's Allow. */
	signal?: AbortSignal;
}): Promise<ActiveSessionInfo> {
	if (isActiveSessionHeldByRun()) {
		throw new SessionBusyError(
			"A run is using the device session. Cancel the run before connecting another device.",
		);
	}
	if (active && isActiveBrowser(active, options)) {
		return toInfo(active);
	}
	if (active) {
		await disconnectDevice();
	}

	await createAndRegister({ ...options, heldByRunId: null });

	const info = getActiveSessionInfo();
	if (!info) {
		throw new Error("Failed to read active session after connect");
	}
	return info;
}

export async function disconnectDevice(): Promise<ActiveSessionInfo | null> {
	if (!active) return null;
	if (isActiveSessionHeldByRun()) {
		throw new SessionBusyError("A run is using the device session. Cancel the run first.");
	}
	const info = getActiveSessionInfo();
	const session = active.session;
	// Drop the handle first so new stream proxies refuse; then cut upstream
	// MJPEG so the device tool can actually terminate when the session ends.
	active = null;
	abortAllMjpegProxies();
	try {
		await session.quit();
	} catch {
		// ignore — timed out or already dead
	}
	return info;
}

/**
 * The runner is stopping: quit the Active Session, even one a Run holds, and every detached
 * session a Run opened, so nothing Yoqa launched outlives the runner. Each quits as on
 * disconnect: a launched browser keeps its Kept profile (a clean one is deleted), the
 * Everyday browser and attach by port close only Yoqa's window or socket.
 */
export async function quitEverySession(): Promise<void> {
	const session = active?.session;
	active = null;
	abortAllMjpegProxies();
	// The Active Session is in the open sessions too; quit it here in case it is not.
	await Promise.all([session?.quit().catch(() => undefined), quitOpenDeviceSessions()]);
}

/**
 * Point the Active Session at another app (the user switched app) without reconnecting
 * or launching anything. The app id the session's platform uses is picked from the two.
 * Refused while a Run holds the session: the Run decides which app it reads.
 */
export function retargetActiveSession(app: {
	bundleId?: string;
	appPackage?: string;
}): ActiveSessionInfo {
	const current = requireActiveSession();
	if (current.heldByRunId != null) {
		throw new SessionBusyError(
			"A run is using the device session. Wait for it to finish before switching app.",
		);
	}
	current.session.setTargetApp(targetAppFor({ platform: current.platform, ...app }));
	return toInfo(current);
}

/**
 * Run-side acquisition of the shared Device Session.
 *
 * - Adopts the Active Session when it already targets the requested device
 *   (no reconnect, no relaunch) and marks it held by this run. On web it must also be
 *   on the Run's App and profile (`appId`, `profile`), and at its Viewport preset when the
 *   Run names one (`viewport`).
 * - Replaces an unheld Active Session pointing at another device (device change), or a
 *   web one on another App, profile or preset, which reopens at the Run's preset, else the
 *   session's. The Everyday browser at another preset fails instead: reopening it would ask
 *   for Allow again.
 * - Opens a fresh Direct session when there is none to adopt. A failed
 *   Direct start fails it with that error.
 * - When another run owns the shared session, creates a detached session that
 *   is not registered as Active and is quit again at release. A held session on
 *   the same device is never replaced: that request fails with `SessionBusyError`.
 */
export async function acquireSessionForRun(options: {
	runId: string;
	deviceId: string;
	platform: DevicePlatform;
	bundleId?: string;
	appPackage?: string;
	requestedLane?: import("./lane").LaneName | "auto";
	/** Web only: the App whose Kept profile a launched browser uses, and whether it is clean. */
	appId?: string;
	profile?: BrowserProfile;
	/** Web only: the Viewport preset the Run asks for. Omitted, the session's own. */
	viewport?: ViewportPresetName;
}): Promise<{ session: DeviceSession; shared: boolean }> {
	const current = active;

	if (current?.heldByRunId && current.heldByRunId !== options.runId) {
		if (current.deviceId === options.deviceId) {
			throw new SessionBusyError(
				`Another run is using ${options.deviceId}. Wait for it to finish or cancel it first.`,
			);
		}
		const session = await createDeviceSession({
			platform: options.platform,
			deviceId: options.deviceId,
			bundleId: options.bundleId,
			appPackage: options.appPackage,
			requestedLane: options.requestedLane,
			viewport: options.viewport,
			appId: options.appId,
			profile: options.profile,
			onSessionDead: () => undefined,
		});
		return { session, shared: false };
	}

	const onDevice = current?.deviceId === options.deviceId ? current : undefined;
	// A replacement reopens at the preset the Run names, else the one the user connected at.
	const viewport = options.viewport ?? onDevice?.session.viewport;
	const connectedViewport = onDevice?.session.viewport ?? DEFAULT_VIEWPORT_PRESET;
	const atPreset = !options.viewport || connectedViewport === options.viewport;
	const everyday = onDevice ? everydayBrowserIdOf(onDevice.deviceId) !== null : false;

	// The Everyday browser reopens only by asking for Allow again, which a Run never does.
	if (onDevice && everyday && !atPreset) {
		throw new Error(
			`${options.deviceId} is connected at ${connectedViewport}, and reopening your Everyday browser asks for Allow again. Reconnect it at ${options.viewport} first: yoqa devices connect ${options.deviceId} --viewport ${options.viewport}`,
		);
	}

	// On web the session must also be on the Run's App, profile and preset, or the browser
	// reopens on them. The Everyday browser has only the user's profile.
	if (
		onDevice &&
		(onDevice.platform !== "web" || (atPreset && (everyday || isOnProfile(onDevice, options))))
	) {
		// Health-check before adopting: a stale session (device restarted,
		// its Lane dropped it) must not fail the whole run.
		const healthy = await onDevice.session
			.getWindowSize()
			.then(() => true)
			.catch(() => false);
		if (healthy) {
			onDevice.heldByRunId = options.runId;
			// The session may have been opened for another app; the Run reads its own.
			onDevice.session.setTargetApp(targetAppFor(options));
			return { session: onDevice.session, shared: true };
		}
		console.warn(
			`[yoqa-runner] active session for ${options.deviceId} is dead — creating a fresh one for the run`,
		);
		await disconnectDevice().catch(() => undefined);
	}

	if (active) {
		await disconnectDevice();
	}

	const session = await createAndRegister({
		deviceId: options.deviceId,
		platform: options.platform,
		bundleId: options.bundleId,
		appPackage: options.appPackage,
		requestedLane: options.requestedLane,
		viewport,
		appId: options.appId,
		profile: options.profile,
		heldByRunId: options.runId,
	});
	return { session, shared: true };
}

/**
 * The app id a session on this platform targets: the iOS bundle id or the Android package.
 * A web session targets no app.
 */
function targetAppFor(options: {
	platform: DevicePlatform;
	bundleId?: string;
	appPackage?: string;
}): string | undefined {
	switch (options.platform) {
		case "ios":
			return options.bundleId;
		case "android":
			return options.appPackage;
		case "web":
			return undefined;
	}
}

/**
 * Run-side release. A shared session stays live as the Active Session so the
 * user can inspect right after the run; a detached session is torn down.
 */
export async function releaseSessionFromRun(
	runId: string,
	session: DeviceSession,
	shared: boolean,
): Promise<void> {
	if (!shared) {
		await session.quit().catch(() => undefined);
		return;
	}
	if (active && active.heldByRunId === runId) {
		active.heldByRunId = null;
	}
}
