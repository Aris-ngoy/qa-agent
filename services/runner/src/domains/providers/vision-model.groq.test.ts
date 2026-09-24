import { describe, expect, test } from "bun:test";
import { withGroqRequestHooks } from "./vision-model";

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
});
