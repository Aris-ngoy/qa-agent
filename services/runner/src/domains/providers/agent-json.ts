import { z } from "zod";
import { coerceLooseJson, normalizeVisionJson, salvageAgentJsonText } from "./json-salvage";
import { AgentProviderError } from "./vision-model";

export {
	clampNormCoord,
	closeTruncatedJson,
	coerceLooseJson,
	normalizeVisionJson,
	salvageAgentJsonText,
} from "./json-salvage";

/**
 * Pull a JSON object from agent CLI / model text (fenced, loose, or truncated) and parse it.
 */
export function extractAgentJsonObject(text: string, providerLabel: string): unknown {
	const snippet = text.trim().replace(/\s+/g, " ").slice(0, 160);
	const fail = (): never => {
		throw new AgentProviderError(`${providerLabel} did not return JSON (got: ${snippet})`);
	};

	const salvaged = salvageAgentJsonText(text);
	let parsed: unknown;
	try {
		parsed = JSON.parse(salvaged) as unknown;
	} catch {
		try {
			parsed = JSON.parse(coerceLooseJson(salvaged)) as unknown;
		} catch {
			fail();
		}
	}
	if (parsed === undefined || parsed === null || typeof parsed !== "object") {
		fail();
	}
	return parsed;
}

export function parseVisionObject<T>(schema: z.ZodType<T>, raw: unknown, providerLabel: string): T {
	try {
		return schema.parse(normalizeVisionJson(raw));
	} catch (error) {
		if (error instanceof z.ZodError) {
			const first = error.issues[0];
			const detail = first
				? `${first.path.length > 0 ? `${first.path.join(".")}: ` : ""}${first.message}`
				: error.message;
			throw new AgentProviderError(`${providerLabel} JSON was not a valid action: ${detail}`);
		}
		throw error;
	}
}
