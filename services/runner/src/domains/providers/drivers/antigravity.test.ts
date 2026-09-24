import { describe, expect, it } from "bun:test";
import { parseAgyModelsOutput } from "./antigravity";

const AGY_MODELS_SAMPLE = [
	"Fetching available models...",
	"gemini-3.8-flash-high\tGemini 3.8 Flash (High)",
	"gemini-3.8-flash-low\tGemini 3.8 Flash (Low)",
	"claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)",
	"",
].join("\n");

describe("parseAgyModelsOutput", () => {
	it("splits id and display name on the tab", () => {
		expect(parseAgyModelsOutput(AGY_MODELS_SAMPLE)).toEqual([
			{ id: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)" },
			{ id: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)" },
			{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)" },
		]);
	});

	it("never embeds the display name in the id", () => {
		for (const model of parseAgyModelsOutput(AGY_MODELS_SAMPLE)) {
			expect(model.id).not.toContain("\t");
			expect(model.id).not.toContain(" ");
		}
	});

	it("returns no rows for empty or failed output", () => {
		expect(parseAgyModelsOutput("")).toEqual([]);
		expect(parseAgyModelsOutput("Fetching available models...\nusage: agy models\n")).toEqual([]);
	});
});
