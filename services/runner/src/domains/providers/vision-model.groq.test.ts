import { describe, expect, test } from "bun:test";
import { groqDriver, groqModelVision } from "./drivers/groq";
import {
	isSparseResponseFormatBody,
	prepareVisionImage,
	resolveGroqKey,
	resolveOpenAiCompatibleBaseUrl,
	withGroqRequestHooks,
} from "./vision-model";

/** Decide schema shape: many optional Action fields, only type/reason/thoughts required. */
function decideBody() {
	return {
		model: "meta-llama/llama-4-scout-17b-16e-instruct",
		messages: [
			{
				role: "user",
				content: [
					{ type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
					{
						type: "text",
						text: 'Reply with ONLY the JSON action object, including "reason" and "thoughts".',
					},
				],
			},
		],
		response_format: {
			type: "json_schema",
			json_schema: {
				name: "response",
				strict: true,
				schema: {
					type: "object",
					properties: {
						type: {},
						x: {},
						y: {},
						x2: {},
						y2: {},
						direction: {},
						durationMs: {},
						double: {},
						label: {},
						id: {},
						description: {},
						text: {},
						ms: {},
						alertAction: {},
						appId: {},
						url: {},
						seconds: {},
						assertion: {},
						timeoutMs: {},
						reason: {},
						thoughts: {},
					},
					required: ["type", "reason", "thoughts"],
					additionalProperties: false,
				},
			},
		},
	};
}

/** Grounding schema shape: fully required, strict-safe. */
function groundingBody() {
	return {
		model: "meta-llama/llama-4-scout-17b-16e-instruct",
		messages: [{ role: "user", content: [{ type: "text", text: "Find: Allow button" }] }],
		response_format: {
			type: "json_schema",
			json_schema: {
				name: "response",
				strict: true,
				schema: {
					type: "object",
					properties: { x: {}, y: {} },
					required: ["x", "y"],
					additionalProperties: false,
				},
			},
		},
	};
}

async function captureSentBody(body: unknown): Promise<string> {
	let sentBody = "";
	const fetchImpl = (async (_input: unknown, init?: { body?: unknown }) => {
		sentBody = String(init?.body ?? "");
		return new Response("{}", { status: 200 });
	}) as typeof fetch;
	const hooked = withGroqRequestHooks({ fetchImpl });
	await hooked("https://api.groq.com/openai/v1/chat/completions", {
		method: "POST",
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
	return sentBody;
}

type FetchProbe = { urls: string[]; authorization: string | null };

/** Run `check` with `globalThis.fetch` replaced, always restoring the real one. */
async function withStubbedFetch(
	respond: (probe: FetchProbe) => Response,
	check: (probe: FetchProbe) => Promise<void>,
): Promise<void> {
	const realFetch = globalThis.fetch;
	const probe: FetchProbe = { urls: [], authorization: null };
	globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
		probe.urls.push(String(input));
		probe.authorization = new Headers(init?.headers).get("authorization");
		return respond(probe);
	}) as typeof fetch;
	try {
		await check(probe);
	} finally {
		globalThis.fetch = realFetch;
	}
}

/** Stub the OpenAI-compatible `/models` catalog call the Groq driver uses for Settings. */
function withStubbedModelCatalog(
	ids: string[],
	check: (probe: FetchProbe) => Promise<void>,
): Promise<void> {
	return withStubbedFetch(
		() =>
			new Response(JSON.stringify({ object: "list", data: ids.map((id) => ({ id })) }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		check,
	);
}

const DRIVER_INPUT = {
	apiKey: "test-groq-key",
	baseUrl: null,
	serverUrl: null,
	binaryPath: null,
	env: {},
};

/** Run `check` with a fetch that counts calls, so tests can assert the gateway was never hit. */
function withCountingGateway(
	onCall: () => void,
	check: (probe: FetchProbe) => Promise<void>,
): Promise<void> {
	return withStubbedFetch(() => {
		onCall();
		return new Response("{}", { status: 200 });
	}, check);
}

describe("Groq decide works via prompt JSON (#138)", () => {
	test("outgoing decide request carries no structured-output format marker", async () => {
		const sent = await captureSentBody(decideBody());
		const parsed = JSON.parse(sent) as Record<string, unknown>;
		expect(parsed.response_format).toBeUndefined();
	});

	test("decide strip preserves model, messages, and screenshot payload", async () => {
		const original = decideBody();
		const sent = await captureSentBody(original);
		const parsed = JSON.parse(sent) as typeof original;
		expect(parsed.model).toBe(original.model);
		expect(parsed.messages).toEqual(original.messages);
		expect(JSON.stringify(parsed)).toContain("data:image/png;base64,iVBORw0KGgo=");
	});

	test("grounding keeps structured-output mode (fully required schema)", async () => {
		const original = groundingBody();
		const sent = await captureSentBody(original);
		const parsed = JSON.parse(sent) as typeof original;
		expect(parsed.response_format).toEqual(original.response_format);
		expect(parsed.model).toBe(original.model);
	});

	test("bodies without a format marker pass through untouched", async () => {
		const original = { model: "m", messages: [{ role: "user", content: "hi" }] };
		const sent = await captureSentBody(original);
		expect(JSON.parse(sent)).toEqual(original);
	});

	test("non-JSON bodies pass through without throwing", async () => {
		const sent = await captureSentBody("not-json{{{" as unknown as Record<string, unknown>);
		expect(sent).toBe("not-json{{{");
	});

	test("transport failures are not retried by the request hook", async () => {
		let calls = 0;
		const fetchImpl = (() => {
			calls += 1;
			throw new Error("network down");
		}) as unknown as typeof fetch;
		const hooked = withGroqRequestHooks({ fetchImpl });

		await expect(
			hooked("https://api.groq.com/openai/v1/chat/completions", {
				method: "POST",
				body: JSON.stringify(decideBody()),
			}),
		).rejects.toThrow("network down");
		expect(calls).toBe(1);
	});
});

describe("Groq model vision metadata (#141)", () => {
	test("flags known vision and text-only families, leaves unknown models unflagged", () => {
		expect(groqModelVision("meta-llama/llama-4-scout-17b-16e-instruct")).toBe(true);
		expect(groqModelVision("meta-llama/llama-4-maverick-17b-128e-instruct")).toBe(true);
		expect(groqModelVision("qwen/qwen3.8-27b")).toBe(false);
		expect(groqModelVision("qwen/qwen3-32b")).toBe(false);
		expect(groqModelVision("llama-3.3-70b-versatile")).toBe(false);
		expect(groqModelVision("openai/gpt-oss-120b")).toBe(false);
		expect(groqModelVision("gemma2-9b-it")).toBe(false);
		expect(groqModelVision("mixtral-8x7b-32768")).toBe(false);
	});

	test("unknown model families return undefined so Settings never false-warns", () => {
		expect(groqModelVision("some-future-vision-model")).toBeUndefined();
		expect(groqModelVision("")).toBeUndefined();
	});
});

describe("Groq reasoning models run without thinking (#141)", () => {
	test("qwen3 decide requests disable provider-side reasoning", async () => {
		const body = { ...decideBody(), model: "qwen/qwen3.8-27b" };
		const parsed = JSON.parse(await captureSentBody(body)) as Record<string, unknown>;
		expect(parsed.reasoning_effort).toBe("none");
	});

	test("an existing reasoning_effort is overridden so thinking really is off", async () => {
		const parsed = JSON.parse(
			await captureSentBody({
				...decideBody(),
				model: "qwen/qwen3.8-27b",
				reasoning_effort: "auto",
			}),
		) as Record<string, unknown>;
		expect(parsed.reasoning_effort).toBe("none");
	});

	test("reasoning off composes with the sparse decide schema strip", async () => {
		const parsed = JSON.parse(
			await captureSentBody({ ...decideBody(), model: "qwen/qwen3.8-27b" }),
		) as Record<string, unknown>;
		expect(parsed.reasoning_effort).toBe("none");
		expect(parsed.response_format).toBeUndefined();
	});

	test("non-reasoning models are left untouched", async () => {
		const original = {
			model: "meta-llama/llama-4-scout-17b-16e-instruct",
			messages: [{ role: "user", content: "hi" }],
		};
		const parsed = JSON.parse(await captureSentBody(original)) as Record<string, unknown>;
		expect(parsed.reasoning_effort).toBeUndefined();
		expect(parsed).toEqual(original);
	});

	test("grounding bodies on qwen3 keep structured output but still disable reasoning", async () => {
		const parsed = JSON.parse(
			await captureSentBody({ ...groundingBody(), model: "qwen/qwen3.8-27b" }),
		) as Record<string, unknown>;
		expect(parsed.reasoning_effort).toBe("none");
		expect(parsed.response_format).toEqual(groundingBody().response_format);
	});
});

describe("Groq unchanged surfaces (#140)", () => {
	test("sparse decide schema strips while fully-required grounding keeps format", () => {
		expect(
			isSparseResponseFormatBody({
				response_format: {
					json_schema: {
						schema: {
							properties: { type: {}, x: {}, reason: {}, thoughts: {} },
							required: ["type", "reason", "thoughts"],
						},
					},
				},
			}),
		).toBe(true);
		expect(
			isSparseResponseFormatBody({
				response_format: {
					json_schema: { schema: { properties: { x: {}, y: {} }, required: ["x", "y"] } },
				},
			}),
		).toBe(false);
		expect(isSparseResponseFormatBody({ model: "m" })).toBe(false);
	});

	test("Groq auth resolution prefers explicit key then env", () => {
		const base = {
			kind: "groq" as const,
			authMode: "api_key" as const,
			baseUrl: null,
			serverUrl: null,
			defaultModel: null,
			binaryPath: null,
			env: {},
		};
		expect(resolveGroqKey({ ...base, apiKey: " sk-123 ", env: {} })).toBe("sk-123");
		expect(resolveGroqKey({ ...base, apiKey: null, env: { GROQ_API_KEY: " env-key " } })).toBe(
			"env-key",
		);
		expect(resolveGroqKey({ ...base, apiKey: null, env: {} })).toBeNull();
	});

	test("Groq OpenAI-compatible base URL defaults to api.groq.com", () => {
		const base = {
			kind: "groq" as const,
			authMode: "api_key" as const,
			apiKey: null,
			serverUrl: null,
			defaultModel: null,
			binaryPath: null,
			env: {},
		};
		expect(resolveOpenAiCompatibleBaseUrl({ ...base, baseUrl: null })).toBe(
			"https://api.groq.com/openai/v1",
		);
		expect(resolveOpenAiCompatibleBaseUrl({ ...base, baseUrl: "https://custom.test/" })).toBe(
			"https://custom.test",
		);
	});

	test("Groq driver keeps vision capability and provider surfaces", () => {
		expect(groqDriver.kind).toBe("groq");
		expect(groqDriver.capabilities.vision).toBe(true);
		expect(typeof groqDriver.vision?.completeObject).toBe("function");
		expect(typeof groqDriver.validate).toBe("function");
		expect(typeof groqDriver.listModels).toBe("function");
	});

	test("model listing reads the Groq catalog and flags known vision families", async () => {
		await withStubbedModelCatalog(
			["meta-llama/llama-4-scout-17b-16e-instruct", "qwen/qwen3-32b", "some-future-model"],
			async (probe) => {
				const result = await groqDriver.listModels(DRIVER_INPUT);

				expect(probe.urls).toEqual(["https://api.groq.com/openai/v1/models"]);
				expect(probe.authorization).toBe("Bearer test-groq-key");
				expect(result.models).toEqual([
					{
						id: "meta-llama/llama-4-scout-17b-16e-instruct",
						name: "meta-llama/llama-4-scout-17b-16e-instruct",
						vision: true,
					},
					{ id: "qwen/qwen3-32b", name: "qwen/qwen3-32b", vision: false },
					{ id: "some-future-model", name: "some-future-model" },
				]);
				expect(result.message).toBe("3 models available");
			},
		);
	});

	test("model listing needs a key and never calls the gateway without one", async () => {
		let calls = 0;
		await withCountingGateway(
			() => {
				calls += 1;
			},
			async () => {
				const result = await groqDriver.listModels({ ...DRIVER_INPUT, apiKey: null });
				expect(result).toEqual({ models: [], message: "API key required to list models" });
				expect(calls).toBe(0);
			},
		);
	});

	test("Provider auth still validates the stored key against the Groq gateway", async () => {
		await withStubbedModelCatalog(["meta-llama/llama-4-scout-17b-16e-instruct"], async (probe) => {
			const result = await groqDriver.validate(DRIVER_INPUT);
			expect(result).toEqual({
				ok: true,
				status: "connected",
				message: "Groq credentials are valid",
			});
			expect(probe.urls).toEqual(["https://api.groq.com/openai/v1/models"]);
		});
	});

	test("Provider auth reports a missing key without calling the gateway", async () => {
		let calls = 0;
		await withCountingGateway(
			() => {
				calls += 1;
			},
			async () => {
				const result = await groqDriver.validate({ ...DRIVER_INPUT, apiKey: null });
				expect(result).toEqual({
					ok: false,
					status: "invalid",
					message: "Groq API key is required",
				});
				expect(calls).toBe(0);
			},
		);
	});

	test("screenshot preparation passes empty input through unchanged", async () => {
		const image = await prepareVisionImage("");
		expect(image).toEqual({ base64: "", mediaType: "image/png" });
	});
});
