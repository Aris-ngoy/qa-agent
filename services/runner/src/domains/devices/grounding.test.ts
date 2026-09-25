import { describe, expect, test } from "bun:test";
import { groqDriver } from "../providers/drivers/groq";
import { groundResultSchema, parseGroundResult } from "./grounding";

describe("parseGroundResult", () => {
	test("clamps out-of-range grounding coords", () => {
		expect(parseGroundResult({ x: 500, y: 1006 })).toEqual({ x: 500, y: 1000 });
		expect(parseGroundResult({ x: -1, y: 10 })).toEqual({ x: 0, y: 10 });
	});
});

describe("Groq Grounding stays on structured output (#140)", () => {
	test("a grounding completion keeps response_format and still resolves coordinates", async () => {
		const realFetch = globalThis.fetch;
		let sentBody: Record<string, unknown> = {};
		globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
			sentBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
			return new Response(
				JSON.stringify({
					id: "chatcmpl-groq-ground",
					object: "chat.completion",
					created: 0,
					model: "meta-llama/llama-4-scout-17b-16e-instruct",
					choices: [
						{
							index: 0,
							message: { role: "assistant", content: '{"x":420,"y":880}' },
							finish_reason: "stop",
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}) as typeof fetch;

		try {
			const port = groqDriver.vision;
			if (!port) throw new Error("Groq driver exposes no vision port");
			const point = await port.completeObject({
				auth: {
					kind: "groq",
					authMode: "api_key",
					apiKey: "test-groq-key",
					baseUrl: null,
					serverUrl: null,
					defaultModel: null,
					binaryPath: null,
					env: {},
				},
				schema: groundResultSchema,
				system: "You locate UI elements on a mobile screen.",
				prompt: "Find: Allow button",
				imageBase64: "",
				image: { base64: "c2hvdA==", mediaType: "image/png" },
			});

			expect(point).toEqual({ x: 420, y: 880 });
			// The Groq hook only strips sparse decide schemas; grounding keeps strict mode.
			const format = sentBody.response_format as
				| { type: string; json_schema: { schema: { required: string[] } } }
				| undefined;
			expect(format?.type).toBe("json_schema");
			expect(format?.json_schema.schema.required).toEqual(["x", "y"]);
		} finally {
			globalThis.fetch = realFetch;
		}
	});
});
