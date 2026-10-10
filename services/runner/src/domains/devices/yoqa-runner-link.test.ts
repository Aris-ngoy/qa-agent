import { afterEach, describe, expect, test } from "bun:test";
import { type Socket, createConnection } from "node:net";
import { Duplex } from "node:stream";
import {
	YoqaRunnerCommandError,
	YoqaRunnerUnreachableError,
	createYoqaRunnerLink,
} from "./yoqa-runner-link";

type Reply = { status: number; body: string };

/**
 * Stands in for `YoqaRunner` at its wire protocol: every command is `POST /` with a JSON
 * body, answered by `reply` with `Connection: close`, as `HTTPServer.swift` does.
 */
function fakeRunner(reply: (body: Record<string, unknown>) => Reply, delayMs = 0) {
	const received: Array<{ method: string; body: Record<string, unknown> }> = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: async (request) => {
			const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
			received.push({ method: request.method, body });
			if (delayMs > 0) await Bun.sleep(delayMs);
			const { status, body: text } = reply(body);
			return new Response(text, {
				status,
				headers: { "Content-Type": "application/json", Connection: "close" },
			});
		},
	});
	servers.push(server);
	/** A tunnel to the runner, the way usbmuxd hands one out: a plain socket. */
	const tunnel = async () => createConnection(server.port ?? 0, "127.0.0.1");
	return { received, tunnel };
}

const servers: Array<ReturnType<typeof Bun.serve>> = [];
afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true);
});

const ok = (data: unknown): Reply => ({ status: 200, body: JSON.stringify({ ok: true, data }) });

describe("createYoqaRunnerLink", () => {
	test("sends a command with an id and returns its data", async () => {
		const runner = fakeRunner(() => ok({ state: "ready" }));
		const link = createYoqaRunnerLink(runner.tunnel);
		expect(await link.send("status")).toEqual({ state: "ready" });
		expect(runner.received).toHaveLength(1);
		expect(runner.received[0]?.method).toBe("POST");
		expect(runner.received[0]?.body.command).toBe("status");
		expect(typeof runner.received[0]?.body.commandId).toBe("string");
	});

	test("reads a tunnel that arrives paused, as usbmuxd hands it over", async () => {
		const runner = fakeRunner(() => ok({ state: "ready" }));
		const paused = async () => {
			const socket = await runner.tunnel();
			socket.pause();
			return socket;
		};
		const link = createYoqaRunnerLink(paused, { timeoutMs: 2000 });
		expect(await link.send("status")).toEqual({ state: "ready" });
	});

	test("every command gets its own id", async () => {
		const runner = fakeRunner(() => ok({ state: "ready" }));
		const link = createYoqaRunnerLink(runner.tunnel);
		await link.send("status");
		await link.send("status");
		expect(runner.received[0]?.body.commandId).not.toBe(runner.received[1]?.body.commandId);
	});

	test("a runner error reaches the caller with its code", async () => {
		const runner = fakeRunner(() => ({
			status: 400,
			body: JSON.stringify({
				ok: false,
				error: { code: "UNKNOWN_COMMAND", message: 'unknown command "fly"' },
			}),
		}));
		const failure = createYoqaRunnerLink(runner.tunnel).send("fly");
		await expect(failure).rejects.toBeInstanceOf(YoqaRunnerCommandError);
		await expect(failure).rejects.toMatchObject({ code: "UNKNOWN_COMMAND" });
	});

	test("a tunnel that can't open makes the runner unreachable", async () => {
		const link = createYoqaRunnerLink(async () => {
			throw new Error("usbmuxd does not list iPhone X");
		});
		const failure = link.send("status");
		await expect(failure).rejects.toBeInstanceOf(YoqaRunnerUnreachableError);
		await expect(failure).rejects.toThrow(/usbmuxd does not list iPhone X/);
	});

	test("a reply that isn't the runner's envelope makes the runner unreachable", async () => {
		const runner = fakeRunner(() => ({ status: 200, body: "<html>not the runner</html>" }));
		await expect(createYoqaRunnerLink(runner.tunnel).send("status")).rejects.toBeInstanceOf(
			YoqaRunnerUnreachableError,
		);
	});

	test("a runner that never answers times out as unreachable", async () => {
		const runner = fakeRunner(() => ok({}));
		const silent = async () => {
			const socket = await runner.tunnel();
			// Swallow the request so it never reaches the server.
			socket.write = (() => true) as typeof socket.write;
			return socket;
		};
		const link = createYoqaRunnerLink(silent, { timeoutMs: 50 });
		await expect(link.send("status")).rejects.toThrow(/did not answer status within 50 ms/);
	});

	test("a snapshot is given longer than other commands to answer", async () => {
		const runner = fakeRunner(() => ok({ nodes: [] }), 200);
		const link = createYoqaRunnerLink(runner.tunnel, { timeoutMs: 50, snapshotTimeoutMs: 2000 });
		expect(await link.send("snapshot")).toEqual({ nodes: [] });
		await expect(link.send("viewport")).rejects.toThrow(/did not answer viewport within 50 ms/);
	});
});

/**
 * A tunnel that carries the request to the runner and loses the reply: the connection
 * closes as soon as the runner starts answering, as a flaky cable does.
 */
function losingReply(socket: Socket): Duplex {
	const tunnel = new Duplex({
		read() {},
		write(chunk, _encoding, callback) {
			socket.write(chunk, callback);
		},
	});
	socket.once("data", () => {
		socket.destroy();
		tunnel.destroy();
	});
	return tunnel;
}

/**
 * A runner that journals gestures by `commandId`, as `Journal.swift` does, and answers
 * `status` about them. `pendingStatuses` status reads see the gesture still running.
 */
function journalingRunner(options: { gestureReply?: Reply; pendingStatuses?: number } = {}) {
	const journal = new Map<string, unknown>();
	let pending = options.pendingStatuses ?? 0;
	const gestureReply = options.gestureReply ?? ok({});
	const runner = fakeRunner((body) => {
		if (body.command === "status") {
			const id = body.statusCommandId as string | undefined;
			if (!id) return ok({ state: "ready" });
			if (!journal.has(id)) return ok({ state: "ready", command: { state: "unknown" } });
			if (pending > 0) {
				pending -= 1;
				return ok({ state: "ready", command: { state: "pending" } });
			}
			return ok({ state: "ready", command: { state: "done", reply: journal.get(id) } });
		}
		journal.set(body.commandId as string, JSON.parse(gestureReply.body));
		return gestureReply;
	});
	let calls = 0;
	/** The first tunnel loses its reply; later ones are healthy. */
	const flaky = async () => {
		const socket = await runner.tunnel();
		calls += 1;
		return calls === 1 ? losingReply(socket) : socket;
	};
	const commands = () => runner.received.map(({ body }) => body.command);
	return { runner, flaky, commands };
}

describe("createYoqaRunnerLink: journaled commands", () => {
	test("a gesture whose reply is lost is resolved by status and never sent again", async () => {
		const { runner, flaky, commands } = journalingRunner();
		const link = createYoqaRunnerLink(flaky, { timeoutMs: 2000 });
		expect(await link.send("tap", { x: 0.5, y: 0.5 }, { journaled: true })).toEqual({});
		expect(commands()).toEqual(["tap", "status"]);
		expect(runner.received[1]?.body.statusCommandId).toBe(runner.received[0]?.body.commandId);
	});

	test("a lost reply waits while status says the gesture is still running", async () => {
		const { flaky, commands } = journalingRunner({ pendingStatuses: 2 });
		const link = createYoqaRunnerLink(flaky, { timeoutMs: 2000 });
		await link.send("tap", { x: 0.5, y: 0.5 }, { journaled: true });
		expect(commands()).toEqual(["tap", "status", "status", "status"]);
	});

	test("a lost reply carrying a runner error rethrows it with its code", async () => {
		const { flaky } = journalingRunner({
			gestureReply: {
				status: 500,
				body: JSON.stringify({ ok: false, error: { code: "DEVICE_ERROR", message: "no window" } }),
			},
		});
		const link = createYoqaRunnerLink(flaky, { timeoutMs: 2000 });
		const failure = link.send("tap", { x: 0.5, y: 0.5 }, { journaled: true });
		await expect(failure).rejects.toBeInstanceOf(YoqaRunnerCommandError);
		await expect(failure).rejects.toMatchObject({ code: "DEVICE_ERROR" });
	});

	test("a gesture that never reached the runner is reported, not resent", async () => {
		const { runner, commands } = journalingRunner();
		let calls = 0;
		const swallowFirst = async () => {
			const socket = await runner.tunnel();
			calls += 1;
			if (calls === 1) socket.write = (() => true) as typeof socket.write;
			return socket;
		};
		const link = createYoqaRunnerLink(swallowFirst, { timeoutMs: 100 });
		const failure = link.send("tap", { x: 0.5, y: 0.5 }, { journaled: true });
		await expect(failure).rejects.toBeInstanceOf(YoqaRunnerCommandError);
		await expect(failure).rejects.toMatchObject({ code: "COMMAND_LOST" });
		await expect(failure).rejects.toThrow(/never reached YoqaRunner/);
		expect(commands()).toEqual(["status"]);
	});

	test("a read whose reply is lost is unreachable without a status lookup", async () => {
		const { flaky, commands } = journalingRunner();
		const link = createYoqaRunnerLink(flaky, { timeoutMs: 2000 });
		await expect(link.send("screenshot")).rejects.toBeInstanceOf(YoqaRunnerUnreachableError);
		expect(commands()).toEqual(["screenshot"]);
	});
});
