import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ServerEntry } from "@yoqa/runner-client";
import { buildProgram } from "./program";

const SERVER: ServerEntry = {
	id: "device-session",
	kind: "device-session",
	ownership: "self",
	label: "iPhone 16",
	status: "running",
	actions: ["stop", "restart"],
};

/** A runner with one server, recording each `METHOD /path` it is asked for. */
function fakeRunner() {
	const requests: string[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: (request) => {
			const url = new URL(request.url);
			requests.push(`${request.method} ${url.pathname}`);
			if (request.method === "GET" && url.pathname === "/servers") {
				return Response.json({ servers: [SERVER] });
			}
			if (request.method === "POST" && url.pathname.startsWith("/servers/")) {
				return Response.json({ ok: true, message: `did ${url.pathname}`, servers: [SERVER] });
			}
			return Response.json({ error: "not found" }, { status: 404 });
		},
	});
	return { requests, url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

describe("yoqa servers subcommands read the flags typed after them", () => {
	const runner = fakeRunner();
	// What the CLI talks to when `--base-url` is lost: a fake too, so a regression stops nothing real.
	const defaultRunner = fakeRunner();
	const autostart = process.env.YOQA_NO_AUTOSTART;
	const runnerUrl = process.env.YOQA_RUNNER_URL;
	// Restored as 0 when unset: Bun keeps a failure code if `exitCode` is set back to undefined.
	const exitCode = process.exitCode ?? 0;
	const log = console.log;
	const error = console.error;
	let printed: string[] = [];

	beforeAll(() => {
		process.env.YOQA_NO_AUTOSTART = "1";
		process.env.YOQA_RUNNER_URL = defaultRunner.url;
		console.log = (...args: unknown[]) => printed.push(args.join(" "));
		console.error = (...args: unknown[]) => printed.push(args.join(" "));
	});

	afterAll(() => {
		runner.stop();
		defaultRunner.stop();
		console.log = log;
		console.error = error;
		process.exitCode = exitCode;
		if (autostart === undefined) Reflect.deleteProperty(process.env, "YOQA_NO_AUTOSTART");
		else process.env.YOQA_NO_AUTOSTART = autostart;
		if (runnerUrl === undefined) Reflect.deleteProperty(process.env, "YOQA_RUNNER_URL");
		else process.env.YOQA_RUNNER_URL = runnerUrl;
	});

	/**
	 * Run `yoqa <args> --base-url <fake>`, returning what it printed and the server requests each
	 * runner saw. The emit also asks for the Device Session, which is not what is under test.
	 */
	async function yoqa(...args: string[]) {
		printed = [];
		runner.requests.length = 0;
		defaultRunner.requests.length = 0;
		await buildProgram().parseAsync(["bun", "yoqa", ...args, "--base-url", runner.url]);
		const serverRequests = (requests: string[]) => requests.filter((r) => r.includes("/servers"));
		return {
			out: printed.join("\n"),
			requests: serverRequests(runner.requests),
			defaultRequests: serverRequests(defaultRunner.requests),
		};
	}

	test("list --json asks the named runner and prints compact JSON", async () => {
		const { out, requests, defaultRequests } = await yoqa("servers", "list", "--json");
		expect(requests).toEqual(["GET /servers"]);
		expect(defaultRequests).toEqual([]);
		expect(out).toBe(JSON.stringify({ servers: [SERVER] }));
	});

	test("stop <id> stops the server on the named runner, not the default one", async () => {
		const { out, requests, defaultRequests } = await yoqa(
			"servers",
			"stop",
			"device-session",
			"--pretty",
			"--json",
		);
		expect(requests).toEqual(["POST /servers/device-session/stop"]);
		expect(defaultRequests).toEqual([]);
		expect(out).toBe(
			JSON.stringify(
				{ ok: true, message: "did /servers/device-session/stop", servers: [SERVER] },
				null,
				2,
			),
		);
	});

	test("stop-all and restart <id> act on the named runner and print its message", async () => {
		const stopAll = await yoqa("servers", "stop-all");
		expect(stopAll.requests).toEqual(["POST /servers/stop-all"]);
		expect(stopAll.defaultRequests).toEqual([]);
		expect(stopAll.out).toBe("did /servers/stop-all");

		const restart = await yoqa("servers", "restart", "device-session");
		expect(restart.requests).toEqual(["POST /servers/device-session/restart"]);
		expect(restart.defaultRequests).toEqual([]);
		expect(restart.out).toBe("did /servers/device-session/restart");
	});

	test("bare servers still lists the named runner's servers", async () => {
		const { out, requests, defaultRequests } = await yoqa("servers");
		expect(requests).toEqual(["GET /servers"]);
		expect(defaultRequests).toEqual([]);
		expect(out).toContain("device-session\tiPhone 16\tdevice-session · self · running");
	});
});
