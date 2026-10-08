import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { DeviceSession } from "../devices/lane";
import { runVideoPath, startRunRecording } from "./run-recording";

function sessionWith(startRecording?: DeviceSession["startRecording"]): DeviceSession {
	return { lane: "direct", startRecording } as unknown as DeviceSession;
}

describe("startRunRecording", () => {
	test("reports a Lane that cannot record as unavailable instead of throwing", async () => {
		const result = await startRunRecording(sessionWith(undefined), "/tmp/x.mp4");
		expect(result).toEqual({ unavailable: "The direct lane cannot record video" });
	});

	test("reports a failed start as unavailable", async () => {
		const result = await startRunRecording(
			sessionWith(async () => {
				throw new Error("no display");
			}),
			"/tmp/x.mp4",
		);
		expect(result).toEqual({ unavailable: "Could not start recording: no display" });
	});

	test("is ready once the file exists after stop", async () => {
		const dir = await mkdtemp(`${tmpdir()}/rec-`);
		const path = runVideoPath("run_1", dir);
		const result = await startRunRecording(
			sessionWith(async (dest) => ({ stop: async () => void (await writeFile(dest, "mp4")) })),
			path,
		);
		if ("unavailable" in result) throw new Error("expected a recording");
		expect(await result.stop()).toEqual({ status: "ready" });
	});

	test("is unavailable when stop leaves no file", async () => {
		const dir = await mkdtemp(`${tmpdir()}/rec-`);
		const result = await startRunRecording(
			sessionWith(async () => ({ stop: async () => undefined })),
			runVideoPath("run_2", dir),
		);
		if ("unavailable" in result) throw new Error("expected a recording");
		expect(await result.stop()).toEqual({
			status: "unavailable",
			note: "The device produced no video file",
		});
	});

	test("is unavailable when stop throws", async () => {
		const result = await startRunRecording(
			sessionWith(async () => ({
				stop: async () => {
					throw new Error("pull failed");
				},
			})),
			"/tmp/y.mp4",
		);
		if ("unavailable" in result) throw new Error("expected a recording");
		expect(await result.stop()).toEqual({
			status: "unavailable",
			note: "Could not save recording: pull failed",
		});
	});
});
