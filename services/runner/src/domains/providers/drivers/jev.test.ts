import { describe, expect, test } from "bun:test";
import { jevDriver } from "./jev";

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

const emptyInput = {
	apiKey: null as string | null,
	baseUrl: null as string | null,
	serverUrl: null as string | null,
	binaryPath: null as string | null,
	env: {} as Record<string, string>,
};

describe("jev driver", () => {
	test("probe does not require a CLI", async () => {
		const probe = await jevDriver.probe();
		expect(probe.found).toBe(true);
		expect(probe.binaryPath).toBeNull();
	});

	test("validate requires a TypeSafe API key", async () => {
		const result = await jevDriver.validate(emptyInput);
		expect(result.ok).toBe(false);
		expect(result.status).toBe("invalid");
		expect(result.message).toContain("TYPESAFE_API_KEY");
	});

	test("validate and listModels use GET /v1/models", async () => {
		const original = globalThis.fetch;
		globalThis.fetch = (async (input: string) => {
			if (String(input).includes("/v1/models")) {
				return jsonResponse({
					models: [{ name: "jev-latest", description: "alias", release_date: "2026-09-15" }],
				});
			}
			return jsonResponse({ error: String(input) }, 404);
		}) as typeof fetch;
		try {
			const input = { ...emptyInput, apiKey: "sk-test" };
			const validated = await jevDriver.validate(input);
			expect(validated.ok).toBe(true);
			expect(validated.status).toBe("connected");

			const listed = await jevDriver.listModels(input);
			expect(listed.models.map((model) => model.id)).toContain("jev-latest");
			expect(listed.models.map((model) => model.id)).toContain("jev-1.13.0");
		} finally {
			globalThis.fetch = original;
		}
	});
});
