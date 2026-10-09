/**
 * `yoqa-sim` (source in `native/yoqa-sim`): our resident macOS process for one booted
 * iOS simulator. The iOS-simulator Direct lane spawns it on first use and kills it on quit.
 * It binds loopback only and announces itself with `api_ready http://127.0.0.1:<port>`.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

/** The latest simulator frame. `hash` changes exactly when the screen's pixels do. */
export type YoqaSimFrame = {
	bytes: Uint8Array;
	mime: "image/png" | "image/jpeg";
	hash?: string;
};

/** A point on the simulator screen as fractions of its width and height (0.0–1.0). */
export type ScreenFraction = { x: number; y: number };

/** The hardware keys `yoqa-sim` can press. */
export type YoqaSimKey = "home";

/**
 * A running `yoqa-sim` for one simulator. Coordinates are 0.0–1.0, never 0–1000: the
 * Lane converts at its edge. Each input call resolves once the touch is up.
 */
export type YoqaSim = {
	/** Its control API, from the `api_ready` line. */
	url: string;
	/** The latest frame, full size, as PNG. Not a fresh capture. */
	frame: () => Promise<YoqaSimFrame>;
	/** Down, hold (`holdMs`, 16 ms by default and never less), up. */
	tap: (x: number, y: number, holdMs?: number) => Promise<void>;
	swipe: (from: ScreenFraction, to: ScreenFraction, durationMs?: number) => Promise<void>;
	key: (key: YoqaSimKey) => Promise<void>;
	/** Kill it. Safe to call twice. */
	stop: () => Promise<void>;
};

/**
 * `yoqa-sim` could not be reached, so the call did nothing on the simulator and can safely
 * be done another way. Any other failure may have touched the screen already.
 */
export class YoqaSimUnreachableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "YoqaSimUnreachableError";
	}
}

/** Spawns `yoqa-sim` for a simulator UDID and resolves once it printed `api_ready`. */
export type SpawnYoqaSim = (udid: string) => Promise<YoqaSim>;

/** The spawned `yoqa-sim` process, as `spawnYoqaSim` uses it. */
export type YoqaSimProcess = {
	stdout: ReadableStream<Uint8Array>;
	stderr: ReadableStream<Uint8Array>;
	exited: Promise<number>;
	kill: (signal?: NodeJS.Signals) => void;
};

/**
 * Its stdin stays open as a lifeline: if the runner dies, the pipe closes and `yoqa-sim`
 * exits on its own.
 */
function spawnProcess(command: string[]): YoqaSimProcess {
	return Bun.spawn(command, { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
}

export type SpawnYoqaSimOptions = {
	/** The `yoqa-sim` command (binary plus any leading args). */
	command: string[];
	/** A non-default CoreSimulator device set (`--device-set`). */
	deviceSet?: string;
	readyTimeoutMs?: number;
	spawn?: (command: string[]) => YoqaSimProcess;
};

const READY_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 10_000;
const STOP_GRACE_MS = 2_000;
const API_READY_RE = /^api_ready (http:\/\/127\.0\.0\.1:\d+)\s*$/;

/** `YOQA_SIM_BIN`, else the binary built from `native/yoqa-sim`, else null. */
export function resolveYoqaSimBin(): string | null {
	const fromEnv = process.env.YOQA_SIM_BIN?.trim();
	if (fromEnv) return fromEnv;
	const root = join(import.meta.dir, "../../../../../native/yoqa-sim/.build");
	for (const config of ["release", "debug"]) {
		const built = join(root, config, "yoqa-sim");
		if (existsSync(built)) return built;
	}
	return null;
}

/** Resolve on the first `api_ready` line, then keep draining stdout so the pipe never fills. */
async function readApiReady(stdout: ReadableStream<Uint8Array>): Promise<string | null> {
	const reader = stdout.getReader();
	const decoder = new TextDecoder();
	let buffered = "";
	while (true) {
		const { value, done } = await reader.read();
		if (done) return null;
		buffered += decoder.decode(value, { stream: true });
		const lines = buffered.split("\n");
		buffered = lines.pop() ?? "";
		for (const line of lines) {
			const url = line.match(API_READY_RE)?.[1];
			if (url) {
				void (async () => {
					while (!(await reader.read()).done) {}
				})().catch(() => undefined);
				return url;
			}
		}
	}
}

/** Spawn `yoqa-sim ios --id <udid>` and wait for its `api_ready` line. */
export async function spawnYoqaSim(udid: string, options: SpawnYoqaSimOptions): Promise<YoqaSim> {
	const proc = (options.spawn ?? spawnProcess)([
		...options.command,
		"ios",
		"--id",
		udid,
		...(options.deviceSet ? ["--device-set", options.deviceSet] : []),
	]);
	const stderr = new Response(proc.stderr).text();

	let stopped = false;
	const stop = async () => {
		if (stopped) return;
		stopped = true;
		proc.kill("SIGTERM");
		const exited = await Promise.race([
			proc.exited.then(() => true),
			Bun.sleep(STOP_GRACE_MS).then(() => false),
		]);
		if (!exited) proc.kill("SIGKILL");
	};

	const timeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const url = await Promise.race([
		readApiReady(proc.stdout),
		new Promise<"timeout">((resolve) => {
			timer = setTimeout(() => resolve("timeout"), timeoutMs);
		}),
	]).finally(() => clearTimeout(timer));

	if (url === "timeout") {
		await stop();
		throw new Error(`yoqa-sim printed no api_ready within ${timeoutMs} ms`);
	}
	if (!url) {
		const code = await proc.exited;
		const detail = (await stderr).trim().split("\n").slice(-3).join(" ");
		stopped = true;
		throw new Error(`yoqa-sim exited (${code}) before api_ready${detail ? `: ${detail}` : ""}`);
	}

	const send = (path: string, body?: Record<string, unknown>) =>
		fetch(`${url}${path}`, {
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			...(body
				? {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
					}
				: {}),
		});

	const request = async (label: string, path: string, body?: Record<string, unknown>) => {
		const response = await send(path, body).catch((error: unknown) => {
			// A timed-out request may still have reached the simulator; a refused one did not.
			if (error instanceof Error && error.name === "TimeoutError") throw error;
			throw new YoqaSimUnreachableError(
				`yoqa-sim ${label}: ${error instanceof Error ? error.message : String(error)}`,
			);
		});
		if (!response.ok) {
			throw new Error(`yoqa-sim ${label}: ${response.status} ${(await response.text()).trim()}`);
		}
		return response;
	};

	return {
		url,
		frame: async () => {
			const response = await request("screenshot", "/screenshot?scale=1&format=png");
			const hash = response.headers.get("x-frame-hash");
			return {
				bytes: new Uint8Array(await response.arrayBuffer()),
				mime: "image/png",
				...(hash ? { hash } : {}),
			};
		},
		tap: async (x, y, holdMs) => {
			await request("tap", "/tap", { x, y, ...(holdMs === undefined ? {} : { holdMs }) });
		},
		swipe: async (from, to, durationMs) => {
			await request("swipe", "/swipe", {
				fromX: from.x,
				fromY: from.y,
				toX: to.x,
				toY: to.y,
				...(durationMs === undefined ? {} : { durationMs }),
			});
		},
		key: async (key) => {
			await request("key", "/key", { key });
		},
		stop,
	};
}
