import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { ProbeResult } from "./types";

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function which(binary: string): Promise<string | null> {
	const fromBun =
		typeof Bun !== "undefined" && typeof Bun.which === "function" ? Bun.which(binary) : null;
	if (fromBun) return fromBun;

	const proc = Bun.spawn(["which", binary], {
		stdout: "pipe",
		stderr: "pipe",
		env: process.env,
	});
	const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
	if (exitCode !== 0) return null;
	const resolved = stdout.trim().split("\n")[0]?.trim();
	return resolved || null;
}

/** Absolute dirs Finder/Dock PATH often omits — used when `which` misses the binary. */
function knownHomeBinCandidates(binaryName: string, home: string = homedir()): string[] {
	return [
		join(home, ".opencode", "bin", binaryName),
		join(home, ".grok", "bin", binaryName),
		join(home, ".antigravity", "antigravity", "bin", binaryName),
		join(home, ".local", "bin", binaryName),
		join(home, ".bun", "bin", binaryName),
		`/opt/homebrew/bin/${binaryName}`,
		`/usr/local/bin/${binaryName}`,
	];
}

async function resolveFromKnownBins(binaryName: string): Promise<string | null> {
	for (const candidate of knownHomeBinCandidates(binaryName)) {
		if (await pathExists(candidate)) {
			return candidate;
		}
	}
	return null;
}

export async function resolveBinary(
	defaultName: string,
	binaryPath?: string | null,
): Promise<{ path: string | null; detail: string }> {
	const candidate = binaryPath?.trim() || defaultName;
	if (isAbsolute(candidate) || candidate.includes("/")) {
		if (await pathExists(candidate)) {
			return { path: candidate, detail: `Found at ${candidate}` };
		}
		return {
			path: null,
			detail: `${candidate} not found`,
		};
	}
	const resolved = (await which(candidate)) ?? (await resolveFromKnownBins(candidate));
	if (!resolved) {
		return {
			path: null,
			detail: `\`${candidate}\` is not installed or not on PATH`,
		};
	}
	return { path: resolved, detail: `Found at ${resolved}` };
}

/** How long to wait after kill for the pipes to close before returning partial output. */
const KILL_GRACE_MS = 250;

/**
 * Shared stdout/stderr/exit envelope for spawned CLIs. `timedOut` is set only
 * by deadline paths (`runCommand`); readers that only need the output (e.g.
 * `parseAgyDecision`) ignore it.
 */
export type CommandResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
	timedOut?: boolean;
};

/** Drain a pipe without blocking the caller past `kill()` — keep whatever was collected. */
async function drainStream(
	stream: ReadableStream<Uint8Array>,
	sink: { text: string },
): Promise<void> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) sink.text += decoder.decode(value, { stream: true });
		}
	} catch {
		// pipe torn down by kill — keep what we already collected
	}
}

/**
 * Run a command with a hard deadline. Never awaits pipe EOF past the timeout:
 * a spawned child can inherit stdout/stderr (CLI daemons do) and keep them open
 * forever, which used to freeze the caller even after `kill()`. On timeout the
 * child is killed, the drains get a short grace period, and the partial output
 * is returned with `timedOut: true` and `exitCode: 124`.
 */
export async function runCommand(
	command: string[],
	opts?: { env?: Record<string, string>; timeoutMs?: number },
): Promise<CommandResult> {
	try {
		const proc = Bun.spawn(command, {
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, ...opts?.env },
		});
		const timeoutMs = opts?.timeoutMs ?? 12_000;

		const stdout = { text: "" };
		const stderr = { text: "" };
		const drained = Promise.all([
			drainStream(proc.stdout, stdout),
			drainStream(proc.stderr, stderr),
		]);
		const finished = Promise.all([proc.exited, drained]).then(([exitCode]) => exitCode);

		let timer: ReturnType<typeof setTimeout> | undefined;
		const deadline = new Promise<null>((resolve) => {
			timer = setTimeout(() => {
				try {
					proc.kill();
				} catch {
					// already exited
				}
				resolve(null);
			}, timeoutMs);
		});

		try {
			const exitCode = await Promise.race([finished, deadline]);
			if (exitCode === null) {
				// The kill did not close the pipes (grandchild still holds them) —
				// wait a moment for the partial output, then return regardless.
				await Promise.race([
					drained,
					new Promise<void>((resolve) => setTimeout(resolve, KILL_GRACE_MS)),
				]);
				return {
					stdout: stdout.text,
					stderr: `${stderr.text}\nCommand timed out after ${timeoutMs}ms`.trim(),
					exitCode: 124,
					timedOut: true,
				};
			}
			return { stdout: stdout.text, stderr: stderr.text, exitCode };
		} finally {
			clearTimeout(timer);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { stdout: "", stderr: message, exitCode: 127 };
	}
}

export async function probeCli(params: {
	defaultBinary: string;
	binaryPath?: string | null;
	versionArgs?: string[];
	authCheck?: (binary: string) => Promise<{ authenticated: boolean; detail: string }>;
}): Promise<ProbeResult> {
	const resolved = await resolveBinary(params.defaultBinary, params.binaryPath);
	if (!resolved.path) {
		return {
			found: false,
			version: null,
			authenticated: null,
			detail: resolved.detail,
			binaryPath: null,
		};
	}

	let version: string | null = null;
	const versionArgs = params.versionArgs ?? ["--version"];
	const versionResult = await runCommand([resolved.path, ...versionArgs]);
	if (versionResult.exitCode === 0) {
		const line = (versionResult.stdout || versionResult.stderr).trim().split("\n")[0];
		version = line?.trim() || null;
	}

	if (!params.authCheck) {
		return {
			found: true,
			version,
			authenticated: null,
			detail: version
				? `Found ${params.defaultBinary}${version ? ` · ${version}` : ""}`
				: resolved.detail,
			binaryPath: resolved.path,
		};
	}

	const auth = await params.authCheck(resolved.path);
	return {
		found: true,
		version,
		authenticated: auth.authenticated,
		detail: auth.detail,
		binaryPath: resolved.path,
	};
}

export async function pingOpenAiCompatible(params: {
	apiKey: string;
	baseUrl: string;
	label: string;
	headers?: Record<string, string>;
	/** When true, omit Authorization and allow hosts that do not require a key (e.g. local Ollama). */
	allowEmptyApiKey?: boolean;
}): Promise<{ ok: boolean; message: string; models?: string[] }> {
	const key = params.apiKey.trim();
	if (!key && !params.allowEmptyApiKey) {
		return { ok: false, message: "API key is empty" };
	}
	const base = params.baseUrl.replace(/\/$/, "");
	try {
		const headers: Record<string, string> = { ...params.headers };
		if (key) {
			headers.Authorization = `Bearer ${key}`;
		}
		const response = await fetch(`${base}/models`, {
			method: "GET",
			headers,
		});
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			return {
				ok: false,
				message: detail
					? `${params.label} validation failed (${response.status}): ${detail.slice(0, 200)}`
					: `${params.label} validation failed: HTTP ${response.status}`,
			};
		}
		const json: unknown = await response.json().catch(() => null);
		const models: string[] = [];
		if (
			json &&
			typeof json === "object" &&
			"data" in json &&
			Array.isArray((json as { data: unknown }).data)
		) {
			for (const item of (json as { data: unknown[] }).data) {
				if (item && typeof item === "object" && "id" in item && typeof item.id === "string") {
					models.push(item.id);
				}
			}
		}
		return {
			ok: true,
			message: `${params.label} credentials are valid`,
			models,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, message: `${params.label} validation request failed: ${message}` };
	}
}

export async function pingAnthropic(params: {
	apiKey: string;
	baseUrl: string | null;
}): Promise<{ ok: boolean; message: string; models?: string[] }> {
	const key = params.apiKey.trim();
	if (!key) {
		return { ok: false, message: "API key is empty" };
	}
	const base = (params.baseUrl?.replace(/\/$/, "") || "https://api.anthropic.com").replace(
		/\/$/,
		"",
	);
	try {
		const response = await fetch(`${base}/v1/models`, {
			method: "GET",
			headers: {
				"x-api-key": key,
				"anthropic-version": "2023-06-01",
			},
		});
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			return {
				ok: false,
				message: detail
					? `Anthropic validation failed (${response.status}): ${detail.slice(0, 200)}`
					: `Anthropic validation failed: HTTP ${response.status}`,
			};
		}
		const json: unknown = await response.json().catch(() => null);
		const models: string[] = [];
		if (
			json &&
			typeof json === "object" &&
			"data" in json &&
			Array.isArray((json as { data: unknown }).data)
		) {
			for (const item of (json as { data: unknown[] }).data) {
				if (item && typeof item === "object" && "id" in item && typeof item.id === "string") {
					models.push(item.id);
				}
			}
		}
		return { ok: true, message: "Anthropic API key is valid", models };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, message: `Anthropic validation request failed: ${message}` };
	}
}
