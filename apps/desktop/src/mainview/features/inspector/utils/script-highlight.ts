import { caseScriptActionSchemaByType } from "@yoqa/runner-client";

export type ScriptTokenKind =
	| "comment"
	| "action"
	| "branch"
	| "key"
	| "fileKey"
	| "number"
	| "string"
	| "punctuation";

export type ScriptToken = { from: number; to: number; kind: ScriptTokenKind };

export type ScriptDiagnostic = { from: number; to: number; message: string };

/** Action names as written in a Case Script file. A Branch is written `- if:`, not `- branch:`. */
const ACTION_NAMES: ReadonlySet<string> = new Set(
	Object.keys(caseScriptActionSchemaByType).filter((type) => type !== "branch"),
);

/** Keys whose value is a list of steps, so each item's first key names an Action or a Branch. */
const STEP_LISTS: ReadonlySet<string> = new Set(["actions", "then", "else"]);

const NUMBER = /^[-+]?(\d[\d_]*(\.\d*)?|\.\d+)([eE][-+]?\d+)?$|^0x[0-9a-fA-F]+$/;

type Flow = { open: "[" | "{"; parentKey: string | null; atItemStart: boolean };

/**
 * Splits a Case Script file into coloured tokens by what they mean: Action names, Branch keywords,
 * keys, values, comments and punctuation. Reads line by line and never throws, so half-typed YAML
 * still colours; it does not validate (the parser reports errors).
 */
export function scriptTokens(text: string): ScriptToken[] {
	const tokens: ScriptToken[] = [];
	/** Block keys whose value continues on later lines, innermost last. */
	const blocks: Array<{ indent: number; key: string }> = [];
	const flows: Flow[] = [];
	/** While inside a `|` or `>` block scalar: lines indented deeper than this are its text. */
	let blockScalarIndent: number | null = null;

	let lineStart = 0;
	for (const line of text.split("\n")) {
		const start = lineStart;
		lineStart += line.length + 1;
		const indent = line.length - line.trimStart().length;
		if (indent === line.length) continue;

		if (blockScalarIndent !== null) {
			if (indent > blockScalarIndent) {
				tokens.push({ from: start + indent, to: start + line.length, kind: "string" });
				continue;
			}
			blockScalarIndent = null;
		}

		let i = indent;
		/** Column of a `- ` item on this line, so its first key is a step's Action name. */
		let dashColumn: number | null = null;
		/** The last key read on this line whose value has not started yet. */
		let pendingKey = null as { name: string; column: number } | null;
		const push = (from: number, to: number, kind: ScriptTokenKind) => {
			tokens.push({ from: start + from, to: start + to, kind });
		};
		const inFlow = () => flows.length > 0;
		const endsPlain = (at: number) => {
			const ch = line[at];
			if (ch === undefined) return true;
			if (ch === "#" && /\s/.test(line[at - 1] ?? "")) return true;
			if (ch === ":" && (line[at + 1] === undefined || /[\s,[\]{}]/.test(line[at + 1] ?? "")))
				return true;
			return inFlow() && /[,[\]{}]/.test(ch);
		};
		const isKeyColon = (at: number) =>
			line[at] === ":" &&
			(line[at + 1] === undefined ||
				/\s/.test(line[at + 1] ?? "") ||
				(inFlow() && /[,[\]{}]/.test(line[at + 1] ?? "")));

		const keyKind = (name: string, column: number, atStepStart: boolean): ScriptTokenKind => {
			if (!inFlow() && column === 0 && dashColumn === null) return "fileKey";
			if (atStepStart) {
				if (name === "if") return "branch";
				return ACTION_NAMES.has(name) ? "action" : "key";
			}
			return name === "then" || name === "else" ? "branch" : "key";
		};

		/** Whether a key at `column` starts a step: the first key of a list item under a step list. */
		const startsStep = (column: number) => {
			const flow = flows.at(-1);
			if (flow)
				return flow.open === "[" && flow.atItemStart && STEP_LISTS.has(flow.parentKey ?? "");
			if (dashColumn === null || column !== dashColumn + 2 || pendingKey) return false;
			return STEP_LISTS.has(blocks.at(-1)?.key ?? "");
		};

		const readKey = (from: number, to: number, name: string) => {
			const atStepStart = startsStep(from);
			if (!inFlow()) while ((blocks.at(-1)?.indent ?? -1) >= from) blocks.pop();
			push(from, to, keyKind(name, from, atStepStart));
			const flow = flows.at(-1);
			if (flow) flow.atItemStart = false;
			pendingKey = { name, column: from };
		};

		while (i < line.length) {
			const ch = line[i] ?? "";
			if (/\s/.test(ch)) {
				i++;
				continue;
			}
			if (ch === "#" && (i === 0 || /\s/.test(line[i - 1] ?? ""))) {
				push(i, line.length, "comment");
				break;
			}
			if (ch === "-" && !inFlow() && (line[i + 1] === undefined || /\s/.test(line[i + 1] ?? ""))) {
				while ((blocks.at(-1)?.indent ?? -1) > i) blocks.pop();
				dashColumn = i;
				pendingKey = null;
				push(i, i + 1, "punctuation");
				i++;
				continue;
			}
			if (ch === "[" || ch === "{") {
				flows.push({ open: ch, parentKey: pendingKey?.name ?? null, atItemStart: true });
				pendingKey = null;
				push(i, i + 1, "punctuation");
				i++;
				continue;
			}
			if (ch === "]" || ch === "}" || ch === ",") {
				if (ch === ",") {
					const flow = flows.at(-1);
					if (flow) flow.atItemStart = true;
				} else flows.pop();
				pendingKey = null;
				push(i, i + 1, "punctuation");
				i++;
				continue;
			}
			if (ch === ":") {
				push(i, i + 1, "punctuation");
				i++;
				continue;
			}
			if (ch === '"' || ch === "'") {
				let end = i + 1;
				while (end < line.length) {
					if (ch === '"' && line[end] === "\\") end += 2;
					else if (line[end] === ch && ch === "'" && line[end + 1] === "'") end += 2;
					else if (line[end] === ch) break;
					else end++;
				}
				end = Math.min(end + 1, line.length);
				let after = end;
				while (line[after] === " ") after++;
				if (isKeyColon(after)) readKey(i, end, line.slice(i + 1, end - 1));
				else {
					push(i, end, "string");
					pendingKey = null;
				}
				i = end;
				continue;
			}
			if ((ch === "|" || ch === ">") && pendingKey && !inFlow()) {
				blockScalarIndent = pendingKey.column;
				push(i, line.length, "punctuation");
				pendingKey = null;
				break;
			}

			// A plain scalar: a key when a `: ` follows it, otherwise a value.
			let end = i + 1;
			while (!endsPlain(end)) end++;
			let valueEnd = end;
			while (valueEnd > i && /\s/.test(line[valueEnd - 1] ?? "")) valueEnd--;
			const word = line.slice(i, valueEnd);
			if (isKeyColon(end)) readKey(i, valueEnd, word);
			else {
				push(i, valueEnd, NUMBER.test(word) ? "number" : "string");
				const flow = flows.at(-1);
				if (flow) flow.atItemStart = false;
				pendingKey = null;
			}
			i = end;
		}

		// A block key with nothing after it opens a value on the lines below.
		if (pendingKey && !inFlow()) blocks.push({ indent: pendingKey.column, key: pendingKey.name });
	}
	return tokens;
}

/** One diagnostic per error that names a line, covering that line's text (not its indent). */
export function scriptDiagnostics(
	text: string,
	errors: ReadonlyArray<{ lineNumber: number | null; message: string }>,
): ScriptDiagnostic[] {
	const lines = text.split("\n");
	const starts: number[] = [];
	let offset = 0;
	for (const line of lines) {
		starts.push(offset);
		offset += line.length + 1;
	}
	const diagnostics: ScriptDiagnostic[] = [];
	for (const error of errors) {
		if (error.lineNumber == null) continue;
		const line = lines[error.lineNumber - 1];
		const lineStart = starts[error.lineNumber - 1];
		if (line === undefined || lineStart === undefined) continue;
		const indent = line.length - line.trimStart().length;
		const to = lineStart + line.trimEnd().length;
		diagnostics.push({ from: Math.min(lineStart + indent, to), to, message: error.message });
	}
	return diagnostics;
}
