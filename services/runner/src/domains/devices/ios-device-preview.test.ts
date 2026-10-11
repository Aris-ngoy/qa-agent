import { describe, expect, test } from "bun:test";
import { startPhonePreview } from "./ios-device-preview";
import { YoqaRunnerCommandError } from "./yoqa-runner-link";

describe("startPhonePreview", () => {
	test("serves the newest phone JPEG as an MJPEG part", async () => {
		let seq = 0;
		const preview = await startPhonePreview(async (command) => {
			if (command === "recordStart" || command === "recordStop") return {};
			const frame = {
				seq,
				jpeg: Buffer.from(`frame-${seq}`).toString("base64"),
			};
			seq += 1;
			return { running: true, frames: [frame] };
		});
		expect(preview?.stream.ready).toBe(true);
		if (!preview) throw new Error("preview did not start");

		const response = await fetch(preview.stream.upstreamUrl);
		const reader = response.body?.getReader();
		if (!reader) throw new Error("no stream body");
		const chunks: Uint8Array[] = [];
		let size = 0;
		const deadline = Date.now() + 1000;
		while (size < 40 && Date.now() < deadline) {
			const next = await reader.read();
			if (next.done || !next.value) break;
			chunks.push(next.value);
			size += next.value.byteLength;
		}
		await reader.cancel();
		await preview.stop();

		const text = Buffer.concat(chunks).toString("latin1");
		expect(response.headers.get("Content-Type")).toContain("multipart/x-mixed-replace");
		expect(text).toContain("--yoqa-frame");
		expect(text).toContain("frame-");
	});

	test("a runner without a recorder leaves the inspector on screenshot poll", async () => {
		const preview = await startPhonePreview(async () => {
			throw new YoqaRunnerCommandError("UNKNOWN_COMMAND", "no");
		});
		expect(preview).toBeNull();
	});
});
