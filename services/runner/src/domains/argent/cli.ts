import { homedir } from "node:os";
import { join } from "node:path";
import { androidProcessEnv } from "../agent-device/android-sdk";
import { ensureHostToolPath } from "../agent-device/host-path";

/** Minimum Argent version Yoqa supports. */
export const MIN_ARGENT_VERSION = "0.25.0";

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

/** Error code when Argent must be installed before device control works. */
export const ARGENT_NOT_INSTALLED_CODE = "ARGENT_NOT_INSTALLED";

/** Error code when the caller must pass explicit install consent. */
export const ARGENT_CONSENT_REQUIRED_CODE = "CONSENT_REQUIRED";

const ARGENT_RUNNER_PATTERNS = [
	/no profiles for/i,
	/provisioning profile/i,
	/code signing/i,
	/ARGENT_IOS_TEAM_ID/i,
	/trust the developer/i,
	/VPN & Device Management/i,
];

/** True when the error means the Argent iOS runner must be built/trusted first. */
export function isArgentRunnerError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	const hint = error instanceof ArgentError ? (error.hint ?? "") : "";
	return ARGENT_RUNNER_PATTERNS.some((re) => re.test(message) || re.test(hint));
}

/** Error codes where the Argent transport session is gone and the caller must reconnect. */
const DEAD_SESSION_CODES = new Set([
	"SESSION_NOT_FOUND",
	"SESSION_EXPIRED",
	"DEVICE_LOST",
	"DEVICE_DISCONNECTED",
	"TRANSPORT_NOT_WIRED",
]);

export function isDeadArgentSessionError(error: unknown): boolean {
	if (error instanceof ArgentError) return DEAD_SESSION_CODES.has(error.code);
	const message = error instanceof Error ? error.message : String(error);
	return /no active session|session not found|session.+expired|device.+lost|transport.+not wired|not supported on/i.test(
		message,
	);
}

let cachedBin: string | null = null;

function candidateBins(): string[] {
	const home = homedir();
	const localBin = join(process.cwd(), "node_modules", ".bin", "argent");
	const runnerLocalBin = join(
		process.cwd(),
		"services",
		"runner",
		"node_modules",
		".bin",
		"argent",
	);
	return [
		localBin,
		runnerLocalBin,
		join(home, ".bun", "bin", "argent"),
		join(home, ".local", "bin", "argent"),
		"/opt/homebrew/bin/argent",
		"/usr/local/bin/argent",
	];
}

async function pathExists(path: string): Promise<boolean> {
	try {
		return await Bun.file(path).exists();
	} catch {
		return false;
	}
}

/** Resolve the Argent binary: workspace install first, then PATH. */
export async function resolveArgentBin(): Promise<string> {
	ensureHostToolPath();
	if (cachedBin) return cachedBin;
	for (const candidate of candidateBins()) {
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
		"Argent CLI not found. Install it with: npm install -g @swmansion/argent",
		"TOOL_MISSING",
		"Install Argent globally (splash prompts for consent), or add @swmansion/argent to services/runner dependencies and run bun install. See docs/devices/argent-license-guidelines.md.",
	);
}

/** Test-only: reset the cached binary path. */
export function resetArgentBinForTests(): void {
	cachedBin = null;
}

/**
 * Run one Argent CLI command and return stdout.
 * Unlike agent-device there is no `{success, data}` envelope — callers parse.
 */
export async function runArgentRaw(
	args: string[],
	options: { timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	ensureHostToolPath();
	const bin = await resolveArgentBin();
	const env = androidProcessEnv(process.env);
	const proc = Bun.spawn([bin, ...args], {
		env,
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
		if (timedOut) {
			throw new ArgentError(
				`argent ${args[0] ?? ""} timed out after ${timeoutMs}ms`,
				"TIMEOUT",
				"Retry with a booted simulator/emulator, or increase the timeout.",
			);
		}
		return { stdout, stderr, exitCode };
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Invoke an Argent tool via `argent run <tool>` and parse JSON output.
 * Tries `--json` flag first; falls back to raw stdout JSON parse.
 */
export async function runArgentTool<T = unknown>(
	tool: string,
	params: Record<string, unknown> = {},
	options: { timeoutMs?: number } = {},
): Promise<T> {
	const serialized = JSON.stringify(params);
	const attempts: string[][] = [
		["run", tool, "--json", serialized],
		["run", tool, serialized],
		["run", tool],
	];
	let lastError: unknown = null;
	for (const args of attempts) {
		try {
			const { stdout, stderr, exitCode } = await runArgentRaw(args, options);
			const raw = stdout.trim() || stderr.trim();
			if (exitCode !== 0 && !raw) {
				throw new ArgentError(
					`argent ${tool} failed (exit ${exitCode}): ${(stderr || stdout).trim().slice(0, 500) || "unknown error"}`,
					"COMMAND_FAILED",
				);
			}
			try {
				return JSON.parse(raw || "null") as T;
			} catch {
				if (exitCode !== 0) {
					throw new ArgentError(
						`argent ${tool} failed (exit ${exitCode}): ${raw.slice(0, 500) || "unknown error"}`,
						"COMMAND_FAILED",
					);
				}
				return raw as unknown as T;
			}
		} catch (error) {
			lastError = error;
			if (
				error instanceof ArgentError &&
				(error.code === "TOOL_MISSING" || error.code === "TIMEOUT")
			) {
				throw error;
			}
		}
	}
	throw lastError instanceof Error
		? lastError
		: new ArgentError(`argent ${tool} failed`, "COMMAND_FAILED");
}

/** `argent --version` without tool invocation. */
export async function argentVersion(): Promise<string | null> {
	try {
		const bin = await resolveArgentBin();
		const proc = Bun.spawn([bin, "--version"], {
			env: androidProcessEnv(process.env),
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
