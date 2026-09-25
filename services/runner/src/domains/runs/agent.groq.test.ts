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
/** A real 1×1 PNG, so the adapter's own screenshot preparation runs for it. */
const TINY_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type CapturedRequest = { url: string; body: Record<string, unknown>; headers: Headers };

const realFetch = globalThis.fetch;
let captured: CapturedRequest[] = [];
/** Canned `message.content` per call; the last entry repeats for a repair retry. */
let replies: string[] = [];
/** Non-200 response to serve instead of a completion, for provider error paths. */
let errorResponse: (() => Response) | null = null;

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
		if (errorResponse) return errorResponse();
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

/** The parts of the decide user message (screenshot + prompt) as sent. */
function sentUserParts(request: CapturedRequest): MessagePart[] {
	const messages = request.body.messages as Array<{ role: string; content: unknown }> | undefined;
	const user = messages?.find((message) => message.role === "user");
	return (user?.content ?? []) as MessagePart[];
}

/** The decide user-message text, read from the request instead of a JSON dump. */
function sentPrompt(request: CapturedRequest): string {
	return sentUserParts(request)
		.map((part) => part.text ?? part.image_url?.url ?? "")
		.join("\n");
}

/** The screenshot data URL the request carried, or null when no image was attached. */
function sentImageUrl(request: CapturedRequest): string | null {
	return sentUserParts(request).find((part) => part.type === "image_url")?.image_url?.url ?? null;
}

/** The decide system message, which carries the reason/thoughts contract. */
function sentSystemPrompt(request: CapturedRequest): string {
	const messages = request.body.messages as Array<{ role: string; content: unknown }> | undefined;
	const system = messages?.find((message) => message.role === "system");
	return typeof system?.content === "string" ? system.content : "";
}

type DecideOptions = {
	auth?: Partial<ActiveProviderAuth>;
	image?: VisionImage;
	imageBase64?: string;
	/** Catalog app id offered to the model for activate/terminate/restart. */
	defaultAppId?: string;
	onDecideRetry?: () => void;
};

function runDecide(opts: DecideOptions): Promise<AgentDecision> {
	return decideNextAction({
		auth: groqAuth(opts.auth),
		appContext: "Catalog",
		caseTitle: "Browse products",
		instructions: "Open the product detail",
		expectedResult: "Product detail screen is visible",
		stepIndex: 0,
		imageBase64: opts.imageBase64 ?? "",
		image: opts.image,
		defaultAppId: opts.defaultAppId,
		onDecideRetry: opts.onDecideRetry,
	});
}

/** One decide call with a pre-prepared screenshot — the shape the Case executor sends. */
function decideViaGroq(
	reply: string,
	opts: Omit<DecideOptions, "imageBase64"> = {},
): Promise<AgentDecision> {
	captured = [];
	replies = [reply];
	return runDecide({ image: opts.image ?? SHOT, ...opts });
}

/** One decide call from a raw screenshot, so the adapter's own preparation runs. */
function decideFromRawScreenshot(
	reply: string,
	imageBase64: string,
	opts: Omit<DecideOptions, "image" | "imageBase64"> = {},
): Promise<AgentDecision> {
	captured = [];
	replies = [reply];
	return runDecide({ imageBase64, ...opts });
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
	errorResponse = null;
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
			// appId is optional: the executor falls back to the catalog app id, which
			// the prompt below proves the model was given.
			name: "activate an app without an explicit app id",
			reply: decision({ type: "activate-app" }),
			expected: { type: "activate-app" },
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
			// The shared Runs schema treats an omitted assertion as visible at the
			// executor, matching the saved-script and ActionRequest defaults.
			name: "assert text with no explicit assertion",
			reply: decision({ type: "assert", text: "Welcome" }),
			expected: { type: "assert", text: "Welcome" },
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
		{
			name: "an alert with an action outside accept/dismiss",
			reply: decision({ type: "alert", alertAction: "later" }),
			message: /not a valid action/,
		},
		{
			name: "an assert with an assertion outside visible/not-visible",
			reply: decision({ type: "assert", assertion: "maybe", text: "Welcome" }),
			message: /not a valid action/,
		},
	];

	for (const entry of invalid) {
		test(`${entry.name} fails as not-a-valid-action after one repair retry`, async () => {
			let retries = 0;

			const message = await failureMessage(
				decideViaGroq(entry.reply, {
					onDecideRetry: () => {
						retries += 1;
					},
				}),
			);

			expect(message).toMatch(entry.message);
			// The label proves the Groq adapter produced this, not another Provider.
			expect(message).toContain("Groq JSON was not a valid action");
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

		const message = await failureMessage(
			decideViaGroq("The user should probably tap the login button next.", {
				onDecideRetry: () => {
					retries += 1;
				},
			}),
		);

		expect(message).toMatch(/did not return JSON \(got: The user should probably tap/);
		expect(retries).toBe(1);
		expect(captured).toHaveLength(2);
	});

	test("a reply with only one explainer field is filled so the timeline stays explainable", async () => {
		// Documented salvage (see docs/runs/vision-json-salvage.md): the missing
		// explainer field is copied from the one the model did send, so a decision
		// never reaches the Run with a blank reason or thoughts.
		const result = await decideViaGroq(
			JSON.stringify({ type: "tap", x: 420, y: 780, reason: REASON }),
		);
		expect(result).toMatchObject({ type: "tap", reason: REASON, thoughts: REASON });
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
		// Pinned on purpose: any change to the Groq decide cap must be a conscious
		// decision, not a silent drift.
		expect(lastRequest().body.max_tokens).toBe(GROQ_DECIDE_MAX_TOKENS);
	});

	test("offers the catalog app id when a lifecycle decision omits one", async () => {
		const result = await decideViaGroq(decision({ type: "activate-app" }), {
			defaultAppId: "com.example.app",
		});
		expect(result.appId).toBeUndefined();
		expect(sentPrompt(lastRequest())).toContain(
			"Catalog app id (activate/terminate/restart): com.example.app",
		);
	});

	test("prepares a raw screenshot and still attaches it to the decide request", async () => {
		const result = await decideFromRawScreenshot(validReply, TINY_PNG_BASE64);
		expect(result).toMatchObject({ type: "tap", x: 420, y: 780 });
		// Preparation may resize to JPEG (macOS) or pass the PNG through; either way
		// the model must receive a real, non-empty screenshot payload.
		expect(sentImageUrl(lastRequest())).toMatch(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/);
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

	test("turns a strict-schema 400 into concise guidance at the decide seam", async () => {
		// The raw gateway complaint, which must not reach the user verbatim.
		const rawGatewayMessage =
			"invalid JSON schema for response_format: required must include every key in properties: alertAction, appId, assertion";
		errorResponse = () =>
			new Response(JSON.stringify({ error: { message: rawGatewayMessage } }), {
				status: 400,
				headers: { "content-type": "application/json" },
			});

		const message = await failureMessage(decideViaGroq(validReply));
		expect(message).toContain("Groq rejected strict JSON schema mode");
		expect(message).toContain("prompt JSON");
		// Concise means the gateway payload is gone, not just quoted once. The
		// message may name the Groq API concept, but never the internal field list.
		expect(message).not.toContain(rawGatewayMessage);
		expect(message).not.toContain("invalid JSON schema");
		expect(message).not.toContain("alertAction");
		expect(message).not.toContain("assertion");
		// A rejected schema is not a malformed reply: no repair retry.
		expect(captured).toHaveLength(1);
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

	test("the decide system message still demands both explainer fields", async () => {
		await decideViaGroq(validReply);
		const system = sentSystemPrompt(lastRequest());
		expect(system).toContain('"reason": one short sentence summarizing the action choice');
		expect(system).toContain('"thoughts": 2–4 sentences');
	});

	test("passes a prepared JPEG screenshot through with its own media type", async () => {
		await decideViaGroq(validReply, {
			image: { base64: "anNvbmU=", mediaType: "image/jpeg" },
		});
		expect(sentImageUrl(lastRequest())).toBe("data:image/jpeg;base64,anNvbmU=");
	});
});
