/**
 * Groq Action-family parity at the vision-completion seam (#140).
 *
 * Every case below drives the real seam the Case executor uses for decide —
 * `decideNextAction` → `completeVision` → `groqDriver.vision.completeObject` —
 * with only the HTTP transport faked. Real prompt, real decision schema, real
 * Groq request hook (which strips structured-output mode for the sparse decide
 * shape), real salvage/repair. The executor loop is never involved.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ActiveProviderAuth } from "../providers/application";
import type { VisionImage } from "../providers/vision-model";
import type { AgentDecision } from "./agent";
import { decideNextAction } from "./agent";

const GROQ_DEFAULT_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
/** Groq decide cap (see #141) — a runaway thinking trace must fail fast. */
const GROQ_DECIDE_MAX_TOKENS = 2048;
const REASON = "Advance the current instruction";
const THOUGHTS = "The target control is visible and the next case step is unambiguous.";
const SHOT: VisionImage = { base64: "c2hvdA==", mediaType: "image/png" };

type CapturedRequest = { url: string; body: Record<string, unknown>; headers: Headers };

const realFetch = globalThis.fetch;
let captured: CapturedRequest[] = [];
/** Canned `message.content` per call; the last entry repeats for a repair retry. */
let replies: string[] = [];

function chatCompletion(content: string): unknown {
	return {
		id: "chatcmpl-groq-test",
		object: "chat.completion",
		created: 0,
		model: GROQ_DEFAULT_MODEL,
		choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
		usage: { prompt_tokens: 12, completion_tokens: 12, total_tokens: 24 },
	};
}

function stubGroqFetch(): void {
	globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
		const url = String(input);
		if (init?.method && init.method !== "POST") {
			throw new Error(`unexpected ${init.method} ${url} in a decide test`);
		}
		captured.push({
			url,
			body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
			headers: new Headers(init?.headers),
		});
		const content = replies[Math.min(captured.length - 1, replies.length - 1)] ?? "";
		return new Response(JSON.stringify(chatCompletion(content)), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}) as typeof fetch;
}

function groqAuth(overrides: Partial<ActiveProviderAuth> = {}): ActiveProviderAuth {
	return {
		id: "prov_groq_test",
		kind: "groq",
		authMode: "api_key",
		apiKey: "test-groq-key",
		baseUrl: null,
		serverUrl: null,
		defaultModel: null,
		binaryPath: null,
		env: {},
		...overrides,
	};
}

function lastRequest(): CapturedRequest {
	const last = captured[captured.length - 1];
	if (!last) throw new Error("no Groq request was sent");
	return last;
}

type MessagePart = { type: string; text?: string; image_url?: { url: string } };

/** The decide user-message text, read from the request instead of a JSON dump. */
function sentPrompt(request: CapturedRequest): string {
	const messages = request.body.messages as Array<{ role: string; content: unknown }> | undefined;
	const user = messages?.find((message) => message.role === "user");
	const parts = (user?.content ?? []) as MessagePart[];
	return parts.map((part) => part.text ?? part.image_url?.url ?? "").join("\n");
}

/** The screenshot data URL the request carried, or null when no image was attached. */
function sentImageUrl(request: CapturedRequest): string | null {
	const messages = request.body.messages as Array<{ role: string; content: unknown }> | undefined;
	const user = messages?.find((message) => message.role === "user");
	const parts = (user?.content ?? []) as MessagePart[];
	return parts.find((part) => part.type === "image_url")?.image_url?.url ?? null;
}

/** One decide call through the real Groq vision port with a canned prompt-JSON reply. */
async function decideViaGroq(
	reply: string,
	opts: { auth?: Partial<ActiveProviderAuth>; image?: VisionImage } = {},
): Promise<AgentDecision> {
	captured = [];
	replies = [reply];
	return decideNextAction({
		auth: groqAuth(opts.auth),
		appContext: "Catalog",
		caseTitle: "Browse products",
		instructions: "Open the product detail",
		expectedResult: "Product detail screen is visible",
		stepIndex: 0,
		imageBase64: "",
		image: opts.image ?? SHOT,
	});
}

async function failureMessage(promise: Promise<unknown>): Promise<string> {
	try {
		await promise;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	return "(no error)";
}

function decision(fields: Record<string, unknown>): string {
	return JSON.stringify({ reason: REASON, thoughts: THOUGHTS, ...fields });
}

beforeEach(() => {
	captured = [];
	replies = [];
	stubGroqFetch();
});

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("Groq decides every Action family at the vision seam (#140)", () => {
	const families: Array<{ name: string; reply: string; expected: Record<string, unknown> }> = [
		{
			name: "tap by screenshot coordinates",
			reply: decision({ type: "tap", x: 420, y: 780 }),
			expected: { type: "tap", x: 420, y: 780 },
		},
		{
			name: "tap by accessibility id",
			reply: decision({ type: "tap", id: "login_btn" }),
			expected: { type: "tap", id: "login_btn" },
		},
		{
			name: "tap a system label",
			reply: decision({ type: "tap", label: "Allow" }),
			expected: { type: "tap", label: "Allow" },
		},
		{
			name: "tap a grounded description",
			reply: decision({ type: "tap", description: "the blue Login button" }),
			expected: { type: "tap", description: "the blue Login button" },
		},
		{
			name: "double tap",
			reply: decision({ type: "tap", x: 500, y: 500, double: true }),
			expected: { type: "tap", x: 500, y: 500, double: true },
		},
		{
			name: "long press",
			reply: decision({ type: "tap", x: 500, y: 500, durationMs: 2000 }),
			expected: { type: "tap", x: 500, y: 500, durationMs: 2000 },
		},
		{
			name: "swipe by finger direction",
			reply: decision({ type: "swipe", direction: "up" }),
			expected: { type: "swipe", direction: "up" },
		},
		{
			name: "swipe by four coordinates",
			reply: decision({ type: "swipe", x: 500, y: 800, x2: 500, y2: 200 }),
			expected: { type: "swipe", x: 500, y: 800, x2: 500, y2: 200 },
		},
		{
			name: "drag with four coordinates",
			reply: decision({ type: "drag", x: 100, y: 500, x2: 800, y2: 500 }),
			expected: { type: "drag", x: 100, y: 500, x2: 800, y2: 500 },
		},
		{
			name: "type into a coordinate target",
			reply: decision({ type: "type", text: "hello", x: 500, y: 300 }),
			expected: { type: "type", text: "hello", x: 500, y: 300 },
		},
		{
			name: "input into a field id",
			reply: decision({ type: "input", text: "user@example.com", id: "email_field" }),
			expected: { type: "input", text: "user@example.com", id: "email_field" },
		},
		{
			name: "wait for a loading screen",
			reply: decision({ type: "wait", ms: 2000 }),
			expected: { type: "wait", ms: 2000 },
		},
		{
			name: "accept an alert",
			reply: decision({ type: "alert", alertAction: "accept" }),
			expected: { type: "alert", alertAction: "accept" },
		},
		{
			name: "dismiss an alert",
			reply: decision({ type: "alert", alertAction: "dismiss" }),
			expected: { type: "alert", alertAction: "dismiss" },
		},
		{
			name: "activate an app",
			reply: decision({ type: "activate-app", appId: "com.example.app" }),
			expected: { type: "activate-app", appId: "com.example.app" },
		},
		{
			name: "terminate an app",
			reply: decision({ type: "terminate-app", appId: "com.example.app" }),
			expected: { type: "terminate-app", appId: "com.example.app" },
		},
		{
			name: "restart an app",
			reply: decision({ type: "restart-app", appId: "com.example.app" }),
			expected: { type: "restart-app", appId: "com.example.app" },
		},
		{
			name: "background an app",
			reply: decision({ type: "background-app", seconds: 3 }),
			expected: { type: "background-app", seconds: 3 },
		},
		{
			name: "open a url",
			reply: decision({ type: "open-url", url: "https://example.com" }),
			expected: { type: "open-url", url: "https://example.com" },
		},
		{
			name: "assert visible text",
			reply: decision({ type: "assert", assertion: "visible", text: "Welcome" }),
			expected: { type: "assert", assertion: "visible", text: "Welcome" },
		},
		{
			name: "assert hidden text",
			reply: decision({ type: "assert", assertion: "not-visible", text: "Loading" }),
			expected: { type: "assert", assertion: "not-visible", text: "Loading" },
		},
		{
			name: "verify",
			reply: decision({ type: "verify" }),
			expected: { type: "verify" },
		},
		{
			name: "done",
			reply: decision({ type: "done" }),
			expected: { type: "done" },
		},
		{
			name: "fail",
			reply: decision({ type: "fail" }),
			expected: { type: "fail" },
		},
	];

	for (const family of families) {
		test(`${family.name} validates into the expected decision`, async () => {
			const result = await decideViaGroq(family.reply);

			expect(result).toMatchObject(family.expected);
			expect(result.reason).toBe(REASON);
			expect(result.thoughts).toBe(THOUGHTS);
			// Decide asks for JSON in the prompt only on Groq (#138).
			expect(lastRequest().body.response_format).toBeUndefined();
		});
	}
});

describe("Groq rejects cross-field-invalid decisions at the vision seam (#140)", () => {
	const invalid: Array<{ name: string; reply: string; message: RegExp }> = [
		{
			name: "swipe with neither direction nor coordinates",
			reply: decision({ type: "swipe" }),
			message: /not a valid action.*swipe requires direction or x,y,x2,y2/,
		},
		{
			name: "swipe with a partial coordinate pair",
			reply: decision({ type: "swipe", x: 500, y: 800 }),
			message: /not a valid action.*swipe requires direction or x,y,x2,y2/,
		},
		{
			name: "drag without a drop point",
			reply: decision({ type: "drag", x: 100, y: 500 }),
			message: /not a valid action.*drag requires x,y,x2,y2/,
		},
		{
			name: "type without text",
			reply: decision({ type: "type", x: 500, y: 300 }),
			message: /not a valid action.*type\/input requires text/,
		},
		{
			name: "input with blank text",
			reply: decision({ type: "input", text: "   ", id: "email_field" }),
			message: /not a valid action.*type\/input requires text/,
		},
		{
			name: "open-url without a url",
			reply: decision({ type: "open-url" }),
			message: /not a valid action.*open-url requires url/,
		},
		{
			name: "assert without text",
			reply: decision({ type: "assert", assertion: "visible" }),
			message: /not a valid action.*assert requires text/,
		},
		{
			name: "a decision with no reason or thoughts",
			reply: '{"type":"tap","x":100,"y":200}',
			message: /not a valid action.*reason/,
		},
		{
			name: "a decision with blank reason and thoughts",
			reply: '{"type":"tap","x":100,"y":200,"reason":"","thoughts":""}',
			message: /not a valid action/,
		},
		{
			name: "a type outside the Action families",
			reply: decision({ type: "scroll" }),
			message: /not a valid action/,
		},
	];

	for (const entry of invalid) {
		test(`${entry.name} fails as not-a-valid-action after one repair retry`, async () => {
			let retries = 0;
			captured = [];
			replies = [entry.reply];

			const message = await failureMessage(
				decideNextAction({
					auth: groqAuth(),
					appContext: "Catalog",
					caseTitle: "Browse products",
					instructions: "Open the product detail",
					expectedResult: "Product detail screen is visible",
					stepIndex: 0,
					imageBase64: "",
					image: SHOT,
					onDecideRetry: () => {
						retries += 1;
					},
				}),
			);

			expect(message).toMatch(entry.message);
			expect(retries).toBe(1);
			// First attempt plus exactly one JSON-only repair attempt.
			expect(captured).toHaveLength(2);
			expect(captured[0]?.body.response_format).toBeUndefined();
			const repairRequest = captured[1];
			if (!repairRequest) throw new Error("no repair request was sent");
			expect(sentPrompt(repairRequest)).toContain("Reply again with ONLY one strict JSON object");
		});
	}
});

describe("Groq repairable replies stay valid at the vision seam (#140)", () => {
	test("fenced single-quoted prompt JSON validates into the decision", async () => {
		const result = await decideViaGroq(
			`Sure!\n\`\`\`json\n{'type':'swipe','direction':'up','reason':'${REASON}','thoughts':'${THOUGHTS}'}\n\`\`\``,
		);
		expect(result).toMatchObject({ type: "swipe", direction: "up", reason: REASON });
	});

	test("a lightly truncated reply keeps the action and its reason", async () => {
		const result = await decideViaGroq(
			`{"type":"tap","x":420,"y":1006,"reason":"${REASON}","thoughts":"The catalog shows a product card and tapping it`,
		);
		expect(result).toMatchObject({ type: "tap", x: 420, y: 1000, reason: REASON });
	});

	test("a prose-only reply fails with what the model returned, after one retry", async () => {
		let retries = 0;
		captured = [];
		replies = ["The user should probably tap the login button next."];

		const message = await failureMessage(
			decideNextAction({
				auth: groqAuth(),
				appContext: "Catalog",
				caseTitle: "Browse products",
				instructions: "Open the product detail",
				expectedResult: "Product detail screen is visible",
				stepIndex: 0,
				imageBase64: "",
				image: SHOT,
				onDecideRetry: () => {
					retries += 1;
				},
			}),
		);

		expect(message).toMatch(/did not return JSON \(got: The user should probably tap/);
		expect(retries).toBe(1);
		expect(captured).toHaveLength(2);
	});
});

describe("Groq decide leaves its unchanged surfaces alone (#140)", () => {
	const validReply = decision({ type: "tap", x: 420, y: 780 });

	test("falls back to the Groq default vision model when none is configured", async () => {
		await decideViaGroq(validReply);
		const request = lastRequest();
		expect(request.url).toBe("https://api.groq.com/openai/v1/chat/completions");
		expect(request.body.model).toBe(GROQ_DEFAULT_MODEL);
	});

	test("a configured default model wins over the driver default", async () => {
		await decideViaGroq(validReply, {
			auth: { defaultModel: "meta-llama/llama-4-maverick-17b-128e-instruct" },
		});
		expect(lastRequest().body.model).toBe("meta-llama/llama-4-maverick-17b-128e-instruct");
	});

	test("a blank configured model falls back to the Groq default", async () => {
		await decideViaGroq(validReply, { auth: { defaultModel: "   " } });
		expect(lastRequest().body.model).toBe(GROQ_DEFAULT_MODEL);
	});

	test("keeps the decide output-token budget", async () => {
		await decideViaGroq(validReply);
		expect(lastRequest().body.max_tokens).toBe(GROQ_DECIDE_MAX_TOKENS);
	});

	test("sends the configured key as a bearer token", async () => {
		await decideViaGroq(validReply);
		expect(lastRequest().headers.get("authorization")).toBe("Bearer test-groq-key");
	});

	test("honours a custom base URL", async () => {
		await decideViaGroq(validReply, { auth: { baseUrl: "https://groq-proxy.test/v1" } });
		expect(lastRequest().url).toBe("https://groq-proxy.test/v1/chat/completions");
	});

	test("fails fast without an API key", async () => {
		// An empty value resolves to no key, so the case stays hermetic on a
		// machine that exports GROQ_API_KEY.
		const envKey = process.env.GROQ_API_KEY;
		process.env.GROQ_API_KEY = "";
		try {
			const message = await failureMessage(decideViaGroq(validReply, { auth: { apiKey: null } }));
			expect(message).toBe("Groq provider has no API key");
			expect(captured).toHaveLength(0);
		} finally {
			if (envKey === undefined) Reflect.deleteProperty(process.env, "GROQ_API_KEY");
			else process.env.GROQ_API_KEY = envKey;
		}
	});

	test("sends the prepared screenshot and the decide prompt unchanged", async () => {
		await decideViaGroq(validReply);
		const request = lastRequest();
		expect(sentImageUrl(request)).toBe("data:image/png;base64,c2hvdA==");
		expect(sentPrompt(request)).toContain(
			"Current instruction (do ONLY this): Open the product detail",
		);
		expect(sentPrompt(request)).toContain(
			'Reply with ONLY the JSON action object, including non-empty "reason" and "thoughts".',
		);
	});

	test("passes a prepared JPEG screenshot through with its own media type", async () => {
		await decideViaGroq(validReply, {
			image: { base64: "anNvbmU=", mediaType: "image/jpeg" },
		});
		expect(sentImageUrl(lastRequest())).toBe("data:image/jpeg;base64,anNvbmU=");
	});
});
