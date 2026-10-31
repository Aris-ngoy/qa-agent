/**
 * The physical-iOS Direct lane (`device-ios`): `YoqaRunner` on a cabled iPhone, reached
 * from the Mac through a usbmuxd tunnel to its port on the phone's loopback. A `status`
 * call must cross the cable before the session is handed out, so a dead link is reported
 * before any gesture is sent. App lifecycle stays `xcrun devicectl`.
 *
 * Coordinates cross the Device Session as 0–1000 and reach the runner as 0.0–1.0 fractions
 * of the screen. The screenshot is the whole screen too, so both coordinate spaces convert
 * the same way. Gestures are journaled on the runner, so a lost reply never double-taps.
 * Frame, tree and viewport reads use a separate Inspector Session: a usbmux miss there
 * does not end the Device Session. A gesture still does, once the cable stays unreachable
 * past the grace window.
 *
 * The tree is the runner's `snapshot` of the app in front, shown as the same JSON the
 * simulator's `yoqa-ax` tree uses, with the `ScreenSource` it was read from. With a target
 * app the runner reads that app; without one it reads the first of the phone's user apps
 * (listed once per Device Session through `devicectl`) that is in the foreground, else
 * SpringBoard. A snapshot never brings an app forward: a target app that is not in front is
 * `APP_BACKGROUNDED`. A stuck main thread on the phone is `RUNNER_WEDGED`.
 * Both reach the caller as `YoqaRunnerCommandError`s with a plain message.
 *
 * The Inspector's mirror is half-size JPEGs the phone captures in the background, served as
 * MJPEG (`ios-device-preview.ts`), not a full PNG per poll. A Run recording reads the same
 * capture and is encoded by `ffmpeg` (`frame-recorder.ts`); screenshots are the fallback
 * when the phone has no recorder.
 *
 * Alerts, URLs and terminating an app arrive in later slices; until then they reject with
 * a clear message.
 */

import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { type KeyName, type ScreenSource, screenSourceSchema } from "@yoqa/runner-client";
import { parseDevicectlApps } from "./devicectl";
import { errorChain } from "./error-chain";
import {
	type FrameRecorderDeps,
	type FrameSource,
	recordFrames,
	screenshotSource,
} from "./frame-recorder";
import { IOS_PREVIEW_CAPTURE, type PhonePreview, startPhonePreview } from "./ios-device-preview";
import { yoqaAxTreeToSource } from "./ios-direct-lane";
import { looksLikePhysicalIosUdid } from "./ios-udid";
import {
	type CapturedFrame,
	DeadSessionError,
	type DeviceSession,
	DeviceUnreachableError,
	type KeySupport,
	type PointerPhase,
	type SessionOptions,
	assertKeySupported,
} from "./lane";
import { remember } from "./once";
import { SCREENSHOT_DIR } from "./screenshot-retention";
import { connectUsbmux } from "./usbmuxd";
import type { YoqaAxNode } from "./yoqa-ax";
import { type RunnerExec, type YoqaRunner, startYoqaRunner, yoqaRunnerDeps } from "./yoqa-runner";
import {
	YoqaRunnerCommandError,
	YoqaRunnerUnreachableError,
	createYoqaRunnerLink,
} from "./yoqa-runner-link";

/** A tap held longer than this is a long-press. */
const LONG_PRESS_MIN_MS = 80;
/** How long a swipe holds before it moves; a drag holds long enough to pick its item up. */
const SWIPE_PRESS_MS = 50;
/** A swipe's default movement time, also used for a live pointer drag. */
const SWIPE_MS = 400;
const DRAG_PRESS_MS = 500;
/** Typed text is cut at a newline (return) and at a backspace character (delete). */
const BACKSPACE = String.fromCharCode(8);
const KEY_SEPARATORS = new RegExp(`(\\r?\\n|${BACKSPACE})`);

/**
 * What `YoqaRunner` can press on the phone's own keyboard: return, delete, and a typed
 * space. It sends no other key, and cannot hold a modifier.
 */
const PHONE_KEYS = {
	Enter: ["keyboardReturn", {}],
	Backspace: ["keyboardDelete", {}],
	Space: ["type", { text: " " }],
} as const satisfies Partial<Record<KeyName, readonly [string, Record<string, unknown>]>>;
const PHONE_KEY_SUPPORT: KeySupport = {
	keys: Object.keys(PHONE_KEYS) as KeyName[],
	modifiers: false,
};

/** How often the Mac pulls the recording's frames off the phone. */
const RECORDING_PULL_MS = 400;

/** A started `YoqaRunner`: its port on the phone, and how to stop it. */
export type StartedRunner = Pick<YoqaRunner, "port" | "exited" | "stop">;

export type IosDeviceDeps = {
	/** Sign, build if needed, and start `YoqaRunner` on the phone. */
	startRunner: (udid: string) => Promise<StartedRunner>;
	/** Open a tunnel to `port` on the phone's loopback. */
	connect: (udid: string, port: number) => Promise<Duplex>;
	/** Runs `xcrun devicectl <args>`. */
	devicectl: RunnerExec;
	/** `ffmpeg` for Run recording; the host's own when omitted. */
	recorder?: FrameRecorderDeps;
	/** How long the runner may stay unreachable before the session is dead; `UNREACHABLE_GRACE_MS` when omitted. */
	unreachableGraceMs?: number;
};

/**
 * One failed tunnel is not a dead phone: usbmuxd drops out for a moment while the inspector's
 * frame loop and tree reads hammer it, the screen locks, or USB re-enumerates, and the runner
 * is still alive on the phone. A gesture's session dies when the runner process exits or the
 * cable has been unreachable for this long without a single gesture getting through. Frame and
 * tree reads use the Inspector Session and never end the Device Session.
 */
const UNREACHABLE_GRACE_MS = 20_000;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** 0–1000 to the 0.0–1.0 the runner takes; the conversion happens here, at the Lane's edge. */
function fraction(norm: number): number {
	return Math.min(1, Math.max(0, norm / 1000));
}

/** Plain-language messages for the runner's own errors; its code is kept. */
function explainRunnerError(error: YoqaRunnerCommandError, app: string | undefined) {
	if (error.code === "APP_BACKGROUNDED") {
		return new YoqaRunnerCommandError(
			error.code,
			`${app ?? "The app"} is not in the foreground on the phone, so its screen was not read; it was not brought forward (${error.message})`,
		);
	}
	if (error.code === "RUNNER_WEDGED") {
		return new YoqaRunnerCommandError(
			error.code,
			`YoqaRunner's main thread is stuck on the phone and did not answer (${error.message}); stop the session and open a new one`,
		);
	}
	return error;
}

/**
 * The app a snapshot was read from, as the runner names it. A runner built before it named
 * one read the app it was asked for, or SpringBoard when asked for none.
 */
function snapshotSource(named: unknown, asked: string | undefined): ScreenSource {
	const parsed = screenSourceSchema.safeParse(named);
	if (parsed.success) return parsed.data;
	if (asked) return { kind: "target", bundleId: asked };
	return { kind: "system" };
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
	const openTunnel = () => deps.connect(udid, runner.port);
	// Gestures and the runner's own status. A miss here can end the Device Session.
	const controlLink = createYoqaRunnerLink(openTunnel);
	// Frames, the tree and the viewport. A miss here stays on this link.
	const inspectorLink = createYoqaRunnerLink(openTunnel);
	// The live mirror's frame pull. It stays off the gesture link so a tap does not wait for a JPEG.
	const previewLink = createYoqaRunnerLink(openTunnel);
	try {
		await controlLink.send("status");
	} catch (error) {
		await runner.stop().catch(() => undefined);
		throw new Error(
			`YoqaRunner status did not cross the cable to port ${runner.port}: ${errorMessage(error)}`,
		);
	}

	let quitting = false;
	let stopping: Promise<void> | null = null;

	let chain: Promise<unknown> = Promise.resolve();
	const withActionLock = <T>(fn: () => Promise<T>): Promise<T> => {
		const run = chain.then(fn, fn);
		chain = run.catch(() => undefined);
		return run;
	};

	// One inspector tunnel at a time, so a frame and a tree read do not open two usbmuxd
	// connections together. Gestures stay on `withActionLock` and can run alongside a read.
	let inspectorChain: Promise<unknown> = Promise.resolve();
	const withInspectorLock = <T>(fn: () => Promise<T>): Promise<T> => {
		const run = inspectorChain.then(fn, fn);
		inspectorChain = run.catch(() => undefined);
		return run;
	};

	/** A runner the cable no longer reaches is a Dead Session, reported once. */
	let notifiedDead = false;
	let sessionEnded: DeadSessionError | null = null;
	const graceMs = deps.unreachableGraceMs ?? UNREACHABLE_GRACE_MS;
	let unreachableSince: number | null = null;
	/**
	 * The app a snapshot reads: the one the session was opened for, then the last one
	 * activated or set as the target.
	 */
	let appId = options.bundleId;
	const dead = (error: Error) => {
		const unreachableMs =
			unreachableSince === null ? undefined : Math.round(performance.now() - unreachableSince);
		if (!notifiedDead) {
			notifiedDead = true;
			// The toast only has room for the outer message; the full chain goes to the runner log.
			console.error(
				`[yoqa-runner] Device session ended on iPhone ${udid}`,
				JSON.stringify({ unreachableMs, graceMs, chain: errorChain(error) }, null, 2),
			);
			options.onSessionDead?.();
		}
		sessionEnded = Object.assign(
			new DeadSessionError(`Device session ended: ${error.message}`, { cause: error }),
			{ unreachableMs, graceMs },
		);
		return sessionEnded;
	};
	// The process exiting ends the Device Session; later gestures and Inspector reads both
	// surface as a Dead Session (a cable miss on a read alone does not).
	void runner.exited.then(() => {
		if (!quitting) dead(new Error("YoqaRunner exited"));
	});
	const call = async (command: string, fields?: Record<string, unknown>, journaled = false) => {
		if (sessionEnded) throw sessionEnded;
		try {
			const reply = await controlLink.send(command, fields, { journaled });
			unreachableSince = null;
			return reply;
		} catch (error) {
			if (error instanceof YoqaRunnerCommandError) {
				// The runner answered, so the cable is fine.
				unreachableSince = null;
				throw explainRunnerError(error, appId);
			}
			if (!(error instanceof YoqaRunnerUnreachableError) || quitting) throw error;
			if (!error.transient) throw dead(error);
			unreachableSince ??= performance.now();
			const unreachableMs = Math.round(performance.now() - unreachableSince);
			if (unreachableMs < graceMs) {
				// Transient: the caller may try again. The Device Session stays.
				throw new DeviceUnreachableError(
					`YoqaRunner is briefly unreachable, retrying: ${error.message}`,
					unreachableMs,
					graceMs,
					{ cause: error },
				);
			}
			throw dead(error);
		}
	};

	/**
	 * The Inspector Session: screenshot, snapshot and viewport. A cable miss answers
	 * unreachable and leaves the Device Session connected, including past the grace
	 * window. The runner exiting still ends it, through `runner.exited`.
	 */
	let inspectorUnreachableSince: number | null = null;
	let inspectorGraceLogged = false;
	const inspect = async (command: string, fields?: Record<string, unknown>) => {
		if (sessionEnded) throw sessionEnded;
		try {
			const reply = await inspectorLink.send(command, fields);
			inspectorUnreachableSince = null;
			inspectorGraceLogged = false;
			return reply;
		} catch (error) {
			if (error instanceof YoqaRunnerCommandError) {
				inspectorUnreachableSince = null;
				inspectorGraceLogged = false;
				throw explainRunnerError(error, appId);
			}
			if (!(error instanceof YoqaRunnerUnreachableError) || quitting) throw error;
			inspectorUnreachableSince ??= performance.now();
			const unreachableMs = Math.round(performance.now() - inspectorUnreachableSince);
			if (unreachableMs >= graceMs && !inspectorGraceLogged) {
				inspectorGraceLogged = true;
				console.warn(
					`[yoqa-runner] Inspector session cannot reach iPhone ${udid}; the device session stays connected`,
					JSON.stringify({ unreachableMs, graceMs, chain: errorChain(error) }),
				);
			}
			throw new DeviceUnreachableError(
				`Inspector session cannot reach YoqaRunner: ${error.message}`,
				unreachableMs,
				graceMs,
				{ cause: error },
			);
		}
	};

	const readWindowSize = remember(async () => {
		const size = (await inspect("viewport")) as { width?: unknown; height?: unknown };
		if (typeof size?.width !== "number" || typeof size?.height !== "number") {
			throw new Error("YoqaRunner viewport omitted the screen size");
		}
		return { width: size.width, height: size.height };
	});

	/**
	 * The phone's user apps, the runner's candidates for the foreground app when there is no
	 * target app. Listed once per Device Session; a list that fails is empty for the rest of
	 * it, so the tree reads SpringBoard, rather than paying for `devicectl` on every read.
	 */
	const installedApps = remember(async () => {
		const dir = await mkdtemp(join(tmpdir(), "yoqa-apps-"));
		const jsonPath = join(dir, "apps.json");
		try {
			const result = await deps.devicectl([
				"device",
				"info",
				"apps",
				"--device",
				udid,
				"--json-output",
				jsonPath,
			]);
			if (result.exitCode !== 0) {
				throw new Error(result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`);
			}
			return parseDevicectlApps(JSON.parse(await readFile(jsonPath, "utf8")));
		} catch (error) {
			console.warn(
				`[yoqa-runner] devicectl could not list the apps on iPhone ${udid} (${errorMessage(error)}); with no target app, the tree is SpringBoard's`,
			);
			return [];
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	/** The runner's snapshot as the JSON the Screen reads, in the window's points. */
	const readPageSource = async () => {
		const asked = appId;
		const fields = asked ? { bundleId: asked } : { candidates: await installedApps() };
		const reply = (await inspect("snapshot", fields)) as {
			nodes?: unknown;
			source?: unknown;
		};
		if (!Array.isArray(reply?.nodes)) throw new Error("YoqaRunner snapshot omitted its nodes");
		return yoqaAxTreeToSource(
			{ nodes: reply.nodes as YoqaAxNode[], degraded: reply.nodes.length === 0 },
			await readWindowSize(),
			snapshotSource(reply.source, asked),
		);
	};

	/** Text goes in as typed; a newline presses return, and a backspace character presses delete. */
	const typeText = async (text: string) => {
		for (const part of text.split(KEY_SEPARATORS)) {
			if (part === "") continue;
			if (part === BACKSPACE) await call("keyboardDelete", {}, true);
			else if (part === "\n" || part === "\r\n") await call("keyboardReturn", {}, true);
			else await call("type", { text: part }, true);
		}
	};

	const readFrame = async (): Promise<CapturedFrame> => {
		const shot = (await inspect("screenshot")) as { png?: unknown };
		if (typeof shot?.png !== "string" || shot.png.length === 0) {
			throw new Error("YoqaRunner screenshot returned an empty frame");
		}
		return { base64: shot.png, mime: "image/png" };
	};
	const captureFrame = () => withInspectorLock(readFrame);
	const pageSource = () => withInspectorLock(readPageSource);
	const getWindowSize = () => withInspectorLock(readWindowSize);

	let preview: PhonePreview | null = null;
	try {
		preview = await startPhonePreview((command, fields) => previewLink.send(command, fields));
	} catch (error) {
		console.warn(
			`[yoqa-runner] live preview unavailable (${errorMessage(error)}); the inspector will poll screenshots`,
		);
	}

	/** The phone captures JPEGs in the background; the Mac pulls them in batches. */
	const runnerFrames = (): FrameSource => {
		let after: number | undefined;
		return {
			intervalMs: RECORDING_PULL_MS,
			start: async () => {
				// The mirror already started the phone's recorder. Starting it again would
				// drop the frames the inspector is showing.
				if (preview) return;
				await call("recordStart", IOS_PREVIEW_CAPTURE);
			},
			pull: async () => {
				const reply = (await call("recordFetch", after === undefined ? {} : { after })) as {
					frames?: Array<{ seq?: unknown; ms?: unknown; jpeg?: unknown }>;
				};
				const out = [];
				for (const frame of reply?.frames ?? []) {
					if (typeof frame.seq !== "number" || typeof frame.ms !== "number") continue;
					if (typeof frame.jpeg !== "string") continue;
					after = frame.seq;
					out.push({
						bytes: Uint8Array.from(Buffer.from(frame.jpeg, "base64")),
						at: frame.ms,
						ext: "jpg" as const,
					});
				}
				return out;
			},
			stop: async () => {
				if (preview) return;
				await call("recordStop");
			},
		};
	};

	const startRecording = async (path: string) => {
		try {
			return await recordFrames(runnerFrames(), path, deps.recorder);
		} catch (error) {
			// A runner built before recording existed (or one that cannot capture) still gets a
			// video from screenshots; no ffmpeg stays an error, which the Run recorder explains.
			if (/ffmpeg.*not found/i.test(errorMessage(error))) throw error;
			console.warn(
				`[yoqa-runner] phone-side recording unavailable (${errorMessage(error)}); using screenshots`,
			);
			return recordFrames(
				screenshotSource(async () => (await captureFrame()).base64),
				path,
			);
		}
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
		stream: preview?.stream ?? null,
		quit: async () => {
			quitting = true;
			await preview?.stop().catch(() => undefined);
			preview = null;
			// A failed stop is retried by the next quit; a finished one is not repeated.
			stopping ??= runner.stop().catch((error: unknown) => {
				stopping = null;
				throw error;
			});
			await stopping;
		},
		captureFrame,
		screenshot,
		startRecording,
		pageSource,
		getWindowSize,
		tap: (x, y, tapOptions) => withActionLock(() => tapNorm(x, y, tapOptions?.durationMs)),
		swipe: (x1, y1, x2, y2, durationMs = SWIPE_MS) =>
			withActionLock(() =>
				dragNorm({ x: x1, y: y1 }, { x: x2, y: y2 }, durationMs, SWIPE_PRESS_MS),
			),
		drag: (x1, y1, x2, y2, durationMs = 800) =>
			withActionLock(() => dragNorm({ x: x1, y: y1 }, { x: x2, y: y2 }, durationMs, DRAG_PRESS_MS)),
		type: (text) => withActionLock(() => typeText(text)),
		keySupport: PHONE_KEY_SUPPORT,
		key: async (name, modifiers = []) => {
			assertKeySupported(PHONE_KEY_SUPPORT, "on a cabled iPhone", name, modifiers);
			const [command, fields] = PHONE_KEYS[name as keyof typeof PHONE_KEYS];
			await withActionLock(() => call(command, fields, true));
		},
		activateApp: async (id) => {
			await devicectl(["device", "process", "launch", "--device", udid, id], "devicectl launch");
			appId = id;
		},
		setTargetApp: (id) => {
			appId = id;
		},
		terminateApp: notYet("Terminating an app"),
		backgroundApp: (seconds = 3) =>
			withActionLock(async () => {
				await call("button", { name: "home" }, true);
				if (!appId) return;
				await Bun.sleep(seconds * 1000);
				await devicectl(
					["device", "process", "launch", "--device", udid, appId],
					"devicectl launch",
				);
			}),
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
