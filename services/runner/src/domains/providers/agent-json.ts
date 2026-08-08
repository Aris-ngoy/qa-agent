import { AgentProviderError } from "./vision-model";

/**
 * Pull the outermost `{...}` from agent CLI stdout (optionally fenced) and parse it.
 * Tolerates common LLM looseness: single-quoted strings and trailing commas.
 */
export function extractAgentJsonObject(text: string, providerLabel: string): unknown {
	const trimmed = text.trim();
	const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
	const candidate = fenced?.[1]?.trim() ?? trimmed;
	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");
	if (start < 0 || end <= start) {
		throw new AgentProviderError(
			`${providerLabel} did not return JSON (got: ${trimmed.replace(/\s+/g, " ").slice(0, 160)})`,
		);
	}
	const slice = candidate.slice(start, end + 1);
	try {
		return JSON.parse(slice) as unknown;
	} catch (strictError) {
		try {
			return JSON.parse(coerceLooseJson(slice)) as unknown;
		} catch {
			throw strictError;
		}
	}
}

function charAt(raw: string, index: number): string | undefined {
	return raw[index];
}

/**
 * Convert single-quoted string literals (and drop trailing commas) into strict JSON text.
 * Double-quoted regions are copied unchanged so apostrophes inside them stay intact.
 */
export function coerceLooseJson(raw: string): string {
	let out = "";
	let i = 0;
	while (i < raw.length) {
		const c = charAt(raw, i);
		if (c === undefined) break;

		if (c === '"') {
			out += c;
			i += 1;
			while (i < raw.length) {
				const d = charAt(raw, i);
				if (d === undefined) break;
				out += d;
				i += 1;
				if (d === "\\") {
					const escaped = charAt(raw, i);
					if (escaped !== undefined) {
						out += escaped;
						i += 1;
					}
					continue;
				}
				if (d === '"') break;
			}
			continue;
		}

		if (c === "'") {
			i += 1;
			let content = "";
			while (i < raw.length) {
				const d = charAt(raw, i);
				if (d === undefined) break;
				if (d === "\\" && i + 1 < raw.length) {
					const next = charAt(raw, i + 1);
					if (next === undefined) break;
					if (next === "n") content += "\n";
					else if (next === "t") content += "\t";
					else if (next === "r") content += "\r";
					else content += next;
					i += 2;
					continue;
				}
				if (d === "'") {
					i += 1;
					break;
				}
				content += d;
				i += 1;
			}
			out += JSON.stringify(content);
			continue;
		}

		if (c === ",") {
			let j = i + 1;
			while (j < raw.length) {
				const ws = charAt(raw, j);
				if (ws === undefined || !/\s/.test(ws)) break;
				j += 1;
			}
			const closer = charAt(raw, j);
			if (closer === "}" || closer === "]") {
				i += 1;
				continue;
			}
		}

		out += c;
		i += 1;
	}
	return out;
}
