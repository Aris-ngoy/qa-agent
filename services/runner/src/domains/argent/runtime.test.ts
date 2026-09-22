import { describe, expect, test } from "bun:test";
import { runtimeStatusSchema, setupPlatformResponseSchema } from "@yoqa/runner-client";
import { ensureArgentBackend, getArgentRuntimeStatus, setupArgentPlatform } from "./runtime";

describe("getArgentRuntimeStatus", () => {
	test("keeps the stable RuntimeStatus contract", async () => {
		const status = await getArgentRuntimeStatus();
		expect(() => runtimeStatusSchema.parse(status)).not.toThrow();
	});

	test("reports Argent under the first-class argent check id", async () => {
		const status = await getArgentRuntimeStatus();
		const backend = status.checks.find((check) => check.id === "argent");
		expect(backend?.required).toBe(true);
		expect(backend?.label).toBe("Argent");
		expect(backend?.detail?.length).toBeGreaterThan(0);
		expect(status.checks.some((check) => check.id === "argent")).toBe(true);
		// Pre-cutover check ids must not come back — the legacy literal is
		// wire-compat only (old payloads), never emitted.
		expect(status.checks.some((check) => check.id === "agent-device")).toBe(false);
	});

	test("is ready against the live backend (fails closed when argent is missing)", async () => {
		const status = await getArgentRuntimeStatus();
		if (status.ready) {
			expect(status.agentDeviceVersion).toMatch(/\d+\.\d+\.\d+/);
		} else {
			const backend = status.checks.find((check) => check.id === "argent");
			expect(backend?.ok).toBe(false);
			expect(backend?.detail).toContain("npm install -g @swmansion/argent");
		}
	});
});

describe("ensureArgentBackend", () => {
	test("passes on a ready backend, otherwise explains the global install", async () => {
		try {
			const result = await ensureArgentBackend();
			expect(result.ok).toBe(true);
			expect(result.ready).toBe(true);
			expect(result.message).toContain("Argent");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect((error as Error).message).toContain("npm install -g @swmansion/argent");
		}
	});
});

describe("setupArgentPlatform", () => {
	test("verifies the platform and keeps the setup response contract", async () => {
		try {
			const result = await setupArgentPlatform("ios");
			expect(() => setupPlatformResponseSchema.parse(result)).not.toThrow();
			expect(result.platform).toBe("ios");
			expect(result.message).toContain("Argent ios ready");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect((error as Error).message).toContain("npm install -g @swmansion/argent");
		}
	});
});
