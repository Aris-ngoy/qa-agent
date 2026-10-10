/**
 * `yoqa-ax` (source in `native/yoqa-ax`): our helper that runs inside one booted iOS
 * simulator and reads its accessibility tree. The runner binds a Unix socket, then
 * spawns it with `xcrun simctl spawn <udid> yoqa-ax --connect <socket>`; it connects back
 * and answers requests over length-prefixed JSON, one in flight.
 *
 * `AutomationEnabled` is never set: on current simulators it hangs the accessibility query.
 */

import { randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { type Server, type Socket, createServer } from "node:net";
import { join } from "node:path";

/** One accessibility element as `yoqa-ax` reports it. The frame is 0.0–1.0 of the screen. */
export type YoqaAxNode = {
	role: string;
	label?: string;
	value?: string;
	/** The accessibility identifier. */
	id?: string;
	frame: { x: number; y: number; width: number; height: number };
	enabled: boolean;
};

/** One `describe`: the foreground apps' and SpringBoard's elements. An empty read is degraded. */
export type YoqaAxTree = { nodes: YoqaAxNode[]; degraded: boolean };

/** A connected `yoqa-ax`. Requests go one at a time. */
export type YoqaAx = {
	ping: () => Promise<"ok">;
	describe: () => Promise<YoqaAxTree>;
	/** Close the socket and end the helper. Safe to call twice. */
	stop: () => Promise<void>;
};

/** Starts `yoqa-ax` for a simulator UDID and resolves once it connected back and answered. */
export type StartYoqaAx = (udid: string) => Promise<YoqaAx>;

/** The `simctl spawn` process, as `startYoqaAx` uses it. */
export type YoqaAxProcess = {
	exited: Promise<number>;
	kill: (signal?: NodeJS.Signals) => void;
};

export type StartYoqaAxOptions = {
	/** The `yoqa-ax` binary built for the iOS simulator. */
	bin: string;
	connectTimeoutMs?: number;
	requestTimeoutMs?: number;
	spawn?: (command: string[]) => YoqaAxProcess;
};

const CONNECT_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 5_000;
const STOP_GRACE_MS = 2_000;

function spawnProcess(command: string[]): YoqaAxProcess {
	return Bun.spawn(command, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
}

/** `YOQA_AX_BIN`, else the simulator build from `native/yoqa-ax`, else null. */
export function resolveYoqaAxBin(): string | null {
	const fromEnv = process.env.YOQA_AX_BIN?.trim();
	if (fromEnv) return fromEnv;
	const products = join(import.meta.dir, "../../../../../native/yoqa-ax/.build/out/Products");
	for (const config of ["Release-iphonesimulator", "Debug-iphonesimulator"]) {
		const built = join(products, config, "yoqa-ax");
		if (existsSync(built)) return built;
	}
	return null;
}

/**
 * A short path under `/tmp` (a Unix socket path is limited to 104 bytes), named after the
 * UDID, with a random suffix so two runners never take each other's socket.
 */
function socketPath(udid: string): string {
	const udid8 = udid.replaceAll("-", "").slice(0, 8).toLowerCase();
	return `/tmp/yoqa-ax-${udid8}-${randomBytes(4).toString("hex")}.sock`;
}

function frame(body: unknown): Buffer {
	const json = Buffer.from(JSON.stringify(body));
	const header = Buffer.alloc(4);
	header.writeUInt32BE(json.length);
	return Buffer.concat([header, json]);
}

type Reply = { id?: number; result?: unknown; error?: string };

/** Length-prefixed JSON over the connected socket, one request in flight. */
function createClient(socket: Socket, requestTimeoutMs: number) {
	let buffered = Buffer.alloc(0);
	let nextId = 1;
	let pending: { id: number; settle: (reply: Reply | Error) => void } | null = null;
	let closed: string | null = null;
	let chain: Promise<unknown> = Promise.resolve();

	socket.on("data", (chunk: Buffer) => {
		buffered = Buffer.concat([buffered, chunk]);
		while (buffered.length >= 4 && buffered.length >= 4 + buffered.readUInt32BE(0)) {
			const length = buffered.readUInt32BE(0);
			const body = buffered.subarray(4, 4 + length).toString();
			buffered = buffered.subarray(4 + length);
			let reply: Reply;
			try {
				reply = JSON.parse(body) as Reply;
			} catch {
				continue;
			}
			// A reply to a request that already timed out is dropped.
			if (pending && reply.id === pending.id) pending.settle(reply);
		}
	});
	const onClose = (reason: string) => {
		closed ??= reason;
		pending?.settle(new Error(`yoqa-ax ${reason}`));
	};
	socket.on("close", () => onClose("disconnected"));
	socket.on("error", (error) => onClose(`disconnected: ${error.message}`));

	const send = (method: string): Promise<unknown> => {
		if (closed) return Promise.reject(new Error(`yoqa-ax ${closed}`));
		const id = nextId++;
		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(
				() => settle(new Error(`yoqa-ax ${method}: no reply within ${requestTimeoutMs} ms`)),
				requestTimeoutMs,
			);
			const settle = (reply: Reply | Error) => {
				clearTimeout(timer);
				pending = null;
				if (reply instanceof Error) reject(reply);
				else if (reply.error !== undefined) reject(new Error(`yoqa-ax ${method}: ${reply.error}`));
				else resolve(reply.result);
			};
			pending = { id, settle };
			socket.write(frame({ id, method }));
		});
	};

	return {
		request: (method: string): Promise<unknown> => {
			const run = chain.then(
				() => send(method),
				() => send(method),
			);
			chain = run.catch(() => undefined);
			return run;
		},
		close: (reason: string) => {
			closed ??= reason;
			socket.end();
			socket.destroy();
		},
	};
}

function parseTree(value: unknown): YoqaAxTree {
	const body = (typeof value === "object" && value !== null ? value : {}) as {
		nodes?: unknown;
		degraded?: unknown;
	};
	if (!Array.isArray(body.nodes)) throw new Error("yoqa-ax describe returned no tree");
	return { nodes: body.nodes as YoqaAxNode[], degraded: body.degraded === true };
}

/** Bind the socket, spawn `yoqa-ax` inside the simulator, and wait for it to connect back. */
export async function startYoqaAx(udid: string, options: StartYoqaAxOptions): Promise<YoqaAx> {
	const path = socketPath(udid);
	const server: Server = createServer();
	const connected = new Promise<Socket>((resolve) => server.once("connection", resolve));
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(path, () => resolve());
	});

	const proc = (options.spawn ?? spawnProcess)([
		"xcrun",
		"simctl",
		"spawn",
		udid,
		options.bin,
		"--connect",
		path,
	]);

	let stopped = false;
	let client: ReturnType<typeof createClient> | null = null;
	const stop = async () => {
		if (stopped) return;
		stopped = true;
		client?.close("is stopped");
		server.close();
		rmSync(path, { force: true });
		// The helper exits once its socket closes; the kill is for one that never connected.
		const exited = await Promise.race([
			proc.exited.then(() => true),
			Bun.sleep(STOP_GRACE_MS).then(() => false),
		]);
		if (!exited) proc.kill("SIGKILL");
	};

	const timeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const outcome = await Promise.race([
		connected,
		proc.exited.then((code) => ({ exited: code })),
		new Promise<"timeout">((resolve) => {
			timer = setTimeout(() => resolve("timeout"), timeoutMs);
		}),
	]).finally(() => clearTimeout(timer));

	if (outcome === "timeout" || "exited" in outcome) {
		if (outcome === "timeout") proc.kill("SIGTERM");
		await stop();
		throw new Error(
			outcome === "timeout"
				? `yoqa-ax did not connect within ${timeoutMs} ms`
				: `yoqa-ax exited (${outcome.exited}) before connecting`,
		);
	}

	// One helper per session: nobody else may connect to this socket.
	server.close();
	const connection = createClient(outcome, options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS);
	client = connection;
	const ax: YoqaAx = {
		ping: async () => {
			const result = await connection.request("ping");
			if (result !== "ok") throw new Error(`yoqa-ax ping answered ${JSON.stringify(result)}`);
			return "ok";
		},
		describe: async () => parseTree(await connection.request("describe")),
		stop,
	};
	try {
		await ax.ping();
	} catch (error) {
		await stop();
		throw error;
	}
	return ax;
}
