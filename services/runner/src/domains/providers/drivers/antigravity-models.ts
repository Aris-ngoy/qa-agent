import type { ModelEntry } from "./types";

/** Default Antigravity vision model — must be a CLI id, not a display name. */
export const ANTIGRAVITY_DEFAULT_VISION_MODEL = "gemini-3.8-flash-medium";

export const ANTIGRAVITY_FALLBACK_MODELS: ModelEntry[] = [
	{ id: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium)" },
	{ id: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)" },
	{ id: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro (Low)" },
	{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)" },
];

const SKIP_LINE = /^(usage|fetching|available models|error:|warning:)/i;

/**
 * `agy models` prints `id<TAB>display name` (plus a "Fetching…" header).
 * Model ids never contain whitespace; the display name is only for Settings.
 */
export function parseAgyModelLines(text: string): ModelEntry[] {
	const models: ModelEntry[] = [];
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (!line || SKIP_LINE.test(line)) continue;

		const tab = line.indexOf("\t");
		const id = (tab >= 0 ? line.slice(0, tab) : (line.split(/\s{2,}/)[0] ?? line)).trim();
		const name = (tab >= 0 ? line.slice(tab + 1) : line.slice(id.length)).trim() || id;
		if (!id || /\s/.test(id)) continue;
		models.push({ id, name });
	}
	return models;
}

/**
 * Heal Settings values that stored a whole `agy models` line
 * (`id<TAB>name` or `id name`) so `--model` gets a recognized id.
 */
export function resolveAgyModelId(
	raw: string | null | undefined,
	fallback = ANTIGRAVITY_DEFAULT_VISION_MODEL,
): string {
	const trimmed = raw?.trim();
	if (!trimmed) return fallback;
	const tab = trimmed.indexOf("\t");
	const id = (tab >= 0 ? trimmed.slice(0, tab) : (trimmed.split(/\s+/)[0] ?? trimmed)).trim();
	return id || fallback;
}
