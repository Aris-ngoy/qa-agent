import { afterEach, describe, expect, test } from "bun:test";
import { createConnection } from "node:net";
import { type IosDeviceDeps, createIosDeviceSession } from "./ios-device-lane";
import type { SessionOptions } from "./lane";

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
function fakePhone(mode: { statusFails?: boolean; tunnelFails?: boolean } = {}) {
	const commands: string[] = [];
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
			const reply =
				body.command === "status" && !mode.statusFails
					? { ok: true, data: { state: "ready" } }
					: { ok: false, error: { code: "UNKNOWN_COMMAND", message: "no" } };
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

	test("gestures and observation say they aren't available yet instead of hanging", async () => {
		const phone = fakePhone();
		const session = await createIosDeviceSession(options(), phone.deps);
		await expect(session.tap(500, 500)).rejects.toThrow(/physical-iOS Direct lane/);
		await expect(session.captureFrame()).rejects.toThrow(/physical-iOS Direct lane/);
		await session.quit();
	});
});
