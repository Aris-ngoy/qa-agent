import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ActiveDeviceResponse, ConnectDeviceRequest } from "@yoqa/runner-client";
import { buildProgram } from "./program";

/** A runner that connects whatever it is asked to, and records each connect request. */
function fakeRunner() {
	const connects: ConnectDeviceRequest[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: async (request) => {
			if (request.method === "POST" && new URL(request.url).pathname === "/devices/connect") {
				const body = (await request.json()) as ConnectDeviceRequest;
				connects.push(body);
				const active: ActiveDeviceResponse = {
					deviceId: body.deviceId,
					platform: body.platform,
					connectedAt: 1,
					lane: "direct",
					...(body.platform === "web" ? { viewport: body.viewport ?? "desktop" } : {}),
				};
				return Response.json(active);
			}
			return Response.json({ error: "not found" }, { status: 404 });
		},
	});
	return { connects, url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

describe("yoqa devices connect --viewport", () => {
	const runner = fakeRunner();
	const autostart = process.env.YOQA_NO_AUTOSTART;
	// Restored as 0 when unset: Bun keeps a failure code if `exitCode` is set back to undefined.
	const exitCode = process.exitCode ?? 0;
	const log = console.log;
	const error = console.error;
	let printed: string[] = [];

	beforeAll(() => {
		process.env.YOQA_NO_AUTOSTART = "1";
		console.log = (...args: unknown[]) => printed.push(args.join(" "));
		console.error = (...args: unknown[]) => printed.push(args.join(" "));
	});

	afterAll(() => {
		runner.stop();
		console.log = log;
		console.error = error;
		process.exitCode = exitCode;
		if (autostart === undefined) Reflect.deleteProperty(process.env, "YOQA_NO_AUTOSTART");
		else process.env.YOQA_NO_AUTOSTART = autostart;
	});

	async function yoqa(...args: string[]): Promise<string> {
		printed = [];
		await buildProgram().parseAsync(["bun", "yoqa", ...args, "--base-url", runner.url]);
		return printed.join("\n");
	}

	test("connects an installed browser at the preset it names, and prints it", async () => {
		const out = await yoqa("devices", "connect", "web-chrome", "--viewport", "mobile");
		expect(runner.connects.at(-1)).toEqual({
			deviceId: "web-chrome",
			platform: "web",
			viewport: "mobile",
		});
		expect(out).toContain("viewport mobile (390×844)");
	});

	test("attaches a Chromium by its port at a preset too", async () => {
		await yoqa("devices", "connect", "chromium-cdp-9222", "--viewport", "MOBILE");
		expect(runner.connects.at(-1)).toMatchObject({
			deviceId: "chromium-cdp-9222",
			viewport: "mobile",
		});
	});

	test("with no --viewport the runner picks desktop, and the CLI says so", async () => {
		const out = await yoqa("devices", "connect", "web-edge");
		expect(runner.connects.at(-1)).not.toHaveProperty("viewport");
		expect(out).toContain("viewport desktop (1280×800)");
	});

	test("a preset that is not one fails before anything is connected", async () => {
		const before = runner.connects.length;
		const out = await yoqa("devices", "connect", "web-chrome", "--viewport", "tv");
		expect(out).toContain("--viewport must be desktop or mobile");
		expect(runner.connects).toHaveLength(before);
		process.exitCode = 0;
	});

	test("a phone takes no --viewport", async () => {
		const before = runner.connects.length;
		const out = await yoqa(
			"devices",
			"connect",
			"emulator-5554",
			"--platform",
			"android",
			"--viewport",
			"mobile",
		);
		expect(out).toContain("--viewport is for web devices");
		expect(runner.connects).toHaveLength(before);
		process.exitCode = 0;
	});
});
