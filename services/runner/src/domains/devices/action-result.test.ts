import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionRequest, ActionResponse } from "@yoqa/runner-client";
import { actAndSettle, actionMarks, performActionWithScreenshot } from "./action-result";
import { decodePng, encodeRgbaPng } from "./png";
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

describe("actAndSettle", () => {
	/** A device whose `captureFrame` serves `frames` in order (the last one stays). */
	function device(frames: Array<{ base64: string; capturedAt?: number; frozen?: boolean }>) {
		let captures = 0;
		const session = {
			captureFrame: async () => ({
				mime: "image/png" as const,
				...(frames[Math.min(captures++, frames.length - 1)] ?? { base64: "" }),
			}),
		} as unknown as DeviceSession;
		return { session, captures: () => captures };
	}
	const performed: ActionRequest[] = [];
	const perform = async (_s: DeviceSession, body: ActionRequest): Promise<ActionResponse> => {
		performed.push(body);
		return { ok: true, kind: body.kind };
	};
	const tap: ActionRequest = { kind: "tap", x: 500, y: 500 };
	const policy = { capMs: 1500, pollMs: 80, stableWindowMs: 160 };

	test("performs the Action, then settles once the same frame holds for the stable window", async () => {
		const { session, captures } = device(
			["a", "b", "b", "b", "never"].map((base64) => ({ base64 })),
		);
		const clock = fakeClock();
		const { response, result } = await actAndSettle(session, tap, {
			perform,
			clock,
			policy,
			previousFrame: "a",
		});
		expect(response).toEqual({ ok: true, kind: "tap" });
		expect(performed.at(-1)).toEqual(tap);
		expect(result).toMatchObject({ base64: "b", settled: true, waitedMs: 240, changed: true });
		expect(captures()).toBe(4);
	});

	test("a static screen settles in the stable window, well under the old fixed 800 ms", async () => {
		const { session } = device([{ base64: "same" }]);
		const { result } = await actAndSettle(session, tap, {
			perform,
			clock: fakeClock(),
			policy,
			previousFrame: "same",
		});
		expect(result.settled).toBe(true);
		expect(result.waitedMs).toBeLessThan(800);
		expect(result.changed).toBe(false);
	});

	test("a changing frame resets the stable window", async () => {
		const { session, captures } = device(["a", "a", "b", "b", "b"].map((base64) => ({ base64 })));
		const { result } = await actAndSettle(session, tap, { perform, clock: fakeClock(), policy });
		expect(result).toMatchObject({ base64: "b", settled: true });
		expect(captures()).toBe(5);
	});

	test("a screen that never settles stops at the cap with its latest frame, and claims no change", async () => {
		let n = 0;
		const session = {
			captureFrame: async () => ({ base64: `frame-${n++}`, mime: "image/png" as const }),
		} as unknown as DeviceSession;
		const { result } = await actAndSettle(session, tap, {
			perform,
			clock: fakeClock(),
			policy: { ...policy, capMs: 1000 },
			previousFrame: "before",
		});
		expect(result.settled).toBe(false);
		expect(result.waitedMs).toBe(1000);
		expect(result.base64).toBe(`frame-${n - 1}`);
		expect(result.changed).toBeNull();
	});

	test("a frame served again from the same background capture is not evidence of stability", async () => {
		// One slow capture is read four times; only the next capture of the same image proves it held.
		const { session, captures } = device(
			[0, 0, 0, 0, 170].map((capturedAt) => ({ base64: "a", capturedAt })),
		);
		const { result } = await actAndSettle(session, tap, { perform, clock: fakeClock(), policy });
		expect(result.settled).toBe(true);
		expect(captures()).toBe(5);
	});

	test("a zero cap takes one frame and does not claim it settled", async () => {
		const { session, captures } = device([{ base64: "f0" }, { base64: "f1" }]);
		const { result } = await actAndSettle(session, tap, {
			perform,
			clock: fakeClock(),
			policy: { capMs: 0 },
			previousFrame: "f0",
		});
		expect(result).toMatchObject({ settled: false, changed: null });
		expect(captures()).toBe(1);
	});

	test("a frozen frame settles at once and claims no change", async () => {
		const { session, captures } = device([{ base64: "dialog", frozen: true }]);
		const { result } = await actAndSettle(session, tap, {
			perform,
			clock: fakeClock(),
			policy,
			previousFrame: "before",
		});
		expect(result).toMatchObject({ settled: true, frozen: true, changed: null });
		expect(captures()).toBe(1);
	});

	test("judges change against this session's last Result screenshot when no previous frame is given", async () => {
		const { session } = device([{ base64: "same" }]);
		const first = await actAndSettle(session, tap, { perform, clock: fakeClock(), policy });
		const second = await actAndSettle(session, tap, { perform, clock: fakeClock(), policy });
		expect(first.result.changed).toBeNull();
		expect(second.result.changed).toBe(false);
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

	test("the first Action has changed=null because there is no previous Result fingerprint", async () => {
		const same = solidPng(16, 16, 40);
		const result = await performActionWithScreenshot(
			session([same, same, same]),
			{ kind: "tap", x: 100, y: 100, screenshot: true },
			{ perform, clock: fakeClock(), dir },
		);
		expect(result.screenshot?.changed).toBeNull();
		expect(result.phases?.captureMs).toBe(0);
		expect(result.phases?.settleMs).toBeGreaterThan(0);
	});

	test("reports changed=true from the previous Result fingerprint, including an out-of-band change", async () => {
		const before = solidPng(40, 40, 10);
		const after = solidPng(40, 40, 200);
		const result = await performActionWithScreenshot(
			session([after, after, after]),
			{ kind: "tap", x: 500, y: 500, screenshot: true },
			{ perform, clock: fakeClock(), dir, previousFrame: before },
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
			{ perform, clock: fakeClock(), dir, previousFrame: same },
		);
		expect(result.screenshot?.settled).toBe(true);
		expect(result.screenshot?.changed).toBe(false);
		expect(result.phases?.actionMs).toBeGreaterThanOrEqual(0);
		expect(result.phases?.captureMs).toBe(0);
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

	test("hands the caller an Agent image and keeps the raw Result screenshot", async () => {
		const same = solidPng(40, 40, 90);
		const result = await performActionWithScreenshot(
			session([same, same, same]),
			{ kind: "tap", x: 100, y: 100, screenshot: true },
			{
				perform,
				clock: fakeClock(),
				dir,
				prepareImage: async () => ({
					base64: solidPng(8, 8, 1),
					mediaType: "image/png",
					downscaled: true,
				}),
			},
		);
		expect(result.screenshot?.rawPath).toBeTruthy();
		expect(result.screenshot?.path).not.toBe(result.screenshot?.rawPath);
		expect(result.screenshot && existsSync(result.screenshot.path)).toBe(true);
		expect(result.screenshot?.rawPath && existsSync(result.screenshot.rawPath)).toBe(true);
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
