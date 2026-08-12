import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FetchFunction } from "@ai-sdk/provider-utils";
import { APICallError, NoObjectGeneratedError, generateObject } from "ai";
import type { LanguageModel } from "ai";
import type { VisionAuth, VisionCompleteInput, VisionPort } from "./drivers/types";

export class AgentProviderError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AgentProviderError";
	}
}

const EXAMPLE_OPENCODE_VISION_MODEL = "mimo-v2.5-free";
const VISION_MAX_TOKENS = 4096;
const VISION_MAX_EDGE = 1170;

const JSON_REPAIR_PROMPT =
	"Your previous reply was not valid JSON for this task. Reply again with ONLY one strict JSON object using double quotes for every key and string (no single quotes, no markdown, no prose).";

export type VisionImage = { base64: string; mediaType: "image/png" | "image/jpeg" };

/**
 * Shrink device screenshots for vision APIs. Full-res iPhone PNGs (~1–2MB) are
 * flaky on OpenCode Zen; a ~1170px JPEG is enough for tap targeting.
 */
export async function prepareVisionImage(pngBase64: string): Promise<VisionImage> {
	const bytes = Buffer.from(pngBase64, "base64");
	if (bytes.byteLength === 0) {
		return { base64: pngBase64, mediaType: "image/png" };
	}
	if (process.platform !== "darwin") {
		return { base64: pngBase64, mediaType: "image/png" };
	}

	const dir = await mkdtemp(join(tmpdir(), "yoqa-vision-"));
	const inPath = join(dir, "shot.png");
	const outPath = join(dir, "shot.jpg");
	try {
		await writeFile(inPath, new Uint8Array(bytes));
		const proc = Bun.spawn(
			[
				"sips",
				"-Z",
				String(VISION_MAX_EDGE),
				"-s",
				"format",
				"jpeg",
				"-s",
				"formatOptions",
				"70",
				inPath,
				"--out",
				outPath,
			],
			{ stdout: "ignore", stderr: "pipe" },
		);
		const code = await proc.exited;
		if (code !== 0) {
			return { base64: pngBase64, mediaType: "image/png" };
		}
		const jpeg = await readFile(outPath);
		if (jpeg.byteLength === 0 || jpeg.byteLength >= bytes.byteLength) {
			return { base64: pngBase64, mediaType: "image/png" };
		}
		return { base64: jpeg.toString("base64"), mediaType: "image/jpeg" };
	} catch {
		return { base64: pngBase64, mediaType: "image/png" };
	} finally {
		await rm(dir, { recursive: true, force: true }).catch(() => undefined);
	}
}

export function looksLikeHtmlResponse(body: string): boolean {
	const trimmed = body.trimStart().slice(0, 200).toLowerCase();
	return trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html");
}

export function formatProviderHttpError(label: string, status: number, body: string): string {
	if (label === "OpenCode" && looksLikeHtmlResponse(body)) {
		return `OpenCode returned its web UI instead of an API response (HTTP ${status}). Local \`opencode serve\` is not OpenAI-compatible — paste a Zen API key from opencode.ai in Settings → Provider (or set OPENCODE_API_KEY).`;
	}
	if (label === "OpenCode" && body.includes("CreditsError")) {
		return `OpenCode Zen needs billing for this model, or pick a free model in Settings → Provider. Add a payment method at opencode.ai, or switch to a Free vision model (e.g. ${EXAMPLE_OPENCODE_VISION_MODEL}).`;
	}
	if (
		label === "OpenCode" &&
		(body.includes("unknown variant `image_url`") ||
			body.includes("No endpoints found that support image input") ||
			body.includes("expected `text`"))
	) {
		return `This OpenCode model does not accept screenshots (text-only). In Settings → Provider, set the default model to ${EXAMPLE_OPENCODE_VISION_MODEL} (or another vision-capable model). deepseek-v4-flash-free and big-pickle are text-only on Zen.`;
	}
	if (
		label === "OpenCode" &&
		status >= 500 &&
		(body.includes("Internal server error") || body.includes('"type":"error"'))
	) {
		return `OpenCode Zen returned an internal error for this vision request. Many free models reject screenshots. In Settings → Provider, set the default model to ${EXAMPLE_OPENCODE_VISION_MODEL} (or another vision-capable model).`;
	}
	return `${label} request failed (${status}): ${body.slice(0, 400)}`;
}

export function isJsonRepairableError(error: AgentProviderError): boolean {
	const message = error.message;
	return (
		message.includes("did not return JSON") ||
		message.includes("invalid JSON") ||
		message.includes("empty response") ||
		message.includes("not a valid action") ||
		message.includes("truncated while reasoning") ||
		message.includes("was not a valid") ||
		message.includes("JSON was invalid")
	);
}

function mapProviderError(label: string, error: unknown): never {
	if (error instanceof AgentProviderError) throw error;

	if (APICallError.isInstance(error)) {
		const body = error.responseBody ?? error.message;
		const status = error.statusCode ?? 0;
		throw new AgentProviderError(formatProviderHttpError(label, status, body));
	}

	if (NoObjectGeneratedError.isInstance(error)) {
		const text = error.text?.trim() ?? "";
		if (!text && error.finishReason === "length") {
			throw new AgentProviderError(
				"Model returned an empty response (expected JSON action) — output truncated while reasoning. Retry the run or pick a non-reasoning vision model in Settings → Provider.",
			);
		}
		const snippet = text.replace(/\s+/g, " ").slice(0, 160);
		if (!snippet) {
			throw new AgentProviderError("Model returned an empty response (expected JSON action)");
		}
		throw new AgentProviderError(
			`Model did not return JSON (got: ${snippet}${text.length > 160 ? "…" : ""})`,
		);
	}

	if (error instanceof Error) {
		throw new AgentProviderError(error.message);
	}
	throw new AgentProviderError(String(error));
}

export async function completeWithAiSdk<T>(input: {
	label: string;
	model: LanguageModel;
	schema: VisionCompleteInput<T>["schema"];
	system: string;
	prompt: string;
	image: VisionImage;
}): Promise<T> {
	const run = async (prompt: string): Promise<T> => {
		try {
			const { object } = await generateObject({
				model: input.model,
				schema: input.schema,
				system: input.system,
				maxOutputTokens: VISION_MAX_TOKENS,
				messages: [
					{
						role: "user",
						content: [
							{
								type: "image",
								image: input.image.base64,
								mediaType: input.image.mediaType,
							},
							{ type: "text", text: prompt },
						],
					},
				],
			});
			return object;
		} catch (error) {
			mapProviderError(input.label, error);
		}
	};

	try {
		return await run(input.prompt);
	} catch (error) {
		if (!(error instanceof AgentProviderError) || !isJsonRepairableError(error)) {
			throw error;
		}
		return run(`${input.prompt}\n\n${JSON_REPAIR_PROMPT}`);
	}
}

export function createSdkVisionPort(opts: {
	label: string;
	defaultModel: string;
	createModel: (auth: VisionAuth, modelId: string) => Promise<LanguageModel> | LanguageModel;
}): VisionPort {
	return {
		async completeObject<T>(input: VisionCompleteInput<T>): Promise<T> {
			const modelId = input.auth.defaultModel?.trim() || opts.defaultModel;
			const image = await prepareVisionImage(input.imageBase64);
			const model = await opts.createModel(input.auth, modelId);
			return completeWithAiSdk({
				label: opts.label,
				model,
				schema: input.schema,
				system: input.system,
				prompt: input.prompt,
				image,
			});
		},
	};
}

export function resolveAnthropicKey(auth: VisionAuth): string | null {
	return (
		auth.apiKey?.trim() ||
		auth.env.ANTHROPIC_API_KEY?.trim() ||
		process.env.ANTHROPIC_API_KEY?.trim() ||
		null
	);
}

function openCodeAuthPaths(): string[] {
	const paths: string[] = [];
	const xdg = process.env.XDG_DATA_HOME?.trim();
	if (xdg) paths.push(join(xdg, "opencode", "auth.json"));
	paths.push(join(homedir(), ".local", "share", "opencode", "auth.json"));
	return paths;
}

export async function readOpenCodeCliAuthKey(): Promise<string | null> {
	for (const path of openCodeAuthPaths()) {
		try {
			const file = Bun.file(path);
			if (!(await file.exists())) continue;
			const json: unknown = await file.json();
			if (!json || typeof json !== "object") continue;
			const record = json as Record<string, unknown>;

			const opencode = record.opencode;
			if (opencode && typeof opencode === "object") {
				const entry = opencode as Record<string, unknown>;
				for (const field of ["key", "apiKey", "token"] as const) {
					const value = entry[field];
					if (typeof value === "string" && value.trim()) return value.trim();
				}
			}

			for (const value of Object.values(record)) {
				if (!value || typeof value !== "object") continue;
				const entry = value as Record<string, unknown>;
				const key = entry.key ?? entry.apiKey ?? entry.token;
				if (typeof key === "string" && key.trim()) {
					const type = typeof entry.type === "string" ? entry.type.toLowerCase() : "";
					if (!type || type.includes("api") || type.includes("key") || type === "opencode") {
						return key.trim();
					}
				}
			}
		} catch {
			// Try next path.
		}
	}
	return null;
}

export async function resolveOpenAiCompatibleKey(auth: VisionAuth): Promise<string | null> {
	if (auth.apiKey?.trim()) return auth.apiKey.trim();
	if (auth.kind === "opencode") {
		return (
			auth.env.OPENCODE_API_KEY?.trim() ||
			auth.env.OPENCODE_ZEN_API_KEY?.trim() ||
			process.env.OPENCODE_API_KEY?.trim() ||
			process.env.OPENCODE_ZEN_API_KEY?.trim() ||
			(await readOpenCodeCliAuthKey())
		);
	}
	return auth.env.OPENAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || null;
}

export function resolveOpenAiCompatibleBaseUrl(auth: VisionAuth): string {
	if (auth.baseUrl?.trim()) {
		return auth.baseUrl.replace(/\/$/, "");
	}
	if (auth.kind === "opencode") {
		return "https://opencode.ai/zen/v1";
	}
	if (auth.kind === "groq") {
		return "https://api.groq.com/openai/v1";
	}
	if (auth.kind === "grok") {
		return "https://api.x.ai/v1";
	}
	return "https://api.openai.com/v1";
}

export function resolveGroqKey(auth: VisionAuth): string | null {
	return (
		auth.apiKey?.trim() || auth.env.GROQ_API_KEY?.trim() || process.env.GROQ_API_KEY?.trim() || null
	);
}

export function resolveGrokKey(auth: VisionAuth): string | null {
	return (
		auth.apiKey?.trim() || auth.env.XAI_API_KEY?.trim() || process.env.XAI_API_KEY?.trim() || null
	);
}

export function resolveCustomKey(auth: VisionAuth): string | null {
	return (
		auth.apiKey?.trim() ||
		auth.env.OPENAI_API_KEY?.trim() ||
		process.env.OPENAI_API_KEY?.trim() ||
		null
	);
}

export function resolveGoogleKey(auth: VisionAuth): string | null {
	return (
		auth.apiKey?.trim() ||
		auth.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
		auth.env.GOOGLE_API_KEY?.trim() ||
		process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
		process.env.GOOGLE_API_KEY?.trim() ||
		null
	);
}

export function resolveVertexApiKey(auth: VisionAuth): string | null {
	return (
		auth.apiKey?.trim() ||
		auth.env.GOOGLE_VERTEX_API_KEY?.trim() ||
		process.env.GOOGLE_VERTEX_API_KEY?.trim() ||
		null
	);
}

/**
 * DeepSeek-style OpenCode models burn tokens on reasoning unless thinking is off.
 */
export function withOpenCodeRequestHooks(opts: {
	disableThinking: boolean;
	authHeaders: Record<string, string> | null;
	fetchImpl?: FetchFunction;
}): FetchFunction {
	const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
	return (async (input, init) => {
		const headers = new Headers(init?.headers);
		if (opts.authHeaders?.Authorization) {
			headers.set("Authorization", opts.authHeaders.Authorization);
		}

		if (!opts.disableThinking || !init?.body || typeof init.body !== "string") {
			return fetchImpl(input, { ...init, headers });
		}
		try {
			const parsed: unknown = JSON.parse(init.body);
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				return fetchImpl(input, { ...init, headers });
			}
			const body = { ...(parsed as Record<string, unknown>), thinking: { type: "disabled" } };
			return fetchImpl(input, {
				...init,
				headers,
				body: JSON.stringify(body),
			});
		} catch {
			return fetchImpl(input, { ...init, headers });
		}
	}) as FetchFunction;
}
