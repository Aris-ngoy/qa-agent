/**
 * `yoqa-sim` (source in `native/yoqa-sim`): our resident macOS process for one booted
 * iOS simulator. The iOS-simulator Direct lane spawns it on first use and kills it on quit.
 * It binds loopback only and announces itself with `api_ready http://127.0.0.1:<port>`.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

/** A running `yoqa-sim` for one simulator. */
export type YoqaSim = {
	/** Its control API, from the `api_ready` line. */
	url: string;
	/** A PNG of the simulator screen. */
	screenshot: () => Promise<Uint8Array>;
	/** Kill it. Safe to call twice. */
	stop: () => Promise<void>;
};

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
const SCREENSHOT_TIMEOUT_MS = 10_000;
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

	return {
		url,
		screenshot: async () => {
			const response = await fetch(`${url}/screenshot`, {
				signal: AbortSignal.timeout(SCREENSHOT_TIMEOUT_MS),
			});
			if (!response.ok) {
				throw new Error(
					`yoqa-sim screenshot: ${response.status} ${(await response.text()).trim()}`,
				);
			}
			return new Uint8Array(await response.arrayBuffer());
		},
		stop,
	};
}
