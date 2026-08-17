import { homedir } from "node:os";
import { join } from "node:path";

const OPENAI_COMPATIBLE_PACKAGES = new Set([
	"@ai-sdk/openai-compatible",
	"@ai-sdk/openai",
	"@ai-sdk/azure",
]);

export type OpenCodeCompatibleProvider = {
	providerId: string;
	baseURL: string;
	apiKeyTemplate: string | null;
	headers: Record<string, string>;
};

export type OpenCodeCompatibleAuth = {
	baseURL: string;
	apiKey: string | null;
	headers: Record<string, string>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function isOpenAiCompatibleNpm(npm: string): boolean {
	const trimmed = npm.trim();
	if (!trimmed) return true;
	if (OPENAI_COMPATIBLE_PACKAGES.has(trimmed)) return true;
	return trimmed.includes("openai-compatible");
}

/** Expand OpenCode `{env:VAR}` placeholders from provider env, then process.env. */
export function interpolateOpenCodeTemplate(value: string, env: Record<string, string>): string {
	return value
		.replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_full, name: string) => {
			return env[name]?.trim() || process.env[name]?.trim() || "";
		})
		.trim();
}

export function openCodeConfigPaths(): string[] {
	const paths: string[] = [];
	const xdg = process.env.XDG_CONFIG_HOME?.trim();
	if (xdg) paths.push(join(xdg, "opencode", "opencode.json"));
	paths.push(join(homedir(), ".config", "opencode", "opencode.json"));
	return paths;
}

/**
 * Read an OpenAI-compatible custom provider from `opencode.json`
 * (LiteLLM, Ollama gateways, …). Native providers without `options.baseURL` return null.
 */
export function parseOpenCodeCompatibleProvider(
	config: unknown,
	providerId: string,
): OpenCodeCompatibleProvider | null {
	const root = asRecord(config);
	const providers = asRecord(root?.provider);
	const entry = asRecord(providers?.[providerId]);
	if (!entry) return null;

	const npm = typeof entry.npm === "string" ? entry.npm : "";
	if (!isOpenAiCompatibleNpm(npm)) return null;

	const options = asRecord(entry.options);
	const baseURLRaw = typeof options?.baseURL === "string" ? options.baseURL.trim() : "";
	if (!baseURLRaw) return null;

	const apiKeyTemplate = typeof options?.apiKey === "string" ? options.apiKey : null;
	const headers: Record<string, string> = {};
	const headerBag = asRecord(options?.headers);
	if (headerBag) {
		for (const [key, value] of Object.entries(headerBag)) {
			if (typeof value === "string" && value.trim()) headers[key] = value;
		}
	}

	return {
		providerId,
		baseURL: baseURLRaw.replace(/\/$/, ""),
		apiKeyTemplate,
		headers,
	};
}

export function resolveOpenCodeCompatibleAuth(input: {
	providerId: string;
	config: unknown;
	env: Record<string, string>;
	storedKey: string | null;
	overrideBaseUrl: string | null;
}): OpenCodeCompatibleAuth | null {
	const parsed = parseOpenCodeCompatibleProvider(input.config, input.providerId);
	const override = input.overrideBaseUrl?.trim().replace(/\/$/, "") || null;
	if (!parsed && !(override && input.providerId === "litellm")) return null;
	const baseURL = override || parsed?.baseURL || null;
	if (!baseURL) return null;

	const headers: Record<string, string> = {};
	if (parsed) {
		for (const [key, value] of Object.entries(parsed.headers)) {
			const interpolated = interpolateOpenCodeTemplate(value, input.env);
			if (interpolated) headers[key] = interpolated;
		}
	}

	const fromTemplate = parsed?.apiKeyTemplate
		? interpolateOpenCodeTemplate(parsed.apiKeyTemplate, input.env)
		: "";
	const envKeyName = `${input.providerId.replace(/-/g, "_").toUpperCase()}_API_KEY`;
	const apiKey =
		fromTemplate ||
		input.env[envKeyName]?.trim() ||
		process.env[envKeyName]?.trim() ||
		input.storedKey?.trim() ||
		null;

	return { baseURL, apiKey, headers };
}

export async function loadOpenCodeUserConfig(): Promise<unknown> {
	for (const path of openCodeConfigPaths()) {
		try {
			const file = Bun.file(path);
			if (!(await file.exists())) continue;
			return await file.json();
		} catch {
			// Try next path (missing file, invalid JSON, …).
		}
	}
	return null;
}
