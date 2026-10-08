import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DeviceSession, ScreenRecording } from "../devices/lane";

/** Run recordings live here, one `<runId>.mp4` per Run. */
export const RUN_VIDEO_DIR = join(homedir(), ".yoqa", "runs", "videos");

export function runVideoPath(runId: string, dir: string = RUN_VIDEO_DIR): string {
	return join(dir, `${runId}.mp4`);
}

export type RecordingOutcome = { status: "ready" } | { status: "unavailable"; note: string };

export type ActiveRecording = {
	/** Finalize the file. Never throws; a failure comes back as `unavailable`. */
	stop: () => Promise<RecordingOutcome>;
};

function describe(error: unknown): string {
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
		return { unavailable: `Could not start recording: ${describe(error)}` };
	}
	return {
		stop: async () => {
			try {
				await recording.stop();
			} catch (error) {
				return { status: "unavailable", note: `Could not save recording: ${describe(error)}` };
			}
			if (!existsSync(path)) {
				return { status: "unavailable", note: "The device produced no video file" };
			}
			return { status: "ready" };
		},
	};
}

/** Best-effort removal of a Run's video; used when the Run is deleted. */
export async function deleteRunVideo(runId: string, dir: string = RUN_VIDEO_DIR): Promise<void> {
	await rm(runVideoPath(runId, dir), { force: true }).catch(() => undefined);
}
