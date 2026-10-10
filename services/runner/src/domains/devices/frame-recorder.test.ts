import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FrameRecorderDeps, recordFrames } from "./frame-recorder";

const PNG = Buffer.from("png-bytes").toString("base64");

async function fixture(encode?: FrameRecorderDeps["encode"]) {
	const out = join(await mkdtemp(join(tmpdir(), "yoqa-rec-test-")), "case.mp4");
	const lists: string[] = [];
	const frameFiles: string[] = [];
	const deps: FrameRecorderDeps = {
		findFfmpeg: () => "/bin/ffmpeg",
		encode:
			encode ??
			(async (_ffmpeg, list, path) => {
				lists.push(await readFile(list, "utf8"));
				for (const m of lists[0]?.matchAll(/file '(.+)'/g) ?? []) {
					frameFiles.push(m[1] ?? "");
					expect(existsSync(m[1] ?? "")).toBe(true);
				}
				await Bun.write(path, "mp4");
			}),
	};
	return { out, lists, frameFiles, deps };
}

describe("recordFrames", () => {
	test("encodes the grabbed frames with their real durations, then cleans up", async () => {
		const { out, lists, frameFiles, deps } = await fixture();
		const recording = await recordFrames(async () => PNG, out, deps);
		await Bun.sleep(700);
		await recording.stop();
		expect(existsSync(out)).toBe(true);
		expect(lists[0]).toStartWith("ffconcat version 1.0\nfile '");
		expect(lists[0]).toMatch(/duration \d+\.\d{3}/);
		expect(frameFiles.length).toBeGreaterThan(2);
		expect(existsSync(frameFiles[0] ?? "")).toBe(false);
	});

	test("a frame that fails to grab is skipped", async () => {
		const { out, lists, deps } = await fixture();
		let calls = 0;
		const recording = await recordFrames(
			async () => {
				calls += 1;
				if (calls === 1) throw new Error("busy");
				return PNG;
			},
			out,
			deps,
		);
		await Bun.sleep(700);
		await recording.stop();
		expect(lists[0]).toContain("file '");
	});

	test("no ffmpeg is an error the Run recorder words as an install hint", async () => {
		const { out, deps } = await fixture();
		await expect(
			recordFrames(async () => PNG, out, { ...deps, findFfmpeg: () => null }),
		).rejects.toThrow(/ffmpeg.*not found/i);
	});

	test("a phone that never answers leaves nothing to encode", async () => {
		const { out, deps } = await fixture();
		const recording = await recordFrames(
			async () => {
				throw new Error("down");
			},
			out,
			deps,
		);
		await expect(recording.stop()).rejects.toThrow("no frames");
	});

	test("an encoder failure rejects stop", async () => {
		const { out, deps } = await fixture(async () => {
			throw new Error("ffmpeg: boom");
		});
		const recording = await recordFrames(async () => PNG, out, deps);
		await Bun.sleep(300);
		await expect(recording.stop()).rejects.toThrow("boom");
	});
});
