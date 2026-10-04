import { describe, expect, test } from "bun:test";
import { assertBatchable, performActionBatch } from "./batch";
import { ActionValidationError } from "./interaction";
import type { DeviceSession } from "./session";

describe("assertBatchable", () => {
	test("rejects a description-grounded step before anything runs", () => {
		expect(() =>
			assertBatchable([
				{ kind: "tap", x: 10, y: 20 },
				{ kind: "tap", description: "blue login" },
			]),
		).toThrow(ActionValidationError);
	});

	test("allows coordinate, id, and label steps", () => {
		expect(() =>
			assertBatchable([
				{ kind: "tap", x: 10, y: 20 },
				{ kind: "tap", id: "submit" },
				{ kind: "tap", label: "Allow" },
			]),
		).not.toThrow();
	});
});

describe("performActionBatch", () => {
	test("runs steps and Settles only on the last one", async () => {
		const performed: string[] = [];
		const session = {
			screenshot: async () => ({ path: "/tmp/x.png", base64: "aa" }),
		} as unknown as DeviceSession;
		const result = await performActionBatch(
			session,
			{
				steps: [
					{ kind: "tap", x: 1, y: 2 },
					{ kind: "tap", x: 3, y: 4 },
				],
			},
			{
				perform: async (_s, body) => {
					performed.push(`act:${body.x}`);
					return { ok: true as const, kind: body.kind };
				},
				performWithScreenshot: async (_s, body) => {
					performed.push(`settle:${body.x}`);
					return {
						ok: true as const,
						kind: body.kind,
						screenshot: { path: "/tmp/r.png", settled: true, waitedMs: 10, changed: true },
					};
				},
			},
		);
		expect(performed).toEqual(["act:1", "settle:3"]);
		expect(result.ok).toBe(true);
		expect(result.completed).toBe(2);
		expect(result.screenshot?.path).toBe("/tmp/r.png");
	});

	test("stops at the first failed step and returns that index", async () => {
		const session = {
			screenshot: async () => ({ path: "/tmp/fail.png", base64: "aa" }),
		} as unknown as DeviceSession;
		const result = await performActionBatch(
			session,
			{
				steps: [
					{ kind: "tap", x: 1, y: 1 },
					{ kind: "tap", x: 2, y: 2 },
				],
			},
			{
				perform: async (_s, body) => {
					if (body.x === 1) throw new Error("missed");
					return { ok: true as const, kind: body.kind };
				},
			},
		);
		expect(result.ok).toBe(false);
		expect(result.failedIndex).toBe(0);
		expect(result.completed).toBe(0);
		expect(result.screenshot?.path).toBe("/tmp/fail.png");
		expect(result.error).toBe("missed");
	});
});
