/**
 * The Device Session every Lane hands out, built once here above a smaller per-Lane
 * driver. A Lane implements what only it can do: capture a frame, read the tree, send a
 * gesture or a key, run the app lifecycle. This module supplies the rest, the same way on
 * every Lane:
 *
 * - the action lock: Actions run one at a time, in the order they were asked for, and one
 *   that fails does not stop the next;
 * - the screenshot, written under the run screenshots directory from the driver's frame;
 * - the live pointer: a press, moves and a release from the Inspector, either sent on as
 *   they come (`live`) or turned into one tap or swipe on release (`gesture`);
 * - the key check: a key the Lane does not declare fails before it reaches the device;
 * - restart-app as terminate then activate, for a Lane with no restart of its own;
 * - an unsupported member (no video on web, no URL on a cabled iPhone yet) rejecting with
 *   `ActionUnsupportedError`, which the runner answers as 422, with the Lane's message.
 *
 * What a Lane can do is its `LaneCapabilities`, declared on the driver and checked against
 * what the driver implements when the session is built, so the two cannot drift apart.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
	ActionUnsupportedError,
	type DeviceSession,
	type LaneCapabilities,
	type LiveStream,
	type OptionalLaneMember,
	assertKeySupported,
} from "./lane";
import { SCREENSHOT_DIR } from "./screenshot-retention";

/** A point in whatever units a driver's pointer works in (0–1000, device pixels, CSS pixels). */
export type Point = { x: number; y: number };

/**
 * How a Lane takes live pointer input. `at` turns the 0–1000 point into the driver's own
 * units first (0–1000 unchanged when omitted); a press and release at the same point there
 * is a tap.
 */
export type PointerDriver =
	| {
			/** The pointer is replayed on release: one tap, or one swipe from press to release. */
			kind: "gesture";
			at?: (xNorm: number, yNorm: number) => Promise<Point>;
			tap: (point: Point) => Promise<void>;
			swipe: (from: Point, to: Point) => Promise<void>;
	  }
	| {
			/** Each phase reaches the device as it comes: press, move while pressed, release. */
			kind: "live";
			at?: (xNorm: number, yNorm: number) => Promise<Point>;
			press: (point: Point) => Promise<void>;
			move: (point: Point) => Promise<void>;
			release: (point: Point) => Promise<void>;
	  };

/** What a Lane adds around the session's action lock. */
export type ActionLockHooks = {
	/** Called as an Action is asked for, before it waits its turn. */
	queued?: () => void;
	/** Awaited once an Action has its turn, before it runs. */
	ready?: () => Promise<unknown>;
	/** Called once an Action is done, whether it succeeded or not. */
	settled?: () => void;
};

/** Members a driver implements as-is: reads that take no lock, and quitting. */
type DriverReads = "quit" | "captureFrame" | "pageSource" | "getWindowSize" | "setTargetApp";

/** Actions a driver implements without locking; the session runs each under its action lock. */
type DriverActions = "tap" | "swipe" | "drag" | "type" | "key" | "activateApp" | "terminateApp";

/** What a Lane implements. The Device Session built from it (`composeDeviceSession`) does the rest. */
export type LaneDriver = Pick<DeviceSession, DriverReads | DriverActions> &
	Partial<Pick<DeviceSession, OptionalLaneMember | "restartApp" | "targetApp">> &
	Partial<Pick<DeviceSession, "laneWarning" | "browser" | "browserProfileName" | "viewport">> & {
		stream: LiveStream | null;
		capabilities: LaneCapabilities;
		/** Where a key goes, as an error names it: "on an iOS simulator". */
		where: string;
		pointer: PointerDriver;
		lock?: ActionLockHooks;
	};

const OPTIONAL_MEMBERS: readonly OptionalLaneMember[] = [
	"startRecording",
	"backgroundApp",
	"openUrl",
	"acceptAlert",
	"dismissAlert",
];

const noop = () => undefined;

/**
 * Run `fn`s one at a time, in the order they were asked for. Each waits for the one before
 * it to finish, whether that one succeeded or not.
 */
export function createActionLock(
	hooks: ActionLockHooks = {},
): <T>(fn: () => Promise<T>) => Promise<T> {
	let chain: Promise<unknown> = Promise.resolve();
	return <T>(fn: () => Promise<T>): Promise<T> => {
		hooks.queued?.();
		const ready = hooks.ready;
		const step = ready ? () => ready().then(fn) : fn;
		const run = chain.then(step, step);
		const done = run.then(noop, noop);
		chain = hooks.settled ? done.finally(hooks.settled) : done;
		return run;
	};
}

/**
 * A driver whose capabilities and members disagree is a programming error in the Lane, so
 * it fails the connect rather than answering wrongly later.
 */
function checkDeclared(driver: LaneDriver): void {
	for (const member of OPTIONAL_MEMBERS) {
		const implemented = driver[member] !== undefined;
		const declaredUnsupported = driver.capabilities.unsupported[member] !== undefined;
		if (implemented === declaredUnsupported) {
			throw new Error(
				`A Lane driver must implement ${member} or declare why it cannot, not ${implemented ? "both" : "neither"}`,
			);
		}
	}
	if (driver.capabilities.targetApp !== (driver.targetApp !== undefined)) {
		throw new Error("A Lane driver that remembers a target app must say which one it is");
	}
}

/** Build the Device Session a Lane hands out from that Lane's driver. */
export function composeDeviceSession(driver: LaneDriver): DeviceSession {
	checkDeclared(driver);
	const { capabilities } = driver;
	const withActionLock = createActionLock(driver.lock);
	const locked =
		<A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
		(...args: A) =>
			withActionLock(() => fn(...args));

	/** `member`, under the lock, or its rejection when the Lane declared it cannot. */
	const optional = <M extends OptionalLaneMember>(
		member: M,
		lock: boolean,
	): NonNullable<LaneDriver[M]> => {
		const reason = capabilities.unsupported[member];
		const fn = driver[member] as ((...args: unknown[]) => Promise<unknown>) | undefined;
		if (reason !== undefined || !fn) {
			return (() =>
				Promise.reject(
					new ActionUnsupportedError(reason ?? `${member} is not available`),
				)) as NonNullable<LaneDriver[M]>;
		}
		return (lock ? locked(fn) : fn) as NonNullable<LaneDriver[M]>;
	};

	let pointerStart: Point | null = null;
	let pointerActive = false;
	const pointerEvent: DeviceSession["pointerEvent"] = async (phase, xNorm, yNorm) => {
		const { pointer } = driver;
		const point = pointer.at ? await pointer.at(xNorm, yNorm) : { x: xNorm, y: yNorm };
		if (pointer.kind === "live") {
			if (phase === "begin") {
				pointerActive = true;
				await pointer.press(point);
			} else if (phase === "move") {
				await pointer.move(point);
			} else {
				pointerActive = false;
				await pointer.release(point);
			}
			return;
		}
		if (phase === "begin") {
			pointerStart = point;
			pointerActive = true;
			return;
		}
		if (phase === "move") {
			pointerStart = pointerStart ?? point;
			return;
		}
		const start = pointerStart ?? point;
		pointerStart = null;
		pointerActive = false;
		if (start.x === point.x && start.y === point.y) await pointer.tap(point);
		else await pointer.swipe(start, point);
	};

	const session: DeviceSession = {
		lane: "direct",
		stream: driver.stream,
		capabilities,
		quit: driver.quit,
		captureFrame: driver.captureFrame,
		screenshot: async () => {
			await mkdir(SCREENSHOT_DIR, { recursive: true });
			const frame = await session.captureFrame();
			const path = join(SCREENSHOT_DIR, `shot_${Date.now()}_${crypto.randomUUID()}.png`);
			await Bun.write(path, Uint8Array.from(Buffer.from(frame.base64, "base64")));
			return { path, base64: frame.base64 };
		},
		startRecording: optional("startRecording", false),
		pageSource: driver.pageSource,
		getWindowSize: driver.getWindowSize,
		tap: locked(driver.tap),
		swipe: locked(driver.swipe),
		drag: locked(driver.drag),
		type: locked(driver.type),
		key: async (name, modifiers = []) => {
			assertKeySupported(capabilities.keys, driver.where, name, modifiers);
			await withActionLock(() => driver.key(name, modifiers));
		},
		activateApp: locked(driver.activateApp),
		setTargetApp: driver.setTargetApp,
		targetApp: driver.targetApp ?? (() => undefined),
		terminateApp: locked(driver.terminateApp),
		restartApp: driver.restartApp
			? locked(driver.restartApp)
			: async (appId) => {
					await session.terminateApp(appId);
					await session.activateApp(appId);
					// Ending an App's process and launching it again leaves its data alone.
					return { storage: "kept" };
				},
		backgroundApp: optional("backgroundApp", true),
		openUrl: optional("openUrl", true),
		acceptAlert: optional("acceptAlert", true),
		dismissAlert: optional("dismissAlert", true),
		pointerEvent,
		isPointerActive: () => pointerActive,
	};
	if (driver.laneWarning !== undefined) session.laneWarning = driver.laneWarning;
	if (driver.browser !== undefined) session.browser = driver.browser;
	if (driver.browserProfileName !== undefined) {
		session.browserProfileName = driver.browserProfileName;
	}
	if (driver.viewport !== undefined) session.viewport = driver.viewport;
	return session;
}
