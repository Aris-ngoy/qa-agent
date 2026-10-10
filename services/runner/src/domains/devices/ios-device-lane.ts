/**
 * The physical-iOS Direct lane (`device-ios`): `YoqaRunner` on a cabled iPhone, reached
 * from the Mac through a usbmuxd tunnel to its port on the phone's loopback. A `status`
 * call must cross the cable before the session is handed out, so a dead link is reported
 * before any gesture is sent. App lifecycle stays `xcrun devicectl`.
 *
 * Gestures, screenshots and the tree arrive in later slices (#249, #250); until then they
 * reject with a clear message.
 */

import type { Duplex } from "node:stream";
import { looksLikePhysicalIosUdid } from "./appium-lane";
import type { DeviceSession, SessionOptions } from "./lane";
import { connectUsbmux } from "./usbmuxd";
import { type RunnerExec, type YoqaRunner, startYoqaRunner, yoqaRunnerDeps } from "./yoqa-runner";
import { createYoqaRunnerLink } from "./yoqa-runner-link";

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
		captureFrame: notYet("Capture frame"),
		screenshot: notYet("Screenshot"),
		pageSource: notYet("The Screen tree"),
		getWindowSize: notYet("Window size"),
		tap: notYet("Tap"),
		swipe: notYet("Swipe"),
		drag: notYet("Drag"),
		type: notYet("Typing"),
		activateApp: (appId) =>
			devicectl(["device", "process", "launch", "--device", udid, appId], "devicectl launch"),
		terminateApp: notYet("Terminating an app"),
		backgroundApp: notYet("Backgrounding an app"),
		openUrl: notYet("Opening a URL"),
		acceptAlert: notYet("Accepting an alert"),
		dismissAlert: notYet("Dismissing an alert"),
		withActionLock,
		pointerEvent: notYet("Live pointer input"),
		isPointerActive: () => false,
	};
}
