import { homedir } from "node:os";
import { join } from "node:path";

/** Minimum Argent version Yoqa supports (parity enumerated on 0.25.2). */
export const MIN_ARGENT_VERSION = "0.25.2";

/**
 * Global-install hint. Yoqa never vendors, bundles, decompiles, or
 * redistributes Argent's proprietary binaries (`bin/<platform>/simulator-server`,
 * `bin/darwin/ax-service`, `native-devtools-ios/*.dylib`) — the user installs
 * Argent themselves.
 */
export const ARGENT_INSTALL_HINT =
	"Install Argent globally with: npm install -g @swmansion/argent (or: npx @swmansion/argent@latest init). Yoqa never bundles Argent binaries.";

/** Telemetry stays opt-out — surface the escape hatch wherever we ask for an install. */
export const ARGENT_TELEMETRY_HINT =
	"Argent telemetry is opt-out: run `argent telemetry disable` to disable it.";

export class ArgentError extends Error {
	code: string;
	hint?: string;
	detail?: string;
	constructor(message: string, code = "COMMAND_FAILED", hint?: string, detail?: string) {
		super(message);
		this.name = "ArgentError";
		this.code = code;
		if (hint) this.hint = hint;
		if (detail) this.detail = detail;
	}
}

/**
 * Error codes where the Argent target/session is gone and the caller must
 * re-list and reconnect. Argent has no named sessions (and therefore no
 * DEVICE_IN_USE steal path) — dead means the device went away or the
 * tool-server is unreachable.
 */
const DEAD_SESSION_CODES = new Set([
	"SESSION_NOT_FOUND",
	"SESSION_EXPIRED",
	"DEVICE_NOT_FOUND",
	"DEVICE_LOST",
	"DEVICE_DISCONNECTED",
	"SERVER_UNREACHABLE",
]);

/**
 * "Target gone" message patterns — one source of truth shared by
 * `argentErrorFromStderr` (stderr → code) and the dead-session detector below.
 */
const DEVICE_NOT_FOUND_PATTERN = /device.+not found|no such device|unknown (device|udid)/i;
const DEVICE_LOST_PATTERN = /device.+(lost|disconnected)/i;
const SESSION_GONE_PATTERN = /session.+not found|session.+expired/i;
const SERVER_DOWN_PATTERN =
	/econnrefused|tool-server.*(not running|unreachable)|server.*not running/i;

const DEAD_MESSAGE_PATTERNS = [
	DEVICE_NOT_FOUND_PATTERN,
	DEVICE_LOST_PATTERN,
	SESSION_GONE_PATTERN,
	SERVER_DOWN_PATTERN,
];

/** True when the target is gone (or the tool-server is down) and the caller must reconnect. */
export function isDeadArgentSessionError(error: unknown): boolean {
	if (error instanceof ArgentError) return DEAD_SESSION_CODES.has(error.code);
	const message = error instanceof Error ? error.message : String(error);
	return DEAD_MESSAGE_PATTERNS.some((re) => re.test(message));
}

/**
 * Map `argent run` stderr (exit != 0, plain text — Argent has no JSON error
 * envelope) to an `ArgentError` with a stable code.
 */
export function argentErrorFromStderr(
	toolName: string,
	stderr: string,
	exitCode: number,
): ArgentError {
	const message = stderr.trim().slice(0, 500) || `argent ${toolName} failed (exit ${exitCode})`;
	if (/tool ".+" not found/i.test(message)) {
		return new ArgentError(
			message,
			"COMMAND_FAILED",
			"Run `argent tools` to list available tools.",
		);
	}
	if (DEVICE_NOT_FOUND_PATTERN.test(message)) {
		return new ArgentError(
			message,
			"DEVICE_NOT_FOUND",
			"Run `argent run list-devices` to pick a live target, then reconnect.",
		);
	}
	if (DEVICE_LOST_PATTERN.test(message)) {
		return new ArgentError(message, "DEVICE_DISCONNECTED", "Reconnect the device, then retry.");
	}
	if (SERVER_DOWN_PATTERN.test(message)) {
		return new ArgentError(
			message,
			"SERVER_UNREACHABLE",
			"Start the Argent tool-server with `argent server start`, then retry.",
		);
	}
	return new ArgentError(message, "COMMAND_FAILED");
}

/**
 * Global user-install locations only (spec: `npx @swmansion/argent@latest init`
 * / `npm install -g`) — never workspace `node_modules`. `resolveArgentBin`
 * falls back to `PATH` after these.
 */
export function argentCandidateBins(): string[] {
	const home = homedir();
	return [
		join(home, ".bun", "bin", "argent"),
		join(home, ".local", "bin", "argent"),
		"/opt/homebrew/bin/argent",
		"/usr/local/bin/argent",
	];
}

let cachedBin: string | null = null;

async function pathExists(path: string): Promise<boolean> {
	try {
		return await Bun.file(path).exists();
	} catch {
		return false;
	}
}

/** Resolve the argent binary: global user installs first, then PATH. */
export async function resolveArgentBin(): Promise<string> {
	if (cachedBin) return cachedBin;
	for (const candidate of argentCandidateBins()) {
		if (await pathExists(candidate)) {
			cachedBin = candidate;
			return candidate;
		}
	}
	const found = Bun.which("argent");
	if (found) {
		cachedBin = found;
		return found;
	}
	throw new ArgentError(
		`argent CLI not found. ${ARGENT_INSTALL_HINT} ${ARGENT_TELEMETRY_HINT}`,
		"TOOL_MISSING",
		ARGENT_INSTALL_HINT,
	);
}

/** Test-only: reset the cached binary path. */
export function resetArgentBinForTests(): void {
	cachedBin = null;
}

/**
 * Run an argv against an explicit binary and return parsed `--json` stdout.
 * Exported so non-`run` subcommands (`server status`) and tests share the
 * spawn/timeout/error path.
 */
export async function runArgentBin(
	bin: string,
	argv: string[],
	options: { timeoutMs?: number; label?: string } = {},
): Promise<unknown> {
	const label = options.label ?? argv[0] ?? "argent";
	const proc = Bun.spawn([bin, ...argv], {
		stdout: "pipe",
		stderr: "pipe",
		stdin: "ignore",
	});

	const timeoutMs = options.timeoutMs ?? 120_000;
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		try {
			proc.kill();
		} catch {
			// ignore
		}
	}, timeoutMs);

	try {
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		if (exitCode !== 0) {
			throw argentErrorFromStderr(label, stderr || stdout, exitCode);
		}
		const raw = stdout.trim();
		if (!raw) return raw;
		try {
			return JSON.parse(raw) as unknown;
		} catch {
			// Zero exit but not JSON — return raw text.
			return raw;
		}
	} catch (error) {
		if (timedOut) {
			throw new ArgentError(
				`argent ${label} timed out after ${timeoutMs}ms`,
				"TIMEOUT",
				"Retry with a booted simulator/emulator, or increase the timeout.",
			);
		}
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Run one Argent tool (`argent run <name> …`) and return its parsed JSON result.
 * Unlike the previous backend there is no `{success, data|error}` envelope — stdout is
 * the tool result and failures arrive on stderr with a non-zero exit.
 *
 * Test seam: `setRunArgentToolForTests` installs a process-global override
 * consulted first. `mock.module("./cli")` writes to Bun's process-global mock
 * registry with no per-file teardown on 1.2.x, so top-level module mocks leak
 * across test files in one `bun test` run (Linux CI load order hits it first,
 * macOS APFS order hides it). The seam is installed in `beforeEach` (test-run
 * time, sequential) instead of at import time, so each file's tests see their
 * own stub regardless of file load order. Always `resetRunArgentToolForTests`
 * in `afterAll`/`afterEach`.
 */
let runArgentToolOverride: ((toolName: string, args: string[]) => Promise<unknown>) | null = null;

/** Test-only: install (or clear with `null`) the `runArgentTool` stub. */
export function setRunArgentToolForTests(
	fn: ((toolName: string, args: string[]) => Promise<unknown>) | null,
): void {
	runArgentToolOverride = fn;
}

/** Test-only: drop any `runArgentTool` stub so later files hit the real backend. */
export function resetRunArgentToolForTests(): void {
	runArgentToolOverride = null;
}

export async function runArgentTool(
	toolName: string,
	args: string[] = [],
	options: { timeoutMs?: number; bin?: string } = {},
): Promise<unknown> {
	if (runArgentToolOverride) return runArgentToolOverride(toolName, [...args]);
	const bin = options.bin ?? (await resolveArgentBin());
	return runArgentBin(bin, ["run", toolName, ...args, "--json"], {
		timeoutMs: options.timeoutMs,
		label: toolName,
	});
}

export type ArgentServerStatus = {
	running: boolean;
	port?: number;
	pid?: number;
	version?: string;
	healthy?: boolean;
	[key: string]: unknown;
};

/** `argent server status --json` — throws `ArgentError` when the server is down. */
export async function argentServerStatus(
	options: { timeoutMs?: number; bin?: string } = {},
): Promise<ArgentServerStatus> {
	const bin = options.bin ?? (await resolveArgentBin());
	const data = (await runArgentBin(bin, ["server", "status", "--json"], {
		timeoutMs: options.timeoutMs ?? 15_000,
		label: "server status",
	})) as ArgentServerStatus;
	if (data && typeof data === "object" && "running" in data) return data;
	throw new ArgentError(
		"Argent tool-server is not running",
		"SERVER_UNREACHABLE",
		"Start the Argent tool-server with `argent server start`, then retry.",
	);
}

/** `argent --version` without JSON. */
export async function argentVersion(): Promise<string | null> {
	try {
		const bin = await resolveArgentBin();
		const proc = Bun.spawn([bin, "--version"], {
			stdout: "pipe",
			stderr: "pipe",
			stdin: "ignore",
		});
		const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
		if (exitCode !== 0) return null;
		const version = stdout.trim().split("\n")[0]?.trim();
		return version || null;
	} catch {
		return null;
	}
}

function parseVersionTuple(version: string): [number, number, number] | null {
	const match = version.trim().match(/(\d+)\.(\d+)\.(\d+)/);
	if (!match) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True when `version` satisfies the minimum supported Argent release. */
export function isSupportedArgentVersion(version: string): boolean {
	const actual = parseVersionTuple(version);
	const minimum = parseVersionTuple(MIN_ARGENT_VERSION);
	if (!actual || !minimum) return false;
	for (let i = 0; i < 3; i++) {
		if (actual[i] !== minimum[i]) return (actual[i] ?? 0) > (minimum[i] ?? 0);
	}
	return true;
}
