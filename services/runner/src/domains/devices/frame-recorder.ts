import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ScreenRecording } from "./lane";

/** Gap between the end of one grab and the start of the next; the phone's grab is the real cost. */
const FRAME_GAP_MS = 250;
/** The last frame is held this long, so a one-frame recording still has a length. */
const LAST_FRAME_HOLD_S = 0.5;

export type FrameRecorderDeps = {
	/** Absolute path of `ffmpeg`, or null when the host has none. */
	findFfmpeg: () => string | null;
	/** Encode the concat `list` of frames into the mp4 at `out`. Rejects with ffmpeg's stderr. */
	encode: (ffmpeg: string, list: string, out: string) => Promise<void>;
};

async function encodeWithFfmpeg(ffmpeg: string, list: string, out: string): Promise<void> {
	const proc = Bun.spawn(
		[
			ffmpeg,
			"-y",
			"-f",
			"concat",
			"-safe",
			"0",
			"-i",
			list,
			// H.264 needs even dimensions; a phone's screen is, but never trust that.
			"-vf",
			"pad=ceil(iw/2)*2:ceil(ih/2)*2,fps=10",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			"-movflags",
			"+faststart",
			out,
		],
		{ stdout: "ignore", stderr: "pipe" },
	);
	const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
	if (exitCode !== 0) throw new Error(`ffmpeg: ${stderr.trim().split("\n").at(-1) || exitCode}`);
}

const realDeps: FrameRecorderDeps = {
	findFfmpeg: () => Bun.which("ffmpeg"),
	encode: encodeWithFfmpeg,
};

/**
 * Record a screen that offers only screenshots (a cabled iPhone's `YoqaRunner`): grab frames
 * one after another, remember when each was taken, and on `stop` encode them into an mp4 that
 * plays in real time. The video is as smooth as the phone answers screenshots, a few frames a
 * second. A frame that fails to grab is skipped. Needs `ffmpeg` on the host.
 */
export async function recordFrames(
	capture: () => Promise<string>,
	path: string,
	deps: FrameRecorderDeps = realDeps,
): Promise<ScreenRecording> {
	const ffmpeg = deps.findFfmpeg();
	if (!ffmpeg) throw new Error("ffmpeg not found on PATH");
	await mkdir(dirname(path), { recursive: true });
	const dir = await mkdtemp(join(tmpdir(), "yoqa-frames-"));

	const frames: Array<{ file: string; at: number }> = [];
	let running = true;
	const loop = (async () => {
		while (running) {
			try {
				const png = await capture();
				const file = join(dir, `${String(frames.length).padStart(6, "0")}.png`);
				await Bun.write(file, Uint8Array.from(Buffer.from(png, "base64")));
				frames.push({ file, at: performance.now() });
			} catch {
				// A missed frame is a stutter, not a failed recording.
			}
			if (running) await Bun.sleep(FRAME_GAP_MS);
		}
	})();

	return {
		stop: async () => {
			running = false;
			await loop;
			try {
				if (frames.length === 0) throw new Error("the phone returned no frames");
				const lines = ["ffconcat version 1.0"];
				for (const [i, frame] of frames.entries()) {
					const next = frames[i + 1];
					const seconds = next ? (next.at - frame.at) / 1000 : LAST_FRAME_HOLD_S;
					lines.push(`file '${frame.file}'`, `duration ${seconds.toFixed(3)}`);
				}
				// The concat demuxer ignores the last duration unless the file is repeated.
				lines.push(`file '${frames[frames.length - 1]?.file}'`);
				const list = join(dir, "frames.txt");
				await Bun.write(list, `${lines.join("\n")}\n`);
				await deps.encode(ffmpeg, list, path);
			} finally {
				await rm(dir, { recursive: true, force: true }).catch(() => undefined);
			}
		},
	};
}
