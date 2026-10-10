import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ScreenRecording } from "./lane";

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

/** One image of the screen and when it was taken, in milliseconds on any clock the source keeps. */
export type TimedFrame = { bytes: Uint8Array; at: number; ext: "png" | "jpg" };

/**
 * Where a recording's frames come from. `pull` returns the frames that arrived since the last
 * pull (possibly none); a failure is a stutter, not a failed recording.
 */
export type FrameSource = {
	/** Wait this long between pulls. */
	intervalMs: number;
	start?: () => Promise<void>;
	pull: () => Promise<TimedFrame[]>;
	/** Called once the last pull is done. Never throws into the recording. */
	stop?: () => Promise<void>;
};

/** A screen that only answers screenshots: one grab per pull, timed on the Mac. */
export function screenshotSource(capture: () => Promise<string>): FrameSource {
	return {
		intervalMs: 250,
		pull: async () => [
			{
				bytes: Uint8Array.from(Buffer.from(await capture(), "base64")),
				at: performance.now(),
				ext: "png",
			},
		],
	};
}

/**
 * Record a screen into an mp4 that plays in real time: pull frames from `source` one batch after
 * another, and on `stop` encode them, each held until the next one was taken. Smooth as the
 * source is fast. Needs `ffmpeg` on the host.
 */
export async function recordFrames(
	source: FrameSource,
	path: string,
	deps: FrameRecorderDeps = realDeps,
): Promise<ScreenRecording> {
	const ffmpeg = deps.findFfmpeg();
	if (!ffmpeg) throw new Error("ffmpeg not found on PATH");
	await mkdir(dirname(path), { recursive: true });
	const dir = await mkdtemp(join(tmpdir(), "yoqa-frames-"));
	try {
		await source.start?.();
	} catch (error) {
		await rm(dir, { recursive: true, force: true }).catch(() => undefined);
		throw error;
	}

	const frames: Array<{ file: string; at: number }> = [];
	let running = true;
	const pullOnce = async () => {
		try {
			for (const frame of await source.pull()) {
				const file = join(dir, `${String(frames.length).padStart(6, "0")}.${frame.ext}`);
				await Bun.write(file, frame.bytes);
				frames.push({ file, at: frame.at });
			}
		} catch {
			// A missed pull is a stutter, not a failed recording.
		}
	};
	const loop = (async () => {
		while (running) {
			await pullOnce();
			if (running) await Bun.sleep(source.intervalMs);
		}
	})();

	return {
		stop: async () => {
			running = false;
			await loop;
			try {
				await pullOnce();
				await source.stop?.().catch(() => undefined);
				if (frames.length === 0) throw new Error("the phone returned no frames");
				const lines = ["ffconcat version 1.0"];
				for (const [i, frame] of frames.entries()) {
					const next = frames[i + 1];
					const seconds = next ? (next.at - frame.at) / 1000 : LAST_FRAME_HOLD_S;
					lines.push(`file '${frame.file}'`, `duration ${Math.max(seconds, 0.001).toFixed(3)}`);
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
