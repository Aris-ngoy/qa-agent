import { describe, expect, test } from "bun:test";
import {
	ANTIGRAVITY_DEFAULT_VISION_MODEL,
	parseAgyModelLines,
	resolveAgyModelId,
} from "./antigravity-models";

const AGY_MODELS_STDOUT = `Fetching available models...
gemini-3.8-flash-high	Gemini 3.8 Flash (High)
gemini-3.8-flash-medium	Gemini 3.8 Flash (Medium)
gemini-3.8-flash-low	Gemini 3.8 Flash (Low)
gemini-3.6-flash-low	Gemini 3.6 Flash (Low)
claude-sonnet-4-6	Claude Sonnet 4.6 (Thinking)
`;

describe("parseAgyModelLines", () => {
	test("splits tab-separated id and display name and skips the fetching header", () => {
		expect(parseAgyModelLines(AGY_MODELS_STDOUT)).toEqual([
			{ id: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)" },
			{ id: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium)" },
			{ id: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)" },
			{ id: "gemini-3.6-flash-low", name: "Gemini 3.6 Flash (Low)" },
			{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)" },
		]);
	});

	test("treats a bare id line as both id and name", () => {
		expect(parseAgyModelLines("gemini-3.8-flash-low\n")).toEqual([
			{ id: "gemini-3.8-flash-low", name: "gemini-3.8-flash-low" },
		]);
	});

	test("drops prose lines that are not model ids", () => {
		expect(
			parseAgyModelLines("Usage of agy:\nAvailable models:\nnot a model id with spaces\n"),
		).toEqual([]);
	});
});

describe("resolveAgyModelId", () => {
	test("strips a stored tab-separated display name before --model", () => {
		expect(resolveAgyModelId("gemini-3.6-flash-low\tGemini 3.6 Flash (Low)")).toBe(
			"gemini-3.6-flash-low",
		);
	});

	test("strips a space-normalized display name", () => {
		expect(resolveAgyModelId("gemini-3.6-flash-low Gemini 3.6 Flash (Low)")).toBe(
			"gemini-3.6-flash-low",
		);
	});

	test("passes through a clean id and falls back when empty", () => {
		expect(resolveAgyModelId("gemini-3.8-flash-low")).toBe("gemini-3.8-flash-low");
		expect(resolveAgyModelId("   ")).toBe(ANTIGRAVITY_DEFAULT_VISION_MODEL);
		expect(resolveAgyModelId(null)).toBe(ANTIGRAVITY_DEFAULT_VISION_MODEL);
	});
});
