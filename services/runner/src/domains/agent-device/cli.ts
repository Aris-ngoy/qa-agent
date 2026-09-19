import { homedir } from "node:os";
import { join } from "node:path";
import { androidProcessEnv } from "./android-sdk";
import { withDesktopIosSigningEnv } from "./desktop-settings";
import {
	DEVELOPER_MODE_DISABLED_CODE,
	developerModeRepairHint,
	isDeveloperModeDisabledText,
} from "./developer-mode";
import { ensureHostToolPath } from "./host-path";

/** Minimum agent-device version Yoqa supports. */
export const MIN_AGENT_DEVICE_VERSION = "0.21.0";

export class AgentDeviceError extends Error {
	code: string;
	hint?: string;
	detail?: string;
	constructor(message: string, code = "COMMAND_FAILED", hint?: string, detail?: string) {
		super(message);
		this.name = "AgentDeviceError";
		this.code = code;
		if (hint) this.hint = hint;
		if (detail) this.detail = detail;
	}
}

/** Error codes where the agent-device session is gone and the caller must reconnect. */
const DEAD_SESSION_CODES = new Set([
	"SESSION_NOT_FOUND",
	"SESSION_EXPIRED",
	"DEVICE_LOST",
	"DEVICE_DISCONNECTED",
]);

export function isDeadAgentDeviceSessionError(error: unknown): boolean {
	if (error instanceof AgentDeviceError) return DEAD_SESSION_CODES.has(error.code);
	const message = error instanceof Error ? error.message : String(error);
	return /no active session|session not found|session.+expired|device.+lost/i.test(message);
}

/** Deterministic agent-device session name for one Yoqa device id. */
export function agentDeviceSessionName(deviceId: string): string {
	const slug =
		deviceId
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 40) || "device";
	return `yoqa-${slug}`;
}

let cachedBin: string | null = null;

function candidateBins(): string[] {
	const home = homedir();
	const localBin = join(process.cwd(), "node_modules", ".bin", "agent-device");
	const runnerLocalBin = join(
		process.cwd(),
		"services",
		"runner",
		"node_modules",
		".bin",
		"agent-device",
	);
	return [
		localBin,
		runnerLocalBin,
		join(home, ".bun", "bin", "agent-device"),
		join(home, ".local", "bin", "agent-device"),
		"/opt/homebrew/bin/agent-device",
		"/usr/local/bin/agent-device",
	];
}

async function pathExists(path: string): Promise<boolean> {
	try {
		return await Bun.file(path).exists();
	} catch {
		return false;
	}
}

/** Resolve the agent-device binary: workspace install first, then PATH. */
export async function resolveAgentDeviceBin(): Promise<string> {
	ensureHostToolPath();
	if (cachedBin) return cachedBin;
	for (const candidate of candidateBins()) {
		if (await pathExists(candidate)) {
			cachedBin = candidate;
			return candidate;
		}
	}
	const found = Bun.which("agent-device");
	if (found) {
		cachedBin = found;
		return found;
	}
	throw new AgentDeviceError(
		"agent-device CLI not found. Install it with: npm install -g agent-device@latest",
		"TOOL_MISSING",
		"Install agent-device globally, or add it to services/runner dependencies and run bun install.",
	);
}

/** Test-only: reset the cached binary path. */
export function resetAgentDeviceBinForTests(): void {
	cachedBin = null;
}

type AgentDeviceEnvelope =
	| { success: true; data: unknown }
	| {
			success: false;
			error: { code?: string; message?: string; hint?: string; details?: unknown };
	  };

/** Map an agent-device `{success:false}` envelope error to an `AgentDeviceError`. */
export function agentDeviceErrorFromEnvelope(envelopeError: {
	code?: string;
	message?: string;
	hint?: string;
	details?: unknown;
}): AgentDeviceError {
	const message = envelopeError.message?.trim() || "agent-device command failed";
	const rawCode = envelopeError.code?.trim() || "COMMAND_FAILED";
	const detail =
		envelopeError.details != null ? JSON.stringify(envelopeError.details).slice(0, 500) : undefined;
	// The macOS Developer Mode gate arrives as COMMAND_FAILED — re-code it for
	// reliable matching downstream and append the Yoqa repair path.
	if (
		rawCode === "COMMAND_FAILED" &&
		isDeveloperModeDisabledText(`${message}\n${envelopeError.hint ?? ""}`)
	) {
		const hint = [envelopeError.hint?.trim(), developerModeRepairHint()].filter(Boolean).join(" ");
		return new AgentDeviceError(message, DEVELOPER_MODE_DISABLED_CODE, hint, detail);
	}
	return new AgentDeviceError(message, rawCode, envelopeError.hint, detail);
}

/**
 * Run one agent-device CLI command and return its `data` payload.
 * Always appends `--json` and parses the `{success, data|error}` envelope.
 */
export async function runAgentDevice(
	args: string[],
	options: { timeoutMs?: number } = {},
): Promise<unknown> {
	ensureHostToolPath();
	const bin = await resolveAgentDeviceBin();
	const env = await withDesktopIosSigningEnv(androidProcessEnv(process.env));
	const proc = Bun.spawn([bin, ...args, "--json"], {
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
		const raw = stdout.trim() || stderr.trim();
		let envelope: AgentDeviceEnvelope | null = null;
		try {
			envelope = JSON.parse(raw || stdout) as AgentDeviceEnvelope;
		} catch {
			envelope = null;
		}
		if (envelope && typeof envelope === "object" && "success" in envelope) {
			if (envelope.success) return (envelope as { success: true; data: unknown }).data;
			const failure = envelope as {
				success: false;
				error: { code?: string; message?: string; hint?: string; details?: unknown };
			};
			throw agentDeviceErrorFromEnvelope(failure.error);
		}
		if (exitCode !== 0) {
			throw new AgentDeviceError(
				`agent-device ${args[0] ?? ""} failed (exit ${exitCode}): ${(stderr || stdout).trim().slice(0, 500) || "unknown error"}`,
				"COMMAND_FAILED",
			);
		}
		// Zero exit but no JSON envelope — return raw text.
		return raw;
	} catch (error) {
		if (timedOut) {
			throw new AgentDeviceError(
				`agent-device ${args[0] ?? ""} timed out after ${timeoutMs}ms`,
				"TIMEOUT",
				"Retry with a booted simulator/emulator, or increase the timeout.",
			);
		}
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

/** `agent-device --version` without the JSON envelope. */
export async function agentDeviceVersion(): Promise<string | null> {
	try {
		const bin = await resolveAgentDeviceBin();
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

/** True when `version` satisfies the minimum supported agent-device release. */
export function isSupportedAgentDeviceVersion(version: string): boolean {
	const actual = parseVersionTuple(version);
	const minimum = parseVersionTuple(MIN_AGENT_DEVICE_VERSION);
	if (!actual || !minimum) return false;
	for (let i = 0; i < 3; i++) {
		if (actual[i] !== minimum[i]) return (actual[i] ?? 0) > (minimum[i] ?? 0);
	}
	return true;
}
