import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { DeviceSession } from "../devices/lane";
import { recordCase, runVideoPath, startRunRecording } from "./run-recording";

function sessionWith(startRecording?: DeviceSession["startRecording"]): DeviceSession {
	return { lane: "direct", startRecording } as unknown as DeviceSession;
}

describe("startRunRecording", () => {
	test("reports a Lane that cannot record as unavailable instead of throwing", async () => {
		const result = await startRunRecording(sessionWith(undefined), "/tmp/x.mp4");
		expect(result).toEqual({ unavailable: "The direct lane cannot record video" });
	});

	test("tells the user to install ffmpeg when Appium cannot find it", async () => {
		const result = await startRunRecording(
			sessionWith(async () => {
				throw new Error(
					"WebDriverError: 'ffmpeg' binary is not found in PATH. Install it using 'brew install ffmpeg'.",
				);
			}),
			"/tmp/x.mp4",
		);
		expect(result).toEqual({
			unavailable:
				"Recording on this device needs ffmpeg. Install it with `brew install ffmpeg`, then restart Yoqa.",
		});
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

describe("recordCase", () => {
	function recorder() {
		const states: Array<{ status: string; note?: string }> = [];
		return {
			states,
			onState: async (state: { status: string; note?: string }) => void states.push(state),
		};
	}

	test("does not touch the device when the case does not need a video", async () => {
		let started = false;
		const { states, onState } = recorder();
		const result = await recordCase(
			sessionWith(async () => {
				started = true;
				return { stop: async () => undefined };
			}),
			"/tmp/never.mp4",
			{ enabled: false, onState },
			async () => "ran",
		);
		expect(result).toBe("ran");
		expect(started).toBe(false);
		expect(states).toEqual([]);
	});

	test("records around the case and ends ready", async () => {
		const dir = await mkdtemp(`${tmpdir()}/rec-`);
		const path = runVideoPath("rtest_1", dir);
		const { states, onState } = recorder();
		const result = await recordCase(
			sessionWith(async (dest) => ({ stop: async () => void (await writeFile(dest, "mp4")) })),
			path,
			{ enabled: true, onState },
			async () => "ran",
		);
		expect(result).toBe("ran");
		expect(states).toEqual([{ status: "recording" }, { status: "ready" }]);
	});

	test("runs the case anyway and reports why when the Lane cannot record", async () => {
		const { states, onState } = recorder();
		const result = await recordCase(
			sessionWith(undefined),
			"/tmp/x.mp4",
			{ enabled: true, onState },
			async () => "ran",
		);
		expect(result).toBe("ran");
		expect(states).toEqual([
			{ status: "unavailable", note: "The direct lane cannot record video" },
		]);
	});

	test("still stops the recording when the case throws", async () => {
		const dir = await mkdtemp(`${tmpdir()}/rec-`);
		const { states, onState } = recorder();
		const run = recordCase(
			sessionWith(async (dest) => ({ stop: async () => void (await writeFile(dest, "mp4")) })),
			runVideoPath("rtest_2", dir),
			{ enabled: true, onState },
			async () => {
				throw new Error("case blew up");
			},
		);
		await expect(run).rejects.toThrow("case blew up");
		expect(states).toEqual([{ status: "recording" }, { status: "ready" }]);
	});

	test("a failing state sink never fails the case", async () => {
		const result = await recordCase(
			sessionWith(undefined),
			"/tmp/x.mp4",
			{
				enabled: true,
				onState: async () => {
					throw new Error("db down");
				},
			},
			async () => "ran",
		);
		expect(result).toBe("ran");
	});
});
