import { probeCli, runCommand } from "./probe";
import type { DriverDefinition, ModelEntry } from "./types";

/** Default Cursor Agent model for vision decide / grounding. */
export const CURSOR_DEFAULT_VISION_MODEL = "auto";

function parseModelLines(text: string): ModelEntry[] {
	const models: ModelEntry[] = [];
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (!line || line.toLowerCase().startsWith("available models")) continue;
		const dash = line.indexOf(" - ");
		if (dash <= 0) continue;
		const id = line.slice(0, dash).trim();
		const name = line.slice(dash + 3).trim();
		if (!id) continue;
		models.push({ id, name: name || id });
	}
	return models;
}

async function listCursorModels(
	binary: string,
	opts?: { apiKey?: string | null },
): Promise<{ ok: boolean; models: ModelEntry[]; message: string }> {
	const env = opts?.apiKey?.trim() ? { CURSOR_API_KEY: opts.apiKey.trim() } : undefined;
	const withFlag = opts?.apiKey?.trim()
		? await runCommand([binary, "--api-key", opts.apiKey.trim(), "--list-models"], {
				env,
				timeoutMs: 20_000,
			})
		: await runCommand([binary, "--list-models"], { timeoutMs: 20_000 });

	let stdout = withFlag.stdout || withFlag.stderr;
	let exitCode = withFlag.exitCode;
	if (exitCode !== 0 || !parseModelLines(stdout).length) {
		const fallback = opts?.apiKey?.trim()
			? await runCommand([binary, "--api-key", opts.apiKey.trim(), "models"], {
					env,
					timeoutMs: 20_000,
				})
			: await runCommand([binary, "models"], { timeoutMs: 20_000 });
		stdout = fallback.stdout || fallback.stderr;
		exitCode = fallback.exitCode;
	}

	const models = parseModelLines(stdout);
	const lower = stdout.toLowerCase();
	if (
		exitCode !== 0 &&
		(lower.includes("unauthorized") ||
			lower.includes("unauthenticated") ||
			lower.includes("invalid") ||
			lower.includes("api key") ||
			lower.includes("not logged"))
	) {
		return {
			ok: false,
			models: [],
			message: stdout.trim().slice(0, 240) || "Cursor Agent authentication failed",
		};
	}
	if (models.length === 0) {
		return {
			ok: false,
			models: [],
			message:
				exitCode === 0
					? "Cursor Agent returned no models"
					: stdout.trim().slice(0, 240) || "Failed to list Cursor models",
		};
	}
	return {
		ok: true,
		models,
		message: `${models.length} models available`,
	};
}

async function cursorStatus(binary: string): Promise<{ authenticated: boolean; detail: string }> {
	const result = await runCommand([binary, "status", "--format", "json"], {
		timeoutMs: 15_000,
	});
	const text = (result.stdout || result.stderr).trim();
	try {
		const json: unknown = JSON.parse(text);
		if (json && typeof json === "object") {
			const record = json as {
				isAuthenticated?: unknown;
				userInfo?: { email?: unknown };
				status?: unknown;
			};
			const authenticated = record.isAuthenticated === true;
			const email =
				record.userInfo &&
				typeof record.userInfo === "object" &&
				typeof record.userInfo.email === "string"
					? record.userInfo.email
					: null;
			if (authenticated) {
				return {
					authenticated: true,
					detail: email
						? `Authenticated via Cursor Agent · ${email}`
						: "Authenticated via Cursor Agent",
				};
			}
			return {
				authenticated: false,
				detail: "`cursor-agent` found but not authenticated — run `cursor-agent login`",
			};
		}
	} catch {
		// Fall through to text heuristics.
	}
	const lower = text.toLowerCase();
	if (result.exitCode === 0 && (lower.includes("logged in") || lower.includes("authenticated"))) {
		return {
			authenticated: true,
			detail: text.split("\n")[0]?.trim() || "Authenticated via Cursor Agent",
		};
	}
	return {
		authenticated: false,
		detail:
			text.slice(0, 200) ||
			"`cursor-agent` found but auth status is unknown — run `cursor-agent login`",
	};
}

export const cursorDriver: DriverDefinition = {
	kind: "cursor",
	label: "Cursor",
	defaultBinary: "cursor-agent",
	authModes: ["cli", "api_key"],
	envHints: ["CURSOR_API_KEY"],
	loginInstructions:
		"Run `cursor-agent login` (or `cursor agent login`) in a terminal, then re-check. Or paste a CURSOR_API_KEY.",
	async probe(binaryPath) {
		return probeCli({
			defaultBinary: "cursor-agent",
			binaryPath,
			authCheck: async (binary) => cursorStatus(binary),
		});
	},
	async validate(input) {
		const key = input.apiKey || input.env.CURSOR_API_KEY || null;
		if (key) {
			const resolved = await probeCli({
				defaultBinary: "cursor-agent",
				binaryPath: input.binaryPath,
			});
			if (!resolved.found || !resolved.binaryPath) {
				return { ok: false, status: "not_found", message: resolved.detail };
			}
			const listed = await listCursorModels(resolved.binaryPath, { apiKey: key });
			return {
				ok: listed.ok,
				status: listed.ok ? "connected" : "invalid",
				message: listed.ok
					? `Authenticated · Cursor API key · ${listed.models.length} models`
					: listed.message,
			};
		}

		const probe = await this.probe(input.binaryPath);
		if (!probe.found) {
			return { ok: false, status: "not_found", message: probe.detail };
		}
		if (probe.authenticated) {
			return { ok: true, status: "connected", message: probe.detail };
		}
		return {
			ok: false,
			status: "invalid",
			message: probe.detail || "Cursor Agent is not authenticated",
		};
	},
	async listModels(input) {
		const key = input.apiKey || input.env.CURSOR_API_KEY || null;
		const resolved = await probeCli({
			defaultBinary: "cursor-agent",
			binaryPath: input.binaryPath,
		});
		if (!resolved.found || !resolved.binaryPath) {
			return { models: [], message: resolved.detail };
		}
		const listed = await listCursorModels(resolved.binaryPath, { apiKey: key });
		return { models: listed.models, message: listed.message };
	},
};
