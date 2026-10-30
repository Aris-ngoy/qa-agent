import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type {
	ActiveDeviceResponse,
	CatalogApp,
	ConnectDeviceRequest,
	Device,
} from "@yoqa/runner-client";
import { buildProgram } from "./program";

const APP: CatalogApp = {
	id: "app_1",
	name: "Shop",
	prefix: "SHOP",
	context: "",
	knowledge: "",
	iosBundleId: "",
	iosAppStoreId: "",
	androidApplicationId: "",
	webUrl: "https://shop.example.com",
	capabilities: [],
	createdAt: 1,
	updatedAt: 1,
};

const WARNING = "Yoqa will drive your Everyday browser, signed in as you.";

/** How long the fake browser takes to answer the Allow prompt: past the CLI's Allow line. */
const ALLOW_MS = 400;

const EVERYDAY_DEVICES: Device[] = [
	{
		id: "web-chrome-everyday",
		name: "Google Chrome (everyday)",
		osVersion: "everyday browser",
		platform: "web",
		kind: "browser",
		state: "ready",
	},
	{
		id: "web-edge-everyday",
		name: "Microsoft Edge (everyday)",
		osVersion: "everyday browser",
		platform: "web",
		kind: "browser",
		state: "remote debugging off",
	},
];

/**
 * A runner whose Chrome allows, Edge denies, Brave never answers and Dia waits until the
 * client hangs up. It keeps each App's warning acceptance as the real one does, `default`
 * already accepted, and records each connect and each connect the client cancelled.
 */
function fakeRunner() {
	const connects: ConnectDeviceRequest[] = [];
	const cancelled: string[] = [];
	const accepted = new Set(["default"]);
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		idleTimeout: 0,
		fetch: async (request) => {
			const url = new URL(request.url);
			if (request.method === "GET" && url.pathname === "/apps") {
				return Response.json({ apps: [APP] });
			}
			if (request.method === "GET" && url.pathname === "/devices") {
				return Response.json({ platform: "web", devices: EVERYDAY_DEVICES });
			}
			if (request.method === "POST" && url.pathname === "/devices/connect") {
				const body = (await request.json()) as ConnectDeviceRequest;
				connects.push(body);
				const appId = body.appId ?? "default";
				if (body.acceptEverydayWarning) accepted.add(appId);
				if (!accepted.has(appId)) {
					return Response.json(
						{
							error: "Everyday browser warning not accepted",
							code: "EVERYDAY_WARNING_REQUIRED",
							appId,
							warning: WARNING,
						},
						{ status: 428 },
					);
				}
				if (body.deviceId === "web-dia-everyday") {
					await new Promise<void>((resolve) =>
						request.signal.addEventListener("abort", () => resolve()),
					);
					cancelled.push(body.deviceId);
					return new Response(null, { status: 499 });
				}
				await Bun.sleep(ALLOW_MS);
				if (body.deviceId === "web-edge-everyday") {
					return Response.json(
						{
							error: "Failed to connect device",
							detail: "Remote debugging was denied in Microsoft Edge",
						},
						{ status: 500 },
					);
				}
				if (body.deviceId === "web-brave-everyday") {
					return Response.json(
						{
							error: "Failed to connect device",
							detail: "Brave Browser did not answer the Allow prompt within 60 s",
						},
						{ status: 500 },
					);
				}
				const active: ActiveDeviceResponse = {
					deviceId: body.deviceId,
					platform: "web",
					connectedAt: 1,
					lane: "direct",
					viewport: "desktop",
					browserProfileName: "Work",
				};
				return Response.json(active);
			}
			return Response.json({ error: "not found" }, { status: 404 });
		},
	});
	return {
		connects,
		cancelled,
		url: `http://127.0.0.1:${server.port}`,
		stop: () => server.stop(true),
	};
}

describe("yoqa devices on the Everyday browser", () => {
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
		process.exitCode = 0;
		await buildProgram().parseAsync(["bun", "yoqa", ...args, "--base-url", runner.url]);
		return printed.join("\n");
	}

	test("devices web lists a ready one, and an off one with the toggle to turn on", async () => {
		const out = await yoqa("devices", "web");
		expect(out).toContain("Google Chrome (everyday) — everyday browser [ready]");
		expect(out).toContain("Microsoft Edge (everyday) — everyday browser [remote debugging off]");
		const lines = out.split("\n");
		const hints = lines.filter((line) => line.includes("chrome://inspect/#remote-debugging"));
		expect(hints).toHaveLength(1);
		expect(lines.indexOf(hints[0] ?? "")).toBeGreaterThan(
			lines.findIndex((line) => line.includes("web-edge-everyday")),
		);
	});

	test("a connect says to click Allow while it waits, then names the profile", async () => {
		const out = await yoqa("devices", "connect", "web-chrome-everyday");
		expect(out).toContain("Click Allow in Google Chrome");
		expect(out.indexOf("Click Allow")).toBeLessThan(out.indexOf("connected"));
		expect(out).toContain("connected web web-chrome-everyday lane direct");
		expect(out).toContain("profile Work");
		expect(process.exitCode).toBe(0);
	});

	test("a Deny prints the runner's message and exits non-zero", async () => {
		const out = await yoqa("devices", "connect", "web-edge-everyday");
		expect(out).toContain("Click Allow in Microsoft Edge");
		expect(out).toContain("Remote debugging was denied in Microsoft Edge");
		expect(out).not.toContain("Is the runner up?");
		expect(process.exitCode).toBe(1);
	});

	test("no answer to the prompt prints the timeout and exits non-zero", async () => {
		const out = await yoqa("devices", "connect", "web-brave-everyday");
		expect(out).toContain("Brave Browser did not answer the Allow prompt within 60 s");
		expect(process.exitCode).toBe(1);
	});

	test("Ctrl-C cancels the wait for Allow", async () => {
		const done = yoqa("devices", "connect", "web-dia-everyday");
		while (!runner.connects.some((connect) => connect.deviceId === "web-dia-everyday")) {
			await Bun.sleep(10);
		}
		process.emit("SIGINT");
		const out = await done;
		expect(out).toContain("cancelled");
		expect(process.exitCode).toBe(130);
		while (runner.cancelled.length === 0) await Bun.sleep(10);
		expect(runner.cancelled).toEqual(["web-dia-everyday"]);
		expect(process.listenerCount("SIGINT")).toBe(0);
	});

	test("first use for an App refuses with the warning, --yes accepts it once", async () => {
		const refused = await yoqa("devices", "connect", "web-chrome-everyday", "--app", "shop");
		expect(runner.connects.at(-1)).toEqual({
			deviceId: "web-chrome-everyday",
			platform: "web",
			appId: "app_1",
		});
		expect(refused).toContain(WARNING);
		expect(refused).toContain("--yes");
		expect(refused).not.toContain("Click Allow");
		expect(process.exitCode).toBe(1);

		const accepted = await yoqa(
			"devices",
			"connect",
			"web-chrome-everyday",
			"--app",
			"shop",
			"--yes",
		);
		expect(runner.connects.at(-1)).toEqual({
			deviceId: "web-chrome-everyday",
			platform: "web",
			appId: "app_1",
			acceptEverydayWarning: true,
		});
		expect(accepted).toContain("profile Work");
		expect(process.exitCode).toBe(0);

		const again = await yoqa("devices", "connect", "web-chrome-everyday", "--app", "SHOP");
		expect(runner.connects.at(-1)).not.toHaveProperty("acceptEverydayWarning");
		expect(again).toContain("profile Work");
		expect(process.exitCode).toBe(0);
	});

	test("an App the catalog does not have fails before anything is connected", async () => {
		const before = runner.connects.length;
		const out = await yoqa("devices", "connect", "web-chrome-everyday", "--app", "nope");
		expect(out).toContain("App not found: nope");
		expect(runner.connects).toHaveLength(before);
	});
});
