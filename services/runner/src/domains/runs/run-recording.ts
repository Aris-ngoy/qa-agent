import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RunRecording } from "@yoqa/runner-client";
import type { DeviceSession, ScreenRecording } from "../devices/lane";

/** Run recordings live here, one `<runTestId>.mp4` per recorded Test Case. */
export const RUN_VIDEO_DIR = join(homedir(), ".yoqa", "runs", "videos");

export function runVideoPath(runTestId: string, dir: string = RUN_VIDEO_DIR): string {
	return join(dir, `${runTestId}.mp4`);
}

export type RecordingOutcome = { status: "ready" } | { status: "unavailable"; note: string };

/** Longest we wait for a recorder to finish, so a stuck one cannot hold the device session. */
const STOP_TIMEOUT_MS = 20_000;

export type ActiveRecording = {
	/** Finalize the file. Never throws; a failure comes back as `unavailable`. */
	stop: () => Promise<RecordingOutcome>;
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Start a Run recording on `session`. Recording is evidence only, so it never throws:
 * a Lane or device that cannot record yields `{ unavailable }` and the Run carries on.
 */
export async function startRunRecording(
	session: DeviceSession,
	path: string,
): Promise<ActiveRecording | { unavailable: string }> {
	if (!session.startRecording) {
		return { unavailable: `The ${session.lane} lane cannot record video` };
	}
	let recording: ScreenRecording;
	try {
		recording = await session.startRecording(path);
	} catch (error) {
		const message = errorMessage(error);
		// Appium shells out to ffmpeg to record iOS; say what to do instead of showing its error.
		if (/ffmpeg.*not found/i.test(message)) {
			return {
				unavailable:
					"Recording on this device needs ffmpeg. Install it with `brew install ffmpeg`, then restart Yoqa.",
			};
		}
		return { unavailable: `Could not start recording: ${message}` };
	}
	return {
		stop: async () => {
			try {
				await Promise.race([
					recording.stop(),
					Bun.sleep(STOP_TIMEOUT_MS).then(() => {
						throw new Error("timed out");
					}),
				]);
			} catch (error) {
				return { status: "unavailable", note: `Could not save recording: ${errorMessage(error)}` };
			}
			if (!existsSync(path)) {
				return { status: "unavailable", note: "The device produced no video file" };
			}
			return { status: "ready" };
		},
	};
}

/** Best-effort removal of a case's video; used when its Run is deleted. */
export async function deleteRunVideo(
	runTestId: string,
	dir: string = RUN_VIDEO_DIR,
): Promise<void> {
	await rm(runVideoPath(runTestId, dir), { force: true }).catch(() => undefined);
}

/** The video's path when it can be played: the case's recording is ready and the file exists. */
export function readyVideoPath(runTestId: string, status: string | undefined): string | null {
	const path = runVideoPath(runTestId);
	return status === "ready" && existsSync(path) ? path : null;
}

export type CaseRecordingOptions = {
	/** Record this case. When false the device is never touched. */
	enabled: boolean;
	/** Told each state change (`recording`, then `ready` or `unavailable`). Failures are ignored. */
	onState: (state: RunRecording) => Promise<void>;
};

/**
 * Run one Test Case with a recording around it when `enabled`. Recording is evidence only:
 * a Lane that cannot record, or a sink that fails, never changes how the case runs, and the
 * recording is finalized even when the case throws.
 */
export async function recordCase<T>(
	session: DeviceSession,
	path: string,
	options: CaseRecordingOptions,
	run: () => Promise<T>,
): Promise<T> {
	if (!options.enabled) return run();
	const report = (state: RunRecording) => options.onState(state).catch(() => undefined);

	const started = await startRunRecording(session, path);
	if ("unavailable" in started) {
		await report({ status: "unavailable", note: started.unavailable });
		return run();
	}
	await report({ status: "recording" });
	try {
		return await run();
	} finally {
		const outcome = await started.stop();
		await report(outcome.status === "ready" ? { status: "ready" } : outcome);
	}
}
