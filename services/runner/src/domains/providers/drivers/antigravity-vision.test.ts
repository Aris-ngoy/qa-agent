import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { AgentProviderError, isJsonRepairableError } from "../vision-model";
import { parseAgyDecision } from "./antigravity-vision";

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

	it("still parses salvagable JSON even when the print-timeout marker is present", () => {
		const parsed = parseAgyDecision(decisionSchema, {
			stdout: `${PRINT_TIMEOUT_OUTPUT}\n{"type":"tap","x":30,"y":40}`,
			stderr: "",
			exitCode: 0,
		});
		expect(parsed).toEqual({ type: "tap", x: 30, y: 40 });
	});
});
