import type { DriverDefinition } from "./types";

function resolveCopilotToken(input: {
	apiKey: string | null;
	env: Record<string, string>;
}): string | null {
	return (
		input.apiKey ||
		input.env.COPILOT_GITHUB_TOKEN ||
		input.env.GH_TOKEN ||
		input.env.GITHUB_TOKEN ||
		null
	);
}

async function exchangeCopilotToken(
	githubToken: string,
): Promise<{ ok: true; token: string } | { ok: false; message: string }> {
	try {
		const response = await fetch("https://api.github.com/copilot_internal/v2/token", {
			method: "GET",
			headers: {
				Authorization: `token ${githubToken}`,
				Accept: "application/json",
				"User-Agent": "yoqa-runner",
				"Editor-Version": "Yoqa/1.0.0",
				"Editor-Plugin-Version": "Yoqa/1.0.0",
			},
		});
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			return {
				ok: false,
				message: detail
					? `GitHub Copilot token exchange failed (${response.status}): ${detail.slice(0, 200)}`
					: `GitHub Copilot token exchange failed: HTTP ${response.status}`,
			};
		}
		const json: unknown = await response.json();
		if (
			json &&
			typeof json === "object" &&
			"token" in json &&
			typeof (json as { token: unknown }).token === "string"
		) {
			return { ok: true, token: (json as { token: string }).token };
		}
		return { ok: false, message: "GitHub Copilot token exchange returned no token" };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, message: `GitHub Copilot token exchange failed: ${message}` };
	}
}

async function listCopilotModels(
	copilotToken: string,
): Promise<{ ok: boolean; models: string[]; message: string }> {
	try {
		const response = await fetch("https://api.githubcopilot.com/models", {
			method: "GET",
			headers: {
				Authorization: `Bearer ${copilotToken}`,
				Accept: "application/json",
				"User-Agent": "yoqa-runner",
				"Editor-Version": "Yoqa/1.0.0",
				"Editor-Plugin-Version": "Yoqa/1.0.0",
				"Copilot-Integration-Id": "vscode-chat",
			},
		});
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			return {
				ok: false,
				models: [],
				message: detail
					? `Copilot models failed (${response.status}): ${detail.slice(0, 200)}`
					: `Copilot models failed: HTTP ${response.status}`,
			};
		}
		const json: unknown = await response.json();
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
			models,
			message: `${models.length} models available`,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, models: [], message: `Copilot models request failed: ${message}` };
	}
}

export const githubCopilotDriver: DriverDefinition = {
	kind: "github-copilot",
	label: "GitHub Copilot",
	description: "Authenticate with a GitHub token that has Copilot access.",
	defaultBinary: null,
	authModes: ["token"],
	envHints: ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"],
	loginInstructions:
		"Paste a GitHub token with Copilot access (COPILOT_GITHUB_TOKEN). Device login requires a terminal: visit github.com/login/device after starting a Copilot device flow.",
	capabilities: { vision: false },
	async probe() {
		return {
			found: true,
			version: null,
			authenticated: null,
			detail: "Paste a GitHub Copilot token to authenticate",
			binaryPath: null,
		};
	},
	async validate(input) {
		const token = resolveCopilotToken(input);
		if (!token) {
			return {
				ok: false,
				status: "invalid",
				message: "GitHub Copilot token is required (COPILOT_GITHUB_TOKEN / GH_TOKEN)",
			};
		}
		const exchange = await exchangeCopilotToken(token);
		if (!exchange.ok) {
			return { ok: false, status: "invalid", message: exchange.message };
		}
		const models = await listCopilotModels(exchange.token);
		if (!models.ok) {
			return {
				ok: true,
				status: "connected",
				message: "GitHub token accepted (model catalog unavailable)",
			};
		}
		return {
			ok: true,
			status: "connected",
			message: `Authenticated · GitHub Copilot · ${models.models.length} models`,
		};
	},
	async listModels(input) {
		const token = resolveCopilotToken(input);
		if (!token) {
			return { models: [], message: "Token required to list Copilot models" };
		}
		const exchange = await exchangeCopilotToken(token);
		if (!exchange.ok) {
			return { models: [], message: exchange.message };
		}
		const result = await listCopilotModels(exchange.token);
		return {
			models: result.models.map((id) => ({ id, name: id })),
			message: result.message,
		};
	},
};
