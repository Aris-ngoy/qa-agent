/**
 * Salvage near-miss LLM JSON (fences, single quotes, trailing commas,
 * truncated strings/braces) and clamp common vision numeric fields.
 */

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

function tryParseJson(text: string): unknown | undefined {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}

/** Close an unclosed JSON string and emit missing `}` / `]` after a truncated object. */
export function closeTruncatedJson(raw: string): string {
	let inString = false;
	let escaped = false;
	const stack: Array<"{" | "["> = [];

	for (let i = 0; i < raw.length; i += 1) {
		const c = charAt(raw, i);
		if (c === undefined) break;

		if (inString) {
			if (escaped) {
				escaped = false;
				continue;
			}
			if (c === "\\") {
				escaped = true;
				continue;
			}
			if (c === '"') inString = false;
			continue;
		}

		if (c === '"') {
			inString = true;
			continue;
		}
		if (c === "{") stack.push("{");
		else if (c === "[") stack.push("[");
		else if (c === "}" || c === "]") stack.pop();
	}

	let out = raw;
	if (inString) {
		if (escaped) out = out.slice(0, -1);
		out += '"';
	}
	while (stack.length > 0) {
		const open = stack.pop();
		out += open === "{" ? "}" : "]";
	}
	return out;
}

/**
 * Unwrap markdown fences, take from the first `{`, close truncation, and coerce loose JSON.
 * Returns the first variant that `JSON.parse`s; otherwise the best-effort closed text.
 */
export function salvageAgentJsonText(text: string): string {
	const trimmed = text.trim();
	const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
	const inner = fenced?.[1]?.trim() ?? trimmed;
	const start = inner.indexOf("{");
	if (start < 0) return trimmed;

	const fromBrace = inner.slice(start);
	const lastBrace = fromBrace.lastIndexOf("}");
	const candidates = lastBrace > 0 ? [fromBrace.slice(0, lastBrace + 1), fromBrace] : [fromBrace];

	for (const candidate of candidates) {
		const variants = [
			candidate,
			coerceLooseJson(candidate),
			closeTruncatedJson(candidate),
			closeTruncatedJson(coerceLooseJson(candidate)),
		];
		for (const variant of variants) {
			if (tryParseJson(variant) !== undefined) return variant;
		}
	}

	return closeTruncatedJson(coerceLooseJson(fromBrace));
}

export function clampNormCoord(n: number): number {
	if (!Number.isFinite(n)) return n;
	return Math.min(1000, Math.max(0, n));
}

/**
 * Clamp vision x/y/x2/y2 (and wait ms / durationMs) and copy reason↔thoughts when one is missing.
 * Safe to run on grounding `{x,y}` objects (extra fields are ignored).
 */
export function normalizeVisionJson(value: unknown): unknown {
	if (!value || typeof value !== "object" || Array.isArray(value)) return value;
	const out: Record<string, unknown> = { ...value };

	if (typeof out.x === "number") out.x = clampNormCoord(out.x);
	if (typeof out.y === "number") out.y = clampNormCoord(out.y);
	if (typeof out.x2 === "number") out.x2 = clampNormCoord(out.x2);
	if (typeof out.y2 === "number") out.y2 = clampNormCoord(out.y2);
	if (typeof out.ms === "number" && Number.isFinite(out.ms)) {
		out.ms = Math.min(10_000, Math.max(0, out.ms));
	}
	if (typeof out.durationMs === "number" && Number.isFinite(out.durationMs)) {
		out.durationMs = Math.min(5_000, Math.max(50, Math.round(out.durationMs)));
	}

	const reason = typeof out.reason === "string" ? out.reason.trim() : "";
	const thoughts = typeof out.thoughts === "string" ? out.thoughts.trim() : "";
	if (reason) out.reason = reason;
	if (thoughts) out.thoughts = thoughts;
	if (reason && !thoughts) out.thoughts = reason;
	if (thoughts && !reason) out.reason = thoughts;
	return out;
}
