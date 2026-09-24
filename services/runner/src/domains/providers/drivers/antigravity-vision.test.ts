import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { AgentProviderError, isJsonRepairableError } from "../vision-model";
import { parseAgyDecision, resolveAgyModelId } from "./antigravity-vision";

const decisionSchema = z.object({
	type: z.literal("tap"),
	x: z.number(),
	y: z.number(),
});

const PRINT_TIMEOUT_OUTPUT =
	"[agy] print timeout after 2m0s with turn in progress; returning partial output";

describe("parseAgyDecision", () => {
	it("parses a strict JSON object", () => {
		const parsed = parseAgyDecision(decisionSchema, {
			stdout: '{"type":"tap","x":10,"y":20}',
			stderr: "",
			exitCode: 0,
		});
		expect(parsed).toEqual({ type: "tap", x: 10, y: 20 });
	});

	it("extracts a fenced JSON object", () => {
		const parsed = parseAgyDecision(decisionSchema, {
			stdout: '```json\n{"type":"tap","x":1,"y":2}\n```',
			stderr: "",
			exitCode: 0,
		});
		expect(parsed).toEqual({ type: "tap", x: 1, y: 2 });
	});

	it("classifies print-timeout partial output as non-repairable", async () => {
		const error = await Promise.resolve()
			.then(() =>
				parseAgyDecision(decisionSchema, {
					stdout: PRINT_TIMEOUT_OUTPUT,
					stderr: "",
					exitCode: 0,
				}),
			)
			.then(
				() => null,
				(thrown: unknown) => thrown,
			);
		expect(error).toBeInstanceOf(AgentProviderError);
		expect((error as Error).message).toContain("print timeout");
		expect(isJsonRepairableError(error as AgentProviderError)).toBe(false);
	});

	it("classifies print-timeout partial output as non-repairable even when it fails schema validation", async () => {
		const error = await Promise.resolve()
			.then(() =>
				parseAgyDecision(decisionSchema, {
					// Valid JSON shape, wrong types: extraction succeeds, schema
					// validation fails ("was not a valid") while the marker sits
					// in stderr. Must still fail fast, not burn a repair retry.
					stdout: '{"type":"tap","x":"left-ish","y":40}',
					stderr: PRINT_TIMEOUT_OUTPUT,
					exitCode: 0,
				}),
			)
			.then(
				() => null,
				(thrown: unknown) => thrown,
			);
		expect(error).toBeInstanceOf(AgentProviderError);
		expect((error as Error).message).toContain("print timeout");
		expect(isJsonRepairableError(error as AgentProviderError)).toBe(false);
	});

	it("still parses salvagable JSON even when the print-timeout marker is present", () => {
		const parsed = parseAgyDecision(decisionSchema, {
			stdout: `${PRINT_TIMEOUT_OUTPUT}\n{"type":"tap","x":30,"y":40}`,
			stderr: "",
			exitCode: 0,
		});
		expect(parsed).toEqual({ type: "tap", x: 30, y: 40 });
	});
});

describe("resolveAgyModelId", () => {
	it("passes clean ids through", () => {
		expect(resolveAgyModelId("gemini-3.8-flash-low")).toBe("gemini-3.8-flash-low");
	});

	it("strips a legacy tab-joined display name from stored settings", () => {
		expect(resolveAgyModelId("gemini-3.8-flash-low\tGemini 3.8 Flash (Low)")).toBe(
			"gemini-3.8-flash-low",
		);
	});

	it("falls back to the default for blank input", () => {
		expect(resolveAgyModelId(null)).toBe("gemini-3.5-flash-medium");
		expect(resolveAgyModelId("   ")).toBe("gemini-3.5-flash-medium");
	});
});
