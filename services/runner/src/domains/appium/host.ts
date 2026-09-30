import { mkdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { androidProcessEnv, ensureAndroidSdkEnv } from "./android-sdk";
import { ensureHostToolPath } from "./host-path";

export const APPIUM_HOST = process.env.YOQA_APPIUM_HOST ?? "127.0.0.1";
export const DEFAULT_APPIUM_PORT = Number(process.env.YOQA_APPIUM_PORT ?? "4723");
export const APPIUM_PORT_SCAN_COUNT = 21;

export type CommandResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
};

export type SpawnedProcess = {
	pid: number;
	readonly exitCode: number | null;
	exited: Promise<number>;
	kill(): void;
};

/** System boundary for Appium Runtime: processes, files, and the listen probe. */
export type RuntimeHost = {
	run(
		command: string[],
		options?: { env?: Record<string, string>; cwd?: string },
	): Promise<CommandResult>;
	exists(path: string): Promise<boolean>;
	readText(path: string): Promise<string | null>;
	writeText(path: string, contents: string): Promise<void>;
	mkdir(path: string): Promise<void>;
	listNodeBins(roots: string[]): Promise<string[]>;
	portFree(port: number): Promise<boolean>;
	httpOk(url: string): Promise<boolean>;
	listeners(port: number): Promise<number[]>;
	spawn(
		command: string[],
		options?: { env?: Record<string, string>; cwd?: string },
	): SpawnedProcess;
};

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

export const bunHost: RuntimeHost = {
	async run(command, options) {
		ensureHostToolPath();
		try {
			const proc = Bun.spawn(command, {
				cwd: options?.cwd,
				env: options?.env ? { ...process.env, ...options.env } : process.env,
				stdout: "pipe",
				stderr: "pipe",
			});
			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);
			return { stdout, stderr, exitCode };
		} catch {
			return { stdout: "", stderr: `failed to spawn: ${command[0]}`, exitCode: 127 };
		}
	},

	exists: pathExists,

	async readText(path) {
		try {
			const file = Bun.file(path);
			if (!(await file.exists())) return null;
			return await file.text();
		} catch {
			return null;
		}
	},

	async writeText(path, contents) {
		await writeFile(path, contents, "utf8");
	},

	async mkdir(path) {
		await mkdir(path, { recursive: true });
	},

	async listNodeBins(roots) {
		const found: string[] = [];
		for (const root of roots) {
			try {
				const entries = await Array.fromAsync(
					new Bun.Glob("*/bin/node").scan({ cwd: root, absolute: true }),
				);
				found.push(...entries);
			} catch {
				// directory may not exist
			}
		}
		return found;
	},

	portFree(port) {
		return new Promise((resolve) => {
			const server = createServer();
			server.unref();
			server.once("error", () => resolve(false));
			server.listen(port, APPIUM_HOST, () => {
				server.close(() => resolve(true));
			});
		});
	},

	async httpOk(url) {
		try {
			const response = await fetch(url);
			return response.ok;
		} catch {
			return false;
		}
	},

	async listeners(port) {
		const proc = Bun.spawn(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
			stdout: "pipe",
			stderr: "pipe",
			stdin: "ignore",
		});
		const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
		if (exitCode !== 0 && !stdout.trim()) return [];
		return [
			...new Set(
				stdout
					.split(/\s+/)
					.map((part) => part.trim())
					.filter(Boolean)
					.map((part) => Number(part))
					.filter((pid) => Number.isInteger(pid) && pid > 0),
			),
		];
	},

	spawn(command, options) {
		ensureAndroidSdkEnv();
		const proc = Bun.spawn(command, {
			cwd: options?.cwd,
			env: { ...androidProcessEnv(process.env), ...options?.env },
			stdout: "ignore",
			stderr: "ignore",
			stdin: "ignore",
		});
		return {
			pid: proc.pid ?? 0,
			get exitCode() {
				return proc.exitCode;
			},
			exited: proc.exited,
			kill() {
				proc.kill();
			},
		};
	},
};
