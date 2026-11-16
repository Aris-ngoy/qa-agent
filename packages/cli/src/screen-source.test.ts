import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ScreenResponse } from "@yoqa/runner-client";
import { buildProgram } from "./program";

/** A runner that answers `/screen` with whatever `screen` holds. */
function fakeRunner() {
	let screen: ScreenResponse = { full: false, window: { width: 390, height: 844 }, elements: [] };
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: (request) =>
			new URL(request.url).pathname === "/screen"
				? Response.json(screen)
				: Response.json({ error: "not found" }, { status: 404 }),
	});
	return {
		serve: (next: ScreenResponse) => {
			screen = next;
		},
		url: `http://127.0.0.1:${server.port}`,
		stop: () => server.stop(true),
	};
}

const BUTTON = { type: "Button", label: "Open", x: 10, y: 20, width: 30, height: 40 };

describe("yoqa screen and the Screen's source", () => {
	const runner = fakeRunner();
	const autostart = process.env.YOQA_NO_AUTOSTART;
	const log = console.log;
	let printed: string[] = [];

	beforeAll(() => {
		process.env.YOQA_NO_AUTOSTART = "1";
		console.log = (...args: unknown[]) => printed.push(args.join(" "));
	});

	afterAll(() => {
		runner.stop();
		console.log = log;
		if (autostart === undefined) Reflect.deleteProperty(process.env, "YOQA_NO_AUTOSTART");
		else process.env.YOQA_NO_AUTOSTART = autostart;
	});

	/** Lines as a calling agent would see them: the seam writes a command's output in one call. */
	async function yoqa(...args: string[]): Promise<string[]> {
		printed = [];
		await buildProgram().parseAsync(["bun", "yoqa", ...args, "--base-url", runner.url]);
		return printed.flatMap((chunk) => chunk.split("\n"));
	}

	const screen = (source?: ScreenResponse["source"]): ScreenResponse => ({
		full: false,
		window: { width: 390, height: 844 },
		elements: [BUTTON],
		...(source ? { source } : {}),
	});

	test("leads with the app the tree was read from", async () => {
		runner.serve(screen({ kind: "target", bundleId: "com.demo" }));
		expect(await yoqa("screen")).toEqual([
			"Read from com.demo (target app)",
			"  10,  20  30x40  Open",
		]);
	});

	test("says plainly when the tree is the system's", async () => {
		runner.serve(screen({ kind: "system" }));
		expect((await yoqa("screen"))[0]).toBe("Read from the system (SpringBoard), not an app");
	});

	test("names a foreground app found without a target app", async () => {
		runner.serve(screen({ kind: "foreground", bundleId: "com.other" }));
		expect((await yoqa("screen"))[0]).toBe("Read from com.other (foreground app)");
	});

	test("prints no source line for a Lane that does not report one", async () => {
		runner.serve(screen());
		expect(await yoqa("screen")).toEqual(["  10,  20  30x40  Open"]);
	});

	test("--json carries the source", async () => {
		runner.serve(screen({ kind: "system" }));
		expect(JSON.parse((await yoqa("screen", "--json")).join("\n")).source).toEqual({
			kind: "system",
		});
	});

	/** 100 elements: more than the cap, so one read of it would flood a calling agent. */
	const denseScreen = (): ScreenResponse => ({
		full: false,
		window: { width: 390, height: 844 },
		elements: Array.from({ length: 100 }, (_, index) => ({ ...BUTTON, y: index * 10 })),
	});

	// What the cap and the options *say* is the seam's contract (agent-output.test.ts).
	// These only prove the command reaches it, and that its options arrive intact.
	test("a dense screen reaches the cap", async () => {
		runner.serve(denseScreen());

		expect(await yoqa("screen")).toHaveLength(81);
	});

	test("--limit, --json and --pretty arrive at the seam", async () => {
		runner.serve(denseScreen());

		expect(await yoqa("screen", "--limit", "3")).toHaveLength(4);
		expect(await yoqa("screen", "--json")).toHaveLength(1);
		expect((await yoqa("screen", "--pretty", "--json")).length).toBeGreaterThan(1);
	});

	test("a nonsense --limit fails the command instead of printing a stack trace", async () => {
		runner.serve(denseScreen());
		const errors: string[] = [];
		const error = console.error;
		console.error = (...args: unknown[]) => errors.push(args.join(" "));
		try {
			expect(await yoqa("screen", "--limit", "0")).toEqual([]);
		} finally {
			console.error = error;
		}

		expect(errors).toEqual([
			"yoqa screen failed: --limit must be a whole number of rows, 1 or more",
		]);
		expect(process.exitCode).toBe(1);
		process.exitCode = 0;
	});
});
