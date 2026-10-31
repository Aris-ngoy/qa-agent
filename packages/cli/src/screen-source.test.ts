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

	async function yoqa(...args: string[]): Promise<string[]> {
		printed = [];
		await buildProgram().parseAsync(["bun", "yoqa", ...args, "--base-url", runner.url]);
		return printed;
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
});
