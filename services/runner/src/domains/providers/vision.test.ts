import { describe, expect, test } from "bun:test";
import type { ActiveProviderAuth } from "./application";
import { listDrivers } from "./drivers";
import { assertVisionCapableProvider, resolveVision } from "./vision";
import { AgentProviderError } from "./vision-model";

function auth(kind: ActiveProviderAuth["kind"]): ActiveProviderAuth {
	return {
		id: "prov_test",
		kind,
		authMode: "api_key",
		apiKey: "sk-test",
		baseUrl: null,
		serverUrl: null,
		binaryPath: null,
		defaultModel: null,
		env: {},
	};
}

describe("Provider vision port", () => {
	test("capabilities.vision matches presence of completeObject", () => {
		for (const driver of listDrivers()) {
			expect(Boolean(driver.vision?.completeObject)).toBe(driver.capabilities.vision);
		}
	});

	test("resolveVision returns the adapter port for a vision-capable kind", () => {
		const port = resolveVision(auth("openai"));
		expect(typeof port.completeObject).toBe("function");
	});

	test("resolveVision throws for a non-vision kind", () => {
		expect(() => resolveVision(auth("claude"))).toThrow(AgentProviderError);
	});

	test("assertVisionCapableProvider rejects missing auth", async () => {
		await expect(assertVisionCapableProvider(null)).rejects.toThrow(AgentProviderError);
	});

	test("assertVisionCapableProvider accepts a vision-capable adapter", async () => {
		const resolved = await assertVisionCapableProvider(auth("anthropic"));
		expect(resolved.kind).toBe("anthropic");
	});
});
