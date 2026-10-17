import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildProgram } from "./program";

/** A runner that answers `POST /action` and records what it was asked to do. */
function fakeRunner() {
	const actions: unknown[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: async (request) => {
			const body = (await request.json()) as { kind: string };
			actions.push(body);
			return Response.json({ ok: true, kind: body.kind });
		},
	});
	return { actions, url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

async function yoqa(...args: string[]): Promise<void> {
	await buildProgram().parseAsync(["bun", "yoqa", ...args]);
}

describe("yoqa action key", () => {
	const runner = fakeRunner();
	const autostart = process.env.YOQA_NO_AUTOSTART;
	// Restored as 0 when unset: Bun keeps a failure code if `exitCode` is set back to undefined.
	const exitCode = process.exitCode ?? 0;

	beforeAll(() => {
		process.env.YOQA_NO_AUTOSTART = "1";
	});

	afterAll(() => {
		runner.stop();
		process.exitCode = exitCode;
		if (autostart === undefined) Reflect.deleteProperty(process.env, "YOQA_NO_AUTOSTART");
		else process.env.YOQA_NO_AUTOSTART = autostart;
	});

	test("presses the named key with its modifiers", async () => {
		await yoqa("action", "key", "tab", "--modifiers", "shift,Control", "--base-url", runner.url);
		expect(runner.actions.at(-1)).toEqual({
			kind: "key",
			key: "Tab",
			modifiers: ["Shift", "Control"],
		});
	});

	test("presses a key with no modifiers", async () => {
		await yoqa("action", "key", "Enter", "--base-url", runner.url);
		expect(runner.actions.at(-1)).toEqual({ kind: "key", key: "Enter" });
	});

	test("fails on a key outside the fixed set without calling the runner", async () => {
		const before = runner.actions.length;
		const errors: string[] = [];
		const original = console.error;
		console.error = (...parts: unknown[]) => {
			errors.push(parts.join(" "));
		};
		try {
			await yoqa("action", "key", "F5", "--base-url", runner.url);
		} finally {
			console.error = original;
		}
		expect(runner.actions).toHaveLength(before);
		expect(errors[0]).toContain('Unknown key "F5"');
		expect(process.exitCode).toBe(1);
		process.exitCode = exitCode;
	});
});
