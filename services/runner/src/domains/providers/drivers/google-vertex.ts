import { createVertex } from "@ai-sdk/google-vertex";
import { AgentProviderError, createSdkVisionPort, resolveVertexApiKey } from "../vision-model";
import type { DriverDefinition, VisionAuth } from "./types";

function vertexProject(auth: VisionAuth): string | undefined {
	return (
		auth.env.GOOGLE_VERTEX_PROJECT?.trim() || process.env.GOOGLE_VERTEX_PROJECT?.trim() || undefined
	);
}

function createVertexModel(auth: VisionAuth, modelId: string) {
	const apiKey = resolveVertexApiKey(auth);
	const project = vertexProject(auth);
	const location =
		auth.env.GOOGLE_VERTEX_LOCATION?.trim() ||
		process.env.GOOGLE_VERTEX_LOCATION?.trim() ||
		"us-central1";
	if (!apiKey && !project) {
		throw new AgentProviderError("Google Vertex needs an API key or GOOGLE_VERTEX_PROJECT");
	}
	return createVertex({
		...(apiKey ? { apiKey } : {}),
		...(project ? { project } : {}),
		location,
		...(auth.baseUrl?.trim() ? { baseURL: auth.baseUrl.replace(/\/$/, "") } : {}),
	})(modelId);
}

const DEFAULT_MODELS = [
	"gemini-2.5-flash",
	"gemini-2.5-pro",
	"gemini-2.0-flash",
	"gemini-1.5-flash",
	"gemini-1.5-pro",
];

export const googleVertexDriver: DriverDefinition = {
	kind: "google-vertex",
	label: "Google Vertex",
	description: "Vertex AI Gemini via @ai-sdk/google-vertex (express API key or GCP project).",
	defaultBinary: null,
	authModes: ["api_key"],
	envHints: [
		"GOOGLE_VERTEX_API_KEY",
		"GOOGLE_VERTEX_PROJECT",
		"GOOGLE_VERTEX_LOCATION",
		"GOOGLE_APPLICATION_CREDENTIALS",
	],
	loginInstructions:
		"Paste a Vertex express-mode API key, or set GOOGLE_VERTEX_PROJECT + GOOGLE_VERTEX_LOCATION (and ADC / GOOGLE_APPLICATION_CREDENTIALS).",
	capabilities: { vision: true, chat: ["api_key"] },
	vision: createSdkVisionPort({
		label: "Google Vertex",
		defaultModel: "gemini-2.5-flash",
		createModel: createVertexModel,
	}),
	chat: {
		defaultModel: "gemini-2.5-flash",
		missingCredential: (auth) =>
			resolveVertexApiKey(auth) || vertexProject(auth)
				? null
				: "It has no API key and no GOOGLE_VERTEX_PROJECT.",
		createModel: createVertexModel,
	},
	async probe() {
		return {
			found: true,
			version: null,
			authenticated: null,
			detail: "Vertex AI — API key (express) or GCP project credentials",
			binaryPath: null,
		};
	},
	async validate(input) {
		const apiKey =
			input.apiKey || input.env.GOOGLE_VERTEX_API_KEY || process.env.GOOGLE_VERTEX_API_KEY || null;
		const project =
			input.env.GOOGLE_VERTEX_PROJECT?.trim() || process.env.GOOGLE_VERTEX_PROJECT?.trim() || null;
		const location =
			input.env.GOOGLE_VERTEX_LOCATION?.trim() ||
			process.env.GOOGLE_VERTEX_LOCATION?.trim() ||
			"us-central1";

		if (apiKey) {
			return {
				ok: true,
				status: "connected",
				message: "Vertex express-mode API key present (live call deferred to runs)",
			};
		}
		if (project) {
			return {
				ok: true,
				status: "connected",
				message: `Vertex project ${project} · location ${location}`,
			};
		}
		return {
			ok: false,
			status: "invalid",
			message: "Set a Vertex API key, or GOOGLE_VERTEX_PROJECT (+ optional GOOGLE_VERTEX_LOCATION)",
		};
	},
	async listModels(input) {
		const validated = await this.validate(input);
		if (!validated.ok) {
			return { models: [], message: validated.message };
		}
		return {
			models: DEFAULT_MODELS.map((id) => ({ id, name: id })),
			message: `${DEFAULT_MODELS.length} common Gemini models on Vertex`,
		};
	},
};
