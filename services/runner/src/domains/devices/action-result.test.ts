import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionRequest, ActionResponse } from "@yoqa/runner-client";
import { decodePng, encodeRgbaPng } from "../runs/coord-grid";
import { actionMarks, performActionWithScreenshot, settleScreen } from "./action-result";
import type { DeviceSession } from "./session";

function fakeClock() {
	let now = 0;
	return {
		now: () => now,
		sleep: async (ms: number) => {
			now += ms;
		},
	};
}

function solidPng(width: number, height: number, shade: number): string {
	const rgba = new Uint8Array(width * height * 4);
	for (let i = 0; i < rgba.length; i += 4) {
		rgba[i] = shade;
		rgba[i + 1] = shade;
		rgba[i + 2] = shade;
		rgba[i + 3] = 255;
	}
	return encodeRgbaPng({ width, height, rgba }).toString("base64");
}

describe("settleScreen", () => {
	test("settles once two consecutive frames match", async () => {
		const frames = ["a", "b", "b", "never"];
		let call = 0;
		const result = await settleScreen(async () => ({ base64: frames[call++] ?? "end" }), {
			clock: fakeClock(),
		});
		expect(result.settled).toBe(true);
		expect(result.base64).toBe("b");
		expect(call).toBe(3);
	});

	test("an animating screen hits the cap and returns the latest frame", async () => {
		let call = 0;
		const result = await settleScreen(async () => ({ base64: `frame-${call++}` }), {
			capMs: 1000,
			pollMs: 250,
			clock: fakeClock(),
		});
		expect(result.settled).toBe(false);
		expect(result.waitedMs).toBeGreaterThanOrEqual(1000);
		expect(result.base64).toBe(`frame-${call - 1}`);
	});

	test("a zero cap takes one frame and does not claim it settled", async () => {
		let call = 0;
		const result = await settleScreen(async () => ({ base64: `f${call++}` }), {
			capMs: 0,
			clock: fakeClock(),
		});
		expect(result.settled).toBe(false);
		expect(call).toBe(1);
	});
});

describe("actionMarks", () => {
	test("a tap marks its point; a locator tap marks where it resolved", () => {
		expect(actionMarks({ kind: "tap", x: 10, y: 20 }, undefined)).toEqual([
			{ kind: "tap", x: 10, y: 20 },
		]);
		expect(actionMarks({ kind: "tap", label: "Allow" }, { x: 600, y: 925 })).toEqual([
			{ kind: "tap", x: 600, y: 925 },
		]);
	});

	test("a swipe or drag marks its path; app lifecycle marks nothing", () => {
		expect(actionMarks({ kind: "swipe", x: 1, y: 2, x2: 3, y2: 4 }, undefined)).toEqual([
			{ kind: "path", x: 1, y: 2, x2: 3, y2: 4 },
		]);
		expect(actionMarks({ kind: "activate-app", appId: "com.x" }, undefined)).toEqual([]);
	});
});

describe("performActionWithScreenshot", () => {
	const dir = mkdtempSync(join(tmpdir(), "yoqa-action-result-"));
	function session(frames: string[]): DeviceSession {
		let call = 0;
		return {
			captureFrame: async () => ({
				base64: frames[Math.min(call++, frames.length - 1)] ?? "",
				mime: "image/png" as const,
			}),
		} as unknown as DeviceSession;
	}
	const perform = async (_s: DeviceSession, body: ActionRequest): Promise<ActionResponse> => ({
		ok: true,
		kind: body.kind,
	});

	test("reports changed=true and writes raw plus marked images when the screen changed", async () => {
		const before = solidPng(40, 40, 10);
		const after = solidPng(40, 40, 200);
		const result = await performActionWithScreenshot(
			session([before, after, after]),
			{ kind: "tap", x: 500, y: 500, screenshot: true },
			{ perform, clock: fakeClock(), dir },
		);
		const shot = result.screenshot;
		expect(shot?.settled).toBe(true);
		expect(shot?.changed).toBe(true);
		expect(shot && existsSync(shot.path)).toBe(true);
		expect(shot?.annotatedPath && existsSync(shot.annotatedPath)).toBe(true);
		const marked = decodePng(Buffer.from(await Bun.file(shot?.annotatedPath ?? "").arrayBuffer()));
		const centre = (20 * 40 + 20) * 4;
		expect(marked?.rgba[centre]).toBe(255);
		expect(marked?.rgba[centre + 1]).toBe(32);
	});

	test("reports changed=false when a tap leaves a settled screen unchanged", async () => {
		const same = solidPng(40, 40, 90);
		const result = await performActionWithScreenshot(
			session([same, same, same]),
			{ kind: "tap", x: 100, y: 100, screenshot: true },
			{ perform, clock: fakeClock(), dir },
		);
		expect(result.screenshot?.settled).toBe(true);
		expect(result.screenshot?.changed).toBe(false);
	});

	test("changed is null when the screen never settles", async () => {
		let n = 0;
		const animating = {
			captureFrame: async () => ({ base64: solidPng(8, 8, n++ % 250), mime: "image/png" as const }),
		} as unknown as DeviceSession;
		const result = await performActionWithScreenshot(
			animating,
			{ kind: "tap", x: 100, y: 100, screenshot: true, settleMs: 500 },
			{ perform, clock: fakeClock(), dir },
		);
		expect(result.screenshot?.settled).toBe(false);
		expect(result.screenshot?.changed).toBeNull();
	});

	test("an action with no point has no marked copy", async () => {
		const same = solidPng(8, 8, 90);
		const result = await performActionWithScreenshot(
			session([same, same, same]),
			{ kind: "activate-app", appId: "com.x", screenshot: true },
			{ perform, clock: fakeClock(), dir },
		);
		expect(result.screenshot?.annotatedPath).toBeUndefined();
		expect(result.screenshot?.path).toBeTruthy();
	});
});
