import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errorChain } from "./error-chain";
import { type IosDeviceDeps, createIosDeviceSession } from "./ios-device-lane";
import { DeadSessionError, DeviceUnreachableError, type SessionOptions } from "./lane";
import { cleanPageSource, screenSourceOf } from "./screen";
import { UsbmuxError } from "./usbmuxd";
import { YoqaRunnerCommandError } from "./yoqa-runner-link";

const PHONE_UDID = "00008120-000E6D813E2A601E";
const SIM_UDID = "B75001FB-B91D-4F94-80A7-3E371A641D27";
const RUNNER_PORT = 54_321;

function options(deviceId = PHONE_UDID, extra: Partial<SessionOptions> = {}): SessionOptions {
	return {
		platform: "ios",
		deviceId,
		requestedLane: "direct",
		...extra,
	};
}

/** `devicectl device info apps` on the fake phone: one app built by a developer, one from the App Store. */
const INSTALLED_APPS = {
	result: {
		apps: [
			{ bundleIdentifier: "com.example.shop", builtByDeveloper: false },
			{ bundleIdentifier: "com.example.testemall", builtByDeveloper: true },
		],
	},
};

/** The `devicectl` commands that listed the phone's apps. */
const appListings = (devicectl: string[][]) =>
	devicectl.filter((args) => args.slice(0, 3).join(" ") === "device info apps");

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
		/** What `devicectl device info apps` writes; `INSTALLED_APPS` when omitted, and a failure when null. */
		apps?: unknown;
	} = {},
) {
	const commands: string[] = [];
	const bodies: Array<Record<string, unknown>> = [];
	const devicectl: string[][] = [];
	const tunnels: Array<{ udid: string; port: number }> = [];
	let stops = 0;
	let cableDown = false;
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
			if (mode.tunnelFails || cableDown)
				throw new UsbmuxError("usbmuxd does not list iPhone", true);
			return createConnection(server.port ?? 0, "127.0.0.1");
		},
		devicectl: async (args) => {
			devicectl.push(args);
			if (args.slice(0, 3).join(" ") === "device info apps") {
				if (mode.apps === null) return { stdout: "", stderr: "no apps for you", exitCode: 1 };
				const path = args[args.indexOf("--json-output") + 1] ?? "";
				await Bun.write(path, JSON.stringify(mode.apps ?? INSTALLED_APPS));
			}
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
		setCableDown: (down: boolean) => {
			cableDown = down;
		},
	};
}

describe("createIosDeviceSession (physical-iOS Direct lane)", () => {
	test("opens a Direct session once status crosses the cable to the runner's port", async () => {
		const phone = fakePhone();
		const session = await createIosDeviceSession(options(), phone.deps);
		expect(session.lane).toBe("direct");
		expect(session.stream?.ready).toBe(true);
		expect(phone.commands.slice(0, 2)).toEqual(["status", "recordStart"]);
		expect(phone.bodies.find((body) => body.command === "recordStart")).toMatchObject({ fps: 12 });
		expect(phone.tunnels.slice(0, 2)).toEqual([
			{ udid: PHONE_UDID, port: RUNNER_PORT },
			{ udid: PHONE_UDID, port: RUNNER_PORT },
		]);
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
		const log = spyOn(console, "error").mockImplementation(() => {});
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
		const frameError = await session.captureFrame().catch((caught: unknown) => caught);
		const tapError = await session.tap(500, 500).catch((caught: unknown) => caught);
		log.mockRestore();
		expect(frameError).toBeInstanceOf(DeadSessionError);
		expect(tapError).toBeInstanceOf(DeadSessionError);
		await session.quit();
	});

	test("a tunnel that drops for a moment is not a Dead Session", async () => {
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
		phone.setCableDown(true);
		const error = await session.tap(500, 500).catch((caught: unknown) => caught);
		// An Unreachable Session: the runner keeps it, and says how long it will wait.
		expect(error).toBeInstanceOf(DeviceUnreachableError);
		expect(error).not.toBeInstanceOf(DeadSessionError);
		expect((error as DeviceUnreachableError).graceMs).toBeGreaterThan(0);
		expect(dead).toBe(0);
		phone.setCableDown(false);
		await session.tap(500, 500);
		expect(phone.bodies.at(-1)).toMatchObject({ command: "tap" });
		await session.quit();
	});

	test("a cable that stays unreachable past the grace is a Dead Session", async () => {
		const phone = fakePhone();
		let dead = 0;
		const session = await createIosDeviceSession(
			options(PHONE_UDID, {
				onSessionDead: () => {
					dead += 1;
				},
			}),
			{ ...phone.deps, unreachableGraceMs: 0 },
		);
		phone.setCableDown(true);
		const log = spyOn(console, "error").mockImplementation(() => {});
		const error = await session.tap(500, 500).catch((caught: unknown) => caught);
		const logged = log.mock.calls.map((args) => String(args[1]));
		log.mockRestore();
		expect(error).toBeInstanceOf(DeadSessionError);
		expect(dead).toBe(1);
		// The usbmuxd miss stays reachable behind the Dead Session, and is logged once.
		expect(errorChain(error).map((link) => link.name)).toEqual([
			"DeadSessionError",
			"YoqaRunnerUnreachableError",
			"UsbmuxError",
		]);
		expect(logged).toHaveLength(1);
		expect(logged[0]).toContain("usbmuxd does not list iPhone");
		await session.quit();
	});

	test("a cable miss on a frame or the tree keeps the device session", async () => {
		const phone = fakePhone();
		let dead = 0;
		const session = await createIosDeviceSession(
			options(PHONE_UDID, {
				onSessionDead: () => {
					dead += 1;
				},
			}),
			{ ...phone.deps, unreachableGraceMs: 0 },
		);
		phone.setCableDown(true);
		const warn = spyOn(console, "warn").mockImplementation(() => {});
		const frameError = await session.captureFrame().catch((caught: unknown) => caught);
		const treeError = await session.pageSource().catch((caught: unknown) => caught);
		const warned = warn.mock.calls.map((args) => String(args[0]));
		warn.mockRestore();
		expect(frameError).toBeInstanceOf(DeviceUnreachableError);
		expect(frameError).not.toBeInstanceOf(DeadSessionError);
		expect(treeError).toBeInstanceOf(DeviceUnreachableError);
		expect(dead).toBe(0);
		expect(warned.join("\n")).toContain("Inspector session cannot reach");

		phone.setCableDown(false);
		await session.tap(500, 500);
		expect(dead).toBe(0);

		phone.setCableDown(true);
		const log = spyOn(console, "error").mockImplementation(() => {});
		const tapError = await session.tap(500, 500).catch((caught: unknown) => caught);
		log.mockRestore();
		expect(tapError).toBeInstanceOf(DeadSessionError);
		expect(dead).toBe(1);
		await session.quit();
	});

	test("inspector reads open one tunnel at a time", async () => {
		const phone = fakePhone({
			replies: { screenshot: { ok: true, data: { png: "aGk=" } } },
		});
		let open = 0;
		let max = 0;
		const connect = phone.deps.connect;
		phone.deps.connect = async (udid, port) => {
			open += 1;
			max = Math.max(max, open);
			await Bun.sleep(40);
			try {
				return await connect(udid, port);
			} finally {
				open -= 1;
			}
		};
		const session = await createIosDeviceSession(options(), phone.deps);
		max = 0;
		await Promise.all([session.captureFrame(), session.captureFrame()]);
		expect(max).toBe(1);
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
		const snapshot = phone.bodies.find((body) => body.command === "snapshot");
		// A target app is read alone: no candidates, and the phone's apps are not listed.
		expect(snapshot).toMatchObject({ bundleId: "com.demo" });
		expect(snapshot).not.toHaveProperty("candidates");
		expect(appListings(phone.devicectl)).toEqual([]);
		expect(screen.elements).toEqual([
			expect.objectContaining({ label: "Allow", x: 100, y: 200, width: 500, height: 100 }),
		]);
		await session.quit();
	});

	test("the Screen says which app the runner read it from", async () => {
		const phone = fakePhone({
			replies: {
				snapshot: {
					ok: true,
					data: { nodes: [], source: { kind: "target", bundleId: "com.demo" } },
				},
			},
		});
		const session = await createIosDeviceSession(
			options(PHONE_UDID, { bundleId: "com.demo" }),
			phone.deps,
		);
		const raw = await session.pageSource();
		expect(cleanPageSource(raw, await session.getWindowSize()).source).toEqual({
			kind: "target",
			bundleId: "com.demo",
		});
		expect(screenSourceOf(raw)).toEqual({ kind: "target", bundleId: "com.demo" });
		await session.quit();
	});

	test("a snapshot with no source is the target app's when one was asked for, else the system's", async () => {
		const phone = fakePhone({ replies: { snapshot: { ok: true, data: { nodes: [] } } } });
		const targeted = await createIosDeviceSession(
			options(PHONE_UDID, { bundleId: "com.demo" }),
			phone.deps,
		);
		expect(screenSourceOf(await targeted.pageSource())).toEqual({
			kind: "target",
			bundleId: "com.demo",
		});
		await targeted.quit();
		const untargeted = await createIosDeviceSession(options(), phone.deps);
		expect(screenSourceOf(await untargeted.pageSource())).toEqual({ kind: "system" });
		await untargeted.quit();
	});

	test("with no target app, the snapshot asks for the phone's user apps as candidates", async () => {
		const phone = fakePhone({ replies: { snapshot: { ok: true, data: { nodes: [] } } } });
		const session = await createIosDeviceSession(options(), phone.deps);
		await session.pageSource();
		const snapshot = phone.bodies.find((body) => body.command === "snapshot");
		expect(snapshot).toMatchObject({
			candidates: ["com.example.testemall", "com.example.shop"],
		});
		expect(snapshot).not.toHaveProperty("bundleId");
		expect(appListings(phone.devicectl)).toEqual([
			["device", "info", "apps", "--device", PHONE_UDID, "--json-output", expect.any(String)],
		]);
		await session.quit();
	});

	test("the app found in the foreground reaches the Screen as its source", async () => {
		const phone = fakePhone({
			replies: {
				snapshot: {
					ok: true,
					data: { nodes: [], source: { kind: "foreground", bundleId: "com.example.testemall" } },
				},
			},
		});
		const session = await createIosDeviceSession(options(), phone.deps);
		const raw = await session.pageSource();
		expect(screenSourceOf(raw)).toEqual({ kind: "foreground", bundleId: "com.example.testemall" });
		expect(cleanPageSource(raw, await session.getWindowSize()).source).toEqual({
			kind: "foreground",
			bundleId: "com.example.testemall",
		});
		await session.quit();
	});

	test("the phone's apps are listed once per Device Session, not on every read", async () => {
		const phone = fakePhone({ replies: { snapshot: { ok: true, data: { nodes: [] } } } });
		const session = await createIosDeviceSession(options(), phone.deps);
		await session.pageSource();
		await session.pageSource();
		await session.pageSource();
		expect(appListings(phone.devicectl)).toHaveLength(1);
		await session.quit();
	});

	test("an app found in the foreground does not become the target app", async () => {
		const phone = fakePhone({
			replies: {
				snapshot: {
					ok: true,
					data: { nodes: [], source: { kind: "foreground", bundleId: "com.example.testemall" } },
				},
			},
		});
		const session = await createIosDeviceSession(options(), phone.deps);
		await session.pageSource();
		await session.pageSource();
		const snapshots = phone.bodies.filter((body) => body.command === "snapshot");
		expect(snapshots).toHaveLength(2);
		for (const snapshot of snapshots) expect(snapshot).not.toHaveProperty("bundleId");
		// Backgrounding brings back only a target app, and there is none.
		await session.backgroundApp(0);
		expect(phone.devicectl.filter((args) => args.includes("launch"))).toEqual([]);
		await session.quit();
	});

	test("apps that can't be listed leave the snapshot on the system, and are not asked again", async () => {
		const phone = fakePhone({
			apps: null,
			replies: { snapshot: { ok: true, data: { nodes: [] } } },
		});
		const warn = spyOn(console, "warn").mockImplementation(() => {});
		const session = await createIosDeviceSession(options(), phone.deps);
		const raw = await session.pageSource();
		await session.pageSource();
		const warned = warn.mock.calls.map((args) => String(args[0]));
		warn.mockRestore();
		expect(screenSourceOf(raw)).toEqual({ kind: "system" });
		expect(phone.bodies.find((body) => body.command === "snapshot")).toEqual(
			expect.objectContaining({ candidates: [] }),
		);
		expect(appListings(phone.devicectl)).toHaveLength(1);
		expect(warned.filter((line) => line.includes("no apps for you"))).toHaveLength(1);
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

	test("a new target app is what the next snapshot reads, and nothing is launched", async () => {
		const phone = fakePhone({ replies: { snapshot: { ok: true, data: { nodes: [] } } } });
		const session = await createIosDeviceSession(
			options(PHONE_UDID, { bundleId: "com.app-a" }),
			phone.deps,
		);
		session.setTargetApp("com.app-b");
		await session.pageSource();
		expect(phone.bodies.find((body) => body.command === "snapshot")).toMatchObject({
			bundleId: "com.app-b",
		});
		expect(phone.devicectl).toEqual([]);
		await session.quit();
	});

	test("records video from frames the phone captures, pulled in batches", async () => {
		const phone = fakePhone({
			replies: {
				recordFetch: {
					ok: true,
					data: { running: true, frames: [{ seq: 0, ms: 0, jpeg: "AAAA" }] },
				},
			},
		});
		const encoded: string[] = [];
		const session = await createIosDeviceSession(options(), {
			...phone.deps,
			recorder: {
				findFfmpeg: () => "/bin/ffmpeg",
				encode: async (_ffmpeg, list) => {
					encoded.push(await Bun.file(list).text());
				},
			},
		});
		const recording = await session.startRecording?.(join(tmpdir(), `yoqa-lane-${Date.now()}.mp4`));
		await Bun.sleep(100);
		await recording?.stop();
		// The mirror starts the phone's recorder; the recording only pulls, and does not stop it.
		expect(phone.commands).toEqual(["status", "recordStart", "recordFetch", "recordFetch"]);
		expect(phone.bodies.find((body) => body.command === "recordStart")).toMatchObject({ fps: 12 });
		expect(encoded[0]).toContain(".jpg'");
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
		expect(phone.bodies.find((body) => body.command === "snapshot")).not.toHaveProperty(
			"candidates",
		);
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
