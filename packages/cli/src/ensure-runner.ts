import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir as osHomedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_RUNNER_HOST = "127.0.0.1";
export const DEFAULT_RUNNER_PORT = 7420;
export const HEALTH_POLL_MS = 400;
export const HEALTH_TIMEOUT_MS = 20_000;

export type RunnerHealth = {
	ok: true;
	service: "yoqa-runner";
	version: string;
};

export type RunnerLaunchSource = "env" | "path" | "packaged" | "monorepo" | "package";

export type RunnerLaunch = {
	command: string[];
	cwd?: string;
	source: RunnerLaunchSource;
};

export type SpawnedRunner = {
	pid: number;
};

export type ForegroundRunner = {
	pid: number;
	exited: Promise<number>;
};

export type ResolveLaunchDeps = {
	env: NodeJS.ProcessEnv;
	cwd: string;
	execPath: string;
	argv0: string;
	homedir: string;
	fromUrl: string;
	pathExists: (path: string) => Promise<boolean>;
	which: (bin: string) => Promise<string | null>;
	findBun: () => Promise<string | null>;
	resolvePackageEntry: () => Promise<string | null>;
};

export type EnsureRunnerDeps = ResolveLaunchDeps & {
	fetchHealth: (baseUrl: string) => Promise<RunnerHealth | null>;
	spawnDetached: (launch: RunnerLaunch, env: NodeJS.ProcessEnv) => SpawnedRunner;
	spawnForeground: (launch: RunnerLaunch, env: NodeJS.ProcessEnv) => ForegroundRunner;
	writePid: (pid: number) => Promise<void>;
	readPid: () => Promise<number | null>;
	removePid: () => Promise<void>;
	isPidAlive: (pid: number) => boolean;
	killPid: (pid: number, signal?: NodeJS.Signals) => void;
	sleep: (ms: number) => Promise<void>;
	now: () => number;
	log: (message: string) => void;
};

export class RunnerStartError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RunnerStartError";
	}
}

export function runnerBaseUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
	const fromUrl = env.YOQA_RUNNER_URL?.trim();
	if (fromUrl) return fromUrl.replace(/\/$/, "");
	const host = env.YOQA_RUNNER_HOST ?? DEFAULT_RUNNER_HOST;
	const port = Number(env.YOQA_RUNNER_PORT ?? String(DEFAULT_RUNNER_PORT));
	if (!Number.isFinite(port) || port <= 0) {
		throw new Error("YOQA_RUNNER_PORT must be a positive number");
	}
	return `http://${host}:${port}`;
}

export function shouldSkipAutostart(env: NodeJS.ProcessEnv = process.env): boolean {
	const raw = env.YOQA_NO_AUTOSTART?.trim().toLowerCase();
	return raw === "1" || raw === "true" || raw === "yes";
}

export function isRunnerHealth(value: unknown): value is RunnerHealth {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	return (
		record.ok === true &&
		record.service === "yoqa-runner" &&
		typeof record.version === "string" &&
		record.version.length > 0
	);
}

export function execRootsFrom(execPath: string, argv0: string): string[] {
	const roots: string[] = [];
	for (const candidate of [execPath, argv0]) {
		if (!candidate) continue;
		const dir = dirname(candidate);
		if (!roots.includes(dir)) roots.push(dir);
	}
	return roots;
}

/** Candidate locations for a compiled yoqa-runner inside a packaged Electrobun .app. */
export function packagedYoqaRunnerCandidates(roots: string[]): string[] {
	const fileName = "yoqa-runner";
	const paths: string[] = [];
	for (const root of roots) {
		paths.push(
			join(root, fileName),
			join(root, "../Resources/app.asar.unpacked/runner", fileName),
			join(root, "../Resources/runner", fileName),
			join(root, "Resources/app.asar.unpacked/runner", fileName),
			join(root, "Resources/runner", fileName),
		);
	}
	return paths;
}

export function yoqaRoot(homedir: string): string {
	return join(homedir, ".yoqa");
}

export function runnerPidPath(homedir: string): string {
	return join(yoqaRoot(homedir), "runner.pid");
}

export const BUN_MISSING_MESSAGE =
	"Could not find Bun, which is required to start the Yoqa runner.\nInstall: https://bun.sh  (curl -fsSL https://bun.sh/install | bash)\nOr set YOQA_RUNNER_BIN to a yoqa-runner binary.";

export const RUNNER_NOT_FOUND_MESSAGE =
	"Could not locate the Yoqa runner. Install @yoqa/cli (includes @yoqa/runner) and Bun, or set YOQA_RUNNER_BIN.";

const REPO_MARKER = join("services", "runner", "src", "index.ts");

export async function findRepoRoot(
	starts: string[],
	pathExists: (path: string) => Promise<boolean>,
): Promise<string | null> {
	for (const start of starts) {
		if (!start) continue;
		let dir = start;
		for (let i = 0; i < 14; i++) {
			if (await pathExists(join(dir, REPO_MARKER))) return dir;
			const parent = dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
	}
	return null;
}

export async function resolvePublishedRunnerEntry(fromUrl: string): Promise<string | null> {
	try {
		const require = createRequire(fromUrl);
		const pkgJson = require.resolve("@yoqa/runner/package.json");
		return join(dirname(pkgJson), "dist", "index.js");
	} catch {
		return null;
	}
}

export async function resolveRunnerLaunch(deps: ResolveLaunchDeps): Promise<RunnerLaunch> {
	const binEnv = deps.env.YOQA_RUNNER_BIN?.trim();
	if (binEnv && (await deps.pathExists(binEnv))) {
		return { command: [binEnv], source: "env" };
	}

	const onPath = await deps.which("yoqa-runner");
	if (onPath) {
		return { command: [onPath], source: "path" };
	}

	const packagedCandidates = packagedYoqaRunnerCandidates(execRootsFrom(deps.execPath, deps.argv0));
	for (const candidate of packagedCandidates) {
		if (await deps.pathExists(candidate)) {
			return { command: [candidate], source: "packaged" };
		}
	}

	const fromPath = fileURLToPath(deps.fromUrl);
	const repoRoot = await findRepoRoot(
		[deps.env.YOQA_REPO_ROOT?.trim() ?? "", deps.cwd, dirname(fromPath)],
		deps.pathExists,
	);
	if (repoRoot) {
		const bun = await deps.findBun();
		if (!bun) throw new RunnerStartError(BUN_MISSING_MESSAGE);
		const entry = join(repoRoot, REPO_MARKER);
		return {
			command: [bun, "run", entry],
			cwd: join(repoRoot, "services", "runner"),
			source: "monorepo",
		};
	}

	const pkgEntry = await deps.resolvePackageEntry();
	if (pkgEntry && (await deps.pathExists(pkgEntry))) {
		const bun = await deps.findBun();
		if (!bun) throw new RunnerStartError(BUN_MISSING_MESSAGE);
		return { command: [bun, pkgEntry], source: "package" };
	}

	throw new RunnerStartError(RUNNER_NOT_FOUND_MESSAGE);
}

export async function fetchRunnerHealth(
	baseUrl: string,
	timeoutMs = 1500,
): Promise<RunnerHealth | null> {
	try {
		const response = await fetch(`${baseUrl.replace(/\/$/, "")}/health`, {
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (!response.ok) return null;
		const json: unknown = await response.json();
		return isRunnerHealth(json) ? json : null;
	} catch {
		return null;
	}
}

export async function waitForRunnerHealth(
	fetchHealth: () => Promise<RunnerHealth | null>,
	options: {
		timeoutMs: number;
		intervalMs: number;
		sleep: (ms: number) => Promise<void>;
		now: () => number;
		isAlive?: () => boolean;
	},
): Promise<RunnerHealth | null> {
	const deadline = options.now() + options.timeoutMs;
	while (options.now() < deadline) {
		const health = await fetchHealth();
		if (health) return health;
		if (options.isAlive && !options.isAlive()) return null;
		await options.sleep(options.intervalMs);
	}
	return fetchHealth();
}

function pathWithHostTools(env: NodeJS.ProcessEnv, homedir: string): string {
	const extras = [
		"/opt/homebrew/bin",
		"/opt/homebrew/sbin",
		"/usr/local/bin",
		join(homedir, ".local", "bin"),
		join(homedir, ".bun", "bin"),
	];
	const existing = (env.PATH ?? "").split(":").filter(Boolean);
	const prepend = extras.filter((dir) => !existing.includes(dir));
	return [...prepend, ...existing].join(":");
}

async function defaultPathExists(path: string): Promise<boolean> {
	return existsSync(path);
}

async function defaultWhich(bin: string): Promise<string | null> {
	const { execFile } = await import("node:child_process");
	return new Promise((resolve) => {
		execFile("which", [bin], (error, stdout) => {
			if (error) {
				resolve(null);
				return;
			}
			const path = stdout.trim().split("\n")[0]?.trim();
			resolve(path || null);
		});
	});
}

async function defaultFindBun(
	pathExists: (path: string) => Promise<boolean>,
	which: (bin: string) => Promise<string | null>,
	homedir: string,
	env: NodeJS.ProcessEnv,
): Promise<string | null> {
	const fromEnv = env.BUN_INSTALL ? join(env.BUN_INSTALL, "bin", "bun") : null;
	const candidates = [
		fromEnv,
		join(homedir, ".bun", "bin", "bun"),
		"/opt/homebrew/bin/bun",
		"/usr/local/bin/bun",
	].filter((path): path is string => Boolean(path));
	for (const candidate of candidates) {
		if (await pathExists(candidate)) return candidate;
	}
	return which("bun");
}

function defaultIsPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function spawnEnv(env: NodeJS.ProcessEnv, homedir: string): NodeJS.ProcessEnv {
	return {
		...env,
		PATH: pathWithHostTools(env, homedir),
		YOQA_RUNNER_HOST: env.YOQA_RUNNER_HOST ?? DEFAULT_RUNNER_HOST,
		YOQA_RUNNER_PORT: env.YOQA_RUNNER_PORT ?? String(DEFAULT_RUNNER_PORT),
	};
}

function defaultSpawnDetached(
	launch: RunnerLaunch,
	env: NodeJS.ProcessEnv,
	homedir: string,
): SpawnedRunner {
	const [bin, ...args] = launch.command;
	if (!bin) throw new RunnerStartError("Runner launch command is empty");
	const child = spawn(bin, args, {
		cwd: launch.cwd,
		detached: true,
		stdio: "ignore",
		env: spawnEnv(env, homedir),
	});
	if (child.pid == null) {
		throw new RunnerStartError("Failed to spawn the Yoqa runner");
	}
	child.unref();
	return { pid: child.pid };
}

function defaultSpawnForeground(
	launch: RunnerLaunch,
	env: NodeJS.ProcessEnv,
	homedir: string,
): ForegroundRunner {
	const [bin, ...args] = launch.command;
	if (!bin) throw new RunnerStartError("Runner launch command is empty");
	const child = spawn(bin, args, {
		cwd: launch.cwd,
		stdio: "inherit",
		env: spawnEnv(env, homedir),
	});
	if (child.pid == null) {
		throw new RunnerStartError("Failed to spawn the Yoqa runner");
	}

	const forward = (signal: NodeJS.Signals) => {
		try {
			child.kill(signal);
		} catch {
			/* already gone */
		}
	};
	process.on("SIGINT", forward);
	process.on("SIGTERM", forward);

	const exited = new Promise<number>((resolve, reject) => {
		child.on("error", (error) => {
			process.off("SIGINT", forward);
			process.off("SIGTERM", forward);
			if ("code" in error && error.code === "ENOENT") {
				reject(new RunnerStartError(BUN_MISSING_MESSAGE));
				return;
			}
			reject(error);
		});
		child.on("exit", (code, signal) => {
			process.off("SIGINT", forward);
			process.off("SIGTERM", forward);
			if (signal) {
				resolve(1);
				return;
			}
			resolve(code ?? 1);
		});
	});

	return { pid: child.pid, exited };
}

async function defaultWritePid(homedir: string, pid: number): Promise<void> {
	const dir = yoqaRoot(homedir);
	await mkdir(dir, { recursive: true });
	await writeFile(runnerPidPath(homedir), `${pid}\n`, "utf8");
}

async function defaultReadPid(homedir: string): Promise<number | null> {
	try {
		const raw = (await readFile(runnerPidPath(homedir), "utf8")).trim();
		const pid = Number(raw);
		return Number.isInteger(pid) && pid > 0 ? pid : null;
	} catch {
		return null;
	}
}

async function defaultRemovePid(homedir: string): Promise<void> {
	try {
		await unlink(runnerPidPath(homedir));
	} catch {
		/* missing is fine */
	}
}

export function createDefaultEnsureDeps(
	overrides: Partial<EnsureRunnerDeps> = {},
): EnsureRunnerDeps {
	const env = overrides.env ?? process.env;
	const homedir = overrides.homedir ?? osHomedir();
	const pathExists = overrides.pathExists ?? defaultPathExists;
	const which = overrides.which ?? defaultWhich;
	const fromUrl = overrides.fromUrl ?? import.meta.url;

	return {
		env,
		cwd: overrides.cwd ?? process.cwd(),
		execPath: overrides.execPath ?? process.execPath,
		argv0: overrides.argv0 ?? process.argv0,
		homedir,
		fromUrl,
		pathExists,
		which,
		findBun: overrides.findBun ?? (() => defaultFindBun(pathExists, which, homedir, env)),
		resolvePackageEntry:
			overrides.resolvePackageEntry ?? (() => resolvePublishedRunnerEntry(fromUrl)),
		fetchHealth: overrides.fetchHealth ?? ((baseUrl) => fetchRunnerHealth(baseUrl)),
		spawnDetached:
			overrides.spawnDetached ??
			((launch, spawnProcessEnv) => defaultSpawnDetached(launch, spawnProcessEnv, homedir)),
		spawnForeground:
			overrides.spawnForeground ??
			((launch, spawnProcessEnv) => defaultSpawnForeground(launch, spawnProcessEnv, homedir)),
		writePid: overrides.writePid ?? ((pid) => defaultWritePid(homedir, pid)),
		readPid: overrides.readPid ?? (() => defaultReadPid(homedir)),
		removePid: overrides.removePid ?? (() => defaultRemovePid(homedir)),
		isPidAlive: overrides.isPidAlive ?? defaultIsPidAlive,
		killPid:
			overrides.killPid ??
			((pid, signal = "SIGTERM") => {
				process.kill(pid, signal);
			}),
		sleep: overrides.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
		now: overrides.now ?? (() => Date.now()),
		log: overrides.log ?? ((message) => console.error(message)),
	};
}

export type EnsureRunnerResult = {
	baseUrl: string;
	started: boolean;
	source?: RunnerLaunchSource;
	pid?: number;
};

export async function ensureRunner(options?: {
	mode?: "detached" | "foreground";
	baseUrl?: string;
	deps?: Partial<EnsureRunnerDeps>;
}): Promise<EnsureRunnerResult> {
	const mode = options?.mode ?? "detached";
	const deps = createDefaultEnsureDeps(options?.deps);
	const baseUrl = options?.baseUrl ?? runnerBaseUrlFromEnv(deps.env);

	const existing = await deps.fetchHealth(baseUrl);
	if (existing) {
		return { baseUrl, started: false };
	}

	const launch = await resolveRunnerLaunch(deps);
	deps.log(`yoqa: starting runner (${launch.source}) → ${baseUrl}`);

	if (mode === "foreground") {
		const child = deps.spawnForeground(launch, deps.env);
		await deps.writePid(child.pid);
		const code = await child.exited;
		await deps.removePid();
		if (code !== 0) {
			throw new RunnerStartError(`Runner exited with code ${code}`);
		}
		return { baseUrl, started: true, source: launch.source, pid: child.pid };
	}

	const spawned = deps.spawnDetached(launch, deps.env);
	await deps.writePid(spawned.pid);
	const health = await waitForRunnerHealth(() => deps.fetchHealth(baseUrl), {
		timeoutMs: HEALTH_TIMEOUT_MS,
		intervalMs: HEALTH_POLL_MS,
		sleep: deps.sleep,
		now: deps.now,
		isAlive: () => deps.isPidAlive(spawned.pid),
	});
	if (!health) {
		try {
			deps.killPid(spawned.pid);
		} catch {
			/* already gone */
		}
		await deps.removePid();
		throw new RunnerStartError(`Local runner failed to start at ${baseUrl}. Try: yoqa serve`);
	}
	return { baseUrl, started: true, source: launch.source, pid: spawned.pid };
}

export async function stopOwnedRunner(
	depsPartial: Partial<EnsureRunnerDeps> = {},
): Promise<{ ok: boolean; message: string }> {
	const deps = createDefaultEnsureDeps(depsPartial);
	const pid = await deps.readPid();
	if (pid == null) {
		return { ok: true, message: "No yoqa-owned runner pid file" };
	}
	if (!deps.isPidAlive(pid)) {
		await deps.removePid();
		return { ok: true, message: `Stale pid ${pid} removed` };
	}
	try {
		deps.killPid(pid, "SIGTERM");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, message: `Failed to stop pid ${pid}: ${message}` };
	}
	await deps.removePid();
	return { ok: true, message: `Stopped runner pid ${pid}` };
}

export function commandChainIncludes(
	command: { name: () => string; parent?: unknown } | null | undefined,
	name: string,
): boolean {
	let current: { name: () => string; parent?: unknown } | null | undefined = command;
	while (current && typeof current.name === "function") {
		if (current.name() === name) return true;
		current = current.parent as { name: () => string; parent?: unknown } | undefined;
	}
	return false;
}
