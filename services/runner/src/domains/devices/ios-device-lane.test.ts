import { afterEach, describe, expect, test } from "bun:test";
import { createConnection } from "node:net";
import { type IosDeviceDeps, createIosDeviceSession } from "./ios-device-lane";
import type { SessionOptions } from "./lane";
import { cleanPageSource } from "./screen";
import { YoqaRunnerCommandError } from "./yoqa-runner-link";

const PHONE_UDID = "00008120-000E6D813E2A601E";
const SIM_UDID = "B75001FB-B91D-4F94-80A7-3E371A641D27";
const RUNNER_PORT = 54_321;

function options(deviceId = PHONE_UDID, extra: Partial<SessionOptions> = {}): SessionOptions {
	return {
		platform: "ios",
		deviceId,
		appCaps: [],
		caseCaps: [],
		requestedLane: "direct",
		...extra,
	};
}

const servers: Array<ReturnType<typeof Bun.serve>> = [];
afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true);
});

/**
 * A cabled phone with `YoqaRunner` on it, faked at its seams: starting the runner reports
 * `RUNNER_PORT`, and the tunnel to that port reaches a real HTTP server that answers like
 * the runner (`status` ready, unless `statusFails`). `devicectl` records its commands.
 */
function fakePhone(
	mode: {
		statusFails?: boolean;
		tunnelFails?: boolean;
		/** Answers a command with this reply instead of the default. */
		replies?: Record<string, unknown>;
	} = {},
) {
	const commands: string[] = [];
	const bodies: Array<Record<string, unknown>> = [];
	const devicectl: string[][] = [];
	const tunnels: Array<{ udid: string; port: number }> = [];
	let stops = 0;
	let exit: (code: number) => void = () => undefined;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: async (request) => {
			const body = (await request.json()) as { command: string };
			commands.push(body.command);
			bodies.push(body);
			const reply =
				mode.replies && body.command in mode.replies
					? mode.replies[body.command]
					: body.command === "status" && mode.statusFails
						? { ok: false, error: { code: "UNKNOWN_COMMAND", message: "no" } }
						: body.command === "viewport"
							? { ok: true, data: { width: 393, height: 852 } }
							: { ok: true, data: { state: "ready" } };
			return Response.json(reply, { headers: { Connection: "close" } });
		},
	});
	servers.push(server);
	const deps: IosDeviceDeps = {
		startRunner: async () => ({
			port: RUNNER_PORT,
			exited: new Promise<number>((resolve) => {
				exit = resolve;
			}),
			stop: async () => {
				stops += 1;
			},
		}),
		connect: async (udid, port) => {
			tunnels.push({ udid, port });
			if (mode.tunnelFails) throw new Error("usbmuxd does not list iPhone");
			return createConnection(server.port ?? 0, "127.0.0.1");
		},
		devicectl: async (args) => {
			devicectl.push(args);
			return { stdout: "", stderr: "", exitCode: 0 };
		},
	};
	return {
		deps,
		commands,
		bodies,
		devicectl,
		tunnels,
		stops: () => stops,
		runnerExits: () => exit(0),
	};
}

describe("createIosDeviceSession (physical-iOS Direct lane)", () => {
	test("opens a Direct session once status crosses the cable to the runner's port", async () => {
		const phone = fakePhone();
		const session = await createIosDeviceSession(options(), phone.deps);
		expect(session.lane).toBe("direct");
		expect(session.stream).toBeNull();
		expect(phone.commands).toEqual(["status"]);
		expect(phone.tunnels).toEqual([{ udid: PHONE_UDID, port: RUNNER_PORT }]);
		await session.quit();
	});

	test("a status that fails stops the runner and fails the start", async () => {
		const phone = fakePhone({ statusFails: true });
		await expect(createIosDeviceSession(options(), phone.deps)).rejects.toThrow(/status/);
		expect(phone.stops()).toBe(1);
	});

	test("a tunnel that can't open stops the runner and fails the start", async () => {
		const phone = fakePhone({ tunnelFails: true });
		await expect(createIosDeviceSession(options(), phone.deps)).rejects.toThrow(
			/usbmuxd does not list iPhone/,
		);
		expect(phone.stops()).toBe(1);
	});

	test("rejects an iOS simulator", async () => {
		const phone = fakePhone();
		await expect(createIosDeviceSession(options(SIM_UDID), phone.deps)).rejects.toThrow(
			/physical iPhone/,
		);
	});

	test("quit stops the runner once", async () => {
		const phone = fakePhone();
		const session = await createIosDeviceSession(options(), phone.deps);
		await session.quit();
		await session.quit();
		expect(phone.stops()).toBe(1);
	});

	test("a runner that exits on its own is a Dead Session", async () => {
		const phone = fakePhone();
		let dead = 0;
		const session = await createIosDeviceSession(
			options(PHONE_UDID, {
				onSessionDead: () => {
					dead += 1;
				},
			}),
			phone.deps,
		);
		phone.runnerExits();
		await Bun.sleep(0);
		expect(dead).toBe(1);
		await session.quit();
	});

	test("app lifecycle goes through devicectl", async () => {
		const phone = fakePhone();
		const session = await createIosDeviceSession(options(), phone.deps);
		await session.activateApp("com.demo");
		expect(phone.devicectl).toEqual([
			["device", "process", "launch", "--device", PHONE_UDID, "com.demo"],
		]);
		await session.quit();
	});

	test("a tap goes to the runner as fractions of the screen", async () => {
		const phone = fakePhone();
		const session = await createIosDeviceSession(options(), phone.deps);
		await session.tap(250, 750);
		expect(phone.bodies.at(-1)).toMatchObject({ command: "tap", x: 0.25, y: 0.75 });
		await session.quit();
	});

	test("a held tap is a long-press for its duration", async () => {
		const phone = fakePhone();
		const session = await createIosDeviceSession(options(), phone.deps);
		await session.tap(500, 500, { durationMs: 1200 });
		expect(phone.bodies.at(-1)).toMatchObject({
			command: "longPress",
			x: 0.5,
			y: 0.5,
			durationMs: 1200,
		});
		await session.quit();
	});

	test("a swipe flicks and a drag holds first", async () => {
		const phone = fakePhone();
		const session = await createIosDeviceSession(options(), phone.deps);
		await session.swipe(100, 800, 100, 200, 300);
		await session.drag(100, 200, 900, 200, 1000);
		const [swipe, drag] = phone.bodies.slice(-2);
		expect(swipe).toMatchObject({
			command: "drag",
			fromX: 0.1,
			fromY: 0.8,
			toX: 0.1,
			toY: 0.2,
			durationMs: 300,
			pressMs: 50,
		});
		expect(drag).toMatchObject({
			command: "drag",
			fromX: 0.1,
			toX: 0.9,
			durationMs: 1000,
			pressMs: 500,
		});
		await session.quit();
	});

	test("the window size is the runner's viewport in points", async () => {
		const phone = fakePhone();
		const session = await createIosDeviceSession(options(), phone.deps);
		expect(await session.getWindowSize()).toEqual({ width: 393, height: 852 });
		await session.quit();
	});

	test("the tree is the runner's snapshot of the app, as the 0–1000 Screen", async () => {
		const phone = fakePhone({
			replies: {
				snapshot: {
					ok: true,
					data: {
						nodes: [
							{
								role: "Button",
								label: "Allow",
								id: "allow",
								frame: { x: 0.1, y: 0.2, width: 0.5, height: 0.1 },
								enabled: true,
							},
						],
					},
				},
			},
		});
		const session = await createIosDeviceSession(
			options(PHONE_UDID, { bundleId: "com.demo" }),
			phone.deps,
		);
		const screen = cleanPageSource(await session.pageSource(), await session.getWindowSize());
		expect(phone.bodies.find((body) => body.command === "snapshot")).toMatchObject({
			bundleId: "com.demo",
		});
		expect(screen.elements).toEqual([
			expect.objectContaining({ label: "Allow", x: 100, y: 200, width: 500, height: 100 }),
		]);
		await session.quit();
	});

	test("the snapshot follows the app that was last activated", async () => {
		const phone = fakePhone({ replies: { snapshot: { ok: true, data: { nodes: [] } } } });
		const session = await createIosDeviceSession(options(), phone.deps);
		await session.activateApp("com.other");
		await session.pageSource();
		expect(phone.bodies.find((body) => body.command === "snapshot")).toMatchObject({
			bundleId: "com.other",
		});
		await session.quit();
	});

	test("records video by stitching screenshots, so a Run on a phone can carry one", async () => {
		const phone = fakePhone({ replies: { screenshot: { ok: true, data: { png: "AAAA" } } } });
		const session = await createIosDeviceSession(options(), phone.deps);
		expect(session.startRecording).toBeFunction();
		await session.quit();
	});

	test("a backgrounded app is a clear error that names the app", async () => {
		const phone = fakePhone({
			replies: {
				snapshot: { ok: false, error: { code: "APP_BACKGROUNDED", message: "state 3" } },
			},
		});
		const session = await createIosDeviceSession(
			options(PHONE_UDID, { bundleId: "com.demo" }),
			phone.deps,
		);
		const error = await session.pageSource().catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(YoqaRunnerCommandError);
		expect((error as YoqaRunnerCommandError).code).toBe("APP_BACKGROUNDED");
		expect((error as Error).message).toMatch(/com\.demo is not in the foreground/);
		await session.quit();
	});

	test("a stuck main thread is a clear error, not a Dead Session", async () => {
		const phone = fakePhone({
			replies: { tap: { ok: false, error: { code: "RUNNER_WEDGED", message: "8 s" } } },
		});
		let dead = 0;
		const session = await createIosDeviceSession(
			options(PHONE_UDID, {
				onSessionDead: () => {
					dead += 1;
				},
			}),
			phone.deps,
		);
		const error = await session.tap(500, 500).catch((caught: unknown) => caught);
		expect((error as YoqaRunnerCommandError).code).toBe("RUNNER_WEDGED");
		expect((error as Error).message).toMatch(/main thread is stuck/);
		expect(dead).toBe(0);
		await session.quit();
	});

	test("typing sends the text, and a newline presses return", async () => {
		const phone = fakePhone();
		const session = await createIosDeviceSession(options(), phone.deps);
		await session.type("ab\ncd");
		const sent = phone.bodies.slice(-3);
		expect(sent.map((body) => body.command)).toEqual(["type", "keyboardReturn", "type"]);
		expect(sent[0]).toMatchObject({ text: "ab" });
		expect(sent[2]).toMatchObject({ text: "cd" });
		await session.quit();
	});

	test("a backspace character presses delete", async () => {
		const phone = fakePhone();
		const session = await createIosDeviceSession(options(), phone.deps);
		await session.type("a\b\bb");
		expect(phone.bodies.slice(-4).map((body) => body.command)).toEqual([
			"type",
			"keyboardDelete",
			"keyboardDelete",
			"type",
		]);
		await session.quit();
	});

	test("backgrounding presses home, waits, and brings the app back", async () => {
		const phone = fakePhone();
		const session = await createIosDeviceSession(
			options(PHONE_UDID, { bundleId: "com.demo" }),
			phone.deps,
		);
		await session.backgroundApp(0);
		expect(phone.bodies.at(-1)).toMatchObject({ command: "button", name: "home" });
		expect(phone.devicectl).toEqual([
			["device", "process", "launch", "--device", PHONE_UDID, "com.demo"],
		]);
		await session.quit();
	});
});
