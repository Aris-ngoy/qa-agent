/**
 * The physical-iOS Direct lane (`device-ios`): `YoqaRunner` on a cabled iPhone, reached
 * from the Mac through a usbmuxd tunnel to its port on the phone's loopback. A `status`
 * call must cross the cable before the session is handed out, so a dead link is reported
 * before any gesture is sent. App lifecycle stays `xcrun devicectl`.
 *
 * Coordinates cross the Device Session as 0–1000 and reach the runner as 0.0–1.0 fractions
 * of the screen. The screenshot is the whole screen too, so both coordinate spaces convert
 * the same way. Gestures are journaled on the runner, so a lost reply never double-taps.
 *
 * The tree, typing and the rest arrive in later slices (#250); until then they reject with
 * a clear message.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { looksLikePhysicalIosUdid } from "./appium-lane";
import {
	type CapturedFrame,
	DeadSessionError,
	type DeviceSession,
	type PointerPhase,
	type SessionOptions,
} from "./lane";
import { remember } from "./once";
import { SCREENSHOT_DIR } from "./screenshot-retention";
import { connectUsbmux } from "./usbmuxd";
import { type RunnerExec, type YoqaRunner, startYoqaRunner, yoqaRunnerDeps } from "./yoqa-runner";
import { YoqaRunnerUnreachableError, createYoqaRunnerLink } from "./yoqa-runner-link";

/** A tap held longer than this is a long-press. */
const LONG_PRESS_MIN_MS = 80;
/** How long a swipe holds before it moves; a drag holds long enough to pick its item up. */
const SWIPE_PRESS_MS = 50;
/** A swipe's default movement time, also used for a live pointer drag. */
const SWIPE_MS = 400;
const DRAG_PRESS_MS = 500;

/** A started `YoqaRunner`: its port on the phone, and how to stop it. */
export type StartedRunner = Pick<YoqaRunner, "port" | "exited" | "stop">;

export type IosDeviceDeps = {
	/** Sign, build if needed, and start `YoqaRunner` on the phone. */
	startRunner: (udid: string) => Promise<StartedRunner>;
	/** Open a tunnel to `port` on the phone's loopback. */
	connect: (udid: string, port: number) => Promise<Duplex>;
	/** Runs `xcrun devicectl <args>`. */
	devicectl: RunnerExec;
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** 0–1000 to the 0.0–1.0 the runner takes; the conversion happens here, at the Lane's edge. */
function fraction(norm: number): number {
	return Math.min(1, Math.max(0, norm / 1000));
}

function notYet(what: string): () => Promise<never> {
	return () =>
		Promise.reject(new Error(`${what} is not available on the physical-iOS Direct lane yet`));
}

/** The real Mac: `YoqaRunner` through xcodebuild, usbmuxd, and `xcrun devicectl`. */
export function iosDeviceDeps(): IosDeviceDeps {
	const runnerDeps = yoqaRunnerDeps();
	return {
		startRunner: (udid) => startYoqaRunner(udid, runnerDeps),
		connect: (udid, port) => connectUsbmux(udid, port),
		devicectl: (args) => runnerDeps.exec(["xcrun", "devicectl", ...args]),
	};
}

export async function createIosDeviceSession(
	options: SessionOptions,
	deps: IosDeviceDeps = iosDeviceDeps(),
): Promise<DeviceSession> {
	const udid = options.deviceId;
	if (options.platform !== "ios" || !looksLikePhysicalIosUdid(udid)) {
		throw new Error("The physical-iOS Direct lane drives a cabled physical iPhone only");
	}

	const runner = await deps.startRunner(udid);
	const link = createYoqaRunnerLink(() => deps.connect(udid, runner.port));
	try {
		await link.send("status");
	} catch (error) {
		await runner.stop().catch(() => undefined);
		throw new Error(
			`YoqaRunner status did not cross the cable to port ${runner.port}: ${errorMessage(error)}`,
		);
	}

	let quitting = false;
	let stopping: Promise<void> | null = null;
	void runner.exited.then(() => {
		if (!quitting) options.onSessionDead?.();
	});

	let chain: Promise<unknown> = Promise.resolve();
	const withActionLock = <T>(fn: () => Promise<T>): Promise<T> => {
		const run = chain.then(fn, fn);
		chain = run.catch(() => undefined);
		return run;
	};

	/** A runner the cable no longer reaches is a Dead Session, reported once. */
	let notifiedDead = false;
	const call = async (command: string, fields?: Record<string, unknown>, journaled = false) => {
		try {
			return await link.send(command, fields, { journaled });
		} catch (error) {
			if (!(error instanceof YoqaRunnerUnreachableError) || quitting) throw error;
			if (!notifiedDead) {
				notifiedDead = true;
				options.onSessionDead?.();
			}
			throw new DeadSessionError(`Device session ended: ${error.message}`);
		}
	};

	const getWindowSize = remember(async () => {
		const size = (await call("viewport")) as { width?: unknown; height?: unknown };
		if (typeof size?.width !== "number" || typeof size?.height !== "number") {
			throw new Error("YoqaRunner viewport omitted the screen size");
		}
		return { width: size.width, height: size.height };
	});

	const captureFrame = async (): Promise<CapturedFrame> => {
		const shot = (await call("screenshot")) as { png?: unknown };
		if (typeof shot?.png !== "string" || shot.png.length === 0) {
			throw new Error("YoqaRunner screenshot returned an empty frame");
		}
		return { base64: shot.png, mime: "image/png" };
	};

	const screenshot = async () => {
		await mkdir(SCREENSHOT_DIR, { recursive: true });
		const frame = await captureFrame();
		const path = join(SCREENSHOT_DIR, `shot_${Date.now()}_${crypto.randomUUID()}.png`);
		await Bun.write(path, Uint8Array.from(Buffer.from(frame.base64, "base64")));
		return { path, base64: frame.base64 };
	};

	const tapNorm = async (xNorm: number, yNorm: number, durationMs = 0) => {
		const point = { x: fraction(xNorm), y: fraction(yNorm) };
		if (durationMs > LONG_PRESS_MIN_MS) {
			await call("longPress", { ...point, durationMs }, true);
		} else {
			await call("tap", point, true);
		}
	};

	const dragNorm = async (
		from: { x: number; y: number },
		to: { x: number; y: number },
		durationMs: number,
		pressMs: number,
	) => {
		await call(
			"drag",
			{
				fromX: fraction(from.x),
				fromY: fraction(from.y),
				toX: fraction(to.x),
				toY: fraction(to.y),
				durationMs,
				pressMs,
			},
			true,
		);
	};

	let pointerStart: { x: number; y: number } | null = null;
	let pointerActive = false;

	const devicectl = async (args: string[], label: string) => {
		const result = await deps.devicectl(args);
		if (result.exitCode !== 0) {
			throw new Error(
				`${label}: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`}`,
			);
		}
	};

	return {
		lane: "direct",
		stream: null,
		quit: async () => {
			quitting = true;
			// A failed stop is retried by the next quit; a finished one is not repeated.
			stopping ??= runner.stop().catch((error: unknown) => {
				stopping = null;
				throw error;
			});
			await stopping;
		},
		captureFrame,
		screenshot,
		pageSource: notYet("The Screen tree"),
		getWindowSize,
		tap: (x, y, tapOptions) => withActionLock(() => tapNorm(x, y, tapOptions?.durationMs)),
		swipe: (x1, y1, x2, y2, durationMs = SWIPE_MS) =>
			withActionLock(() =>
				dragNorm({ x: x1, y: y1 }, { x: x2, y: y2 }, durationMs, SWIPE_PRESS_MS),
			),
		drag: (x1, y1, x2, y2, durationMs = 800) =>
			withActionLock(() => dragNorm({ x: x1, y: y1 }, { x: x2, y: y2 }, durationMs, DRAG_PRESS_MS)),
		type: notYet("Typing"),
		activateApp: (appId) =>
			devicectl(["device", "process", "launch", "--device", udid, appId], "devicectl launch"),
		terminateApp: notYet("Terminating an app"),
		backgroundApp: notYet("Backgrounding an app"),
		openUrl: notYet("Opening a URL"),
		acceptAlert: notYet("Accepting an alert"),
		dismissAlert: notYet("Dismissing an alert"),
		withActionLock,
		pointerEvent: async (phase: PointerPhase, xNorm: number, yNorm: number) => {
			if (phase === "begin") {
				pointerStart = { x: xNorm, y: yNorm };
				pointerActive = true;
				return;
			}
			if (phase === "move") {
				pointerStart = pointerStart ?? { x: xNorm, y: yNorm };
				return;
			}
			const start = pointerStart ?? { x: xNorm, y: yNorm };
			pointerStart = null;
			pointerActive = false;
			if (start.x === xNorm && start.y === yNorm) {
				await tapNorm(xNorm, yNorm);
			} else {
				await dragNorm(start, { x: xNorm, y: yNorm }, SWIPE_MS, SWIPE_PRESS_MS);
			}
		},
		isPointerActive: () => pointerActive,
	};
}
