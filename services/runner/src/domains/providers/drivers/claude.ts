import { pingAnthropic, probeCli, runCommand } from "./probe";
import type { DriverDefinition } from "./types";

export const claudeDriver: DriverDefinition = {
	kind: "claude",
	label: "Claude",
	defaultBinary: "claude",
	authModes: ["cli", "api_key"],
	envHints: ["ANTHROPIC_API_KEY"],
	loginInstructions:
		"Run `claude auth login` in a terminal, then re-check. Or paste an Anthropic API key.",
	async probe(binaryPath) {
		return probeCli({
			defaultBinary: "claude",
			binaryPath,
			authCheck: async (binary) => {
				const result = await runCommand([binary, "auth", "status"]);
				const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
				if (
					result.exitCode === 0 &&
					!text.includes("not logged") &&
					!text.includes("unauthenticated")
				) {
					return {
						authenticated: true,
						detail: "Authenticated via Claude CLI",
					};
				}
				if (text.includes("logged") || text.includes("authenticated")) {
					return { authenticated: true, detail: "Authenticated via Claude CLI" };
				}
				return {
					authenticated: false,
					detail: "`claude` found but not authenticated — run `claude auth login`",
				};
			},
		});
	},
	async validate(input) {
		const key = input.apiKey || input.env.ANTHROPIC_API_KEY || null;
		if (key) {
			const result = await pingAnthropic({ apiKey: key, baseUrl: input.baseUrl });
			return {
				ok: result.ok,
				status: result.ok ? "connected" : "invalid",
				message: result.message,
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
			message: probe.detail || "Claude CLI is not authenticated",
		};
	},
	async listModels(input) {
		const key = input.apiKey || input.env.ANTHROPIC_API_KEY || null;
		if (key) {
			const result = await pingAnthropic({ apiKey: key, baseUrl: input.baseUrl });
			return {
				models: (result.models ?? []).map((id) => ({ id, name: id })),
				message: result.ok ? `${result.models?.length ?? 0} models available` : result.message,
			};
		}
		return {
			models: [],
			message: "Model catalog requires an API key; CLI auth reuses your Claude subscription",
		};
	},
};
