import { afterEach, describe, expect, test } from "bun:test";
import { createConnection } from "node:net";
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
function fakeRunner(reply: (body: Record<string, unknown>) => Reply) {
	const received: Array<{ method: string; body: Record<string, unknown> }> = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: async (request) => {
			const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
			received.push({ method: request.method, body });
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
});
