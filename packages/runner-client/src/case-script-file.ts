import {
	type Document,
	LineCounter,
	type Node as YamlNode,
	isMap,
	isNode,
	isScalar,
	isSeq,
	parseDocument,
	stringify,
} from "yaml";
import { z } from "zod";
import {
	type CaseScript,
	type CaseScriptAction,
	type CaseScriptActionType,
	type CaseScriptBranch,
	type ScreenElement,
	caseScriptActionSchemaByType,
} from "./schemas";
import { shellToCaseScript } from "./shell-script";

/** Extension used when exporting a Case Script file. */
export const CASE_SCRIPT_FILE_EXTENSION = ".yoqa.yaml";

/** File picker filter for anything that can be read as a Case Script file (plus legacy shell). */
export const CASE_SCRIPT_FILE_ACCEPT = ".yaml,.yml,.json,.sh";

/** One step into a Branch: its side and the 1-based position of an action there. */
export type CaseScriptFileErrorNesting = { side: "then" | "else"; action: number };

export type CaseScriptFileError = {
	/** 1-based line in the file, when the problem has a position. */
	line: number | null;
	/** 1-based position in `actions`, when the problem belongs to one action. */
	action: number | null;
	/** Inside a Branch: the path from the top-level action down, outermost first. */
	nested?: CaseScriptFileErrorNesting[];
	message: string;
};

export type ParseCaseScriptFileOptions = {
	/** `savedAt` for a file that does not carry one. Default `Date.now()`. */
	savedAt?: number;
	/** Accept a file with no actions yet (the Inspector's editor while recording). */
	allowEmpty?: boolean;
};

export type ParsedCaseScriptFile = {
	ok: true;
	script: CaseScript;
	name: string | null;
	/** 1-based line of each action, in order. */
	actionLines: number[];
};

export type ParseCaseScriptFileResult =
	| ParsedCaseScriptFile
	| { ok: false; errors: CaseScriptFileError[] };

export type FormatCaseScriptFileOptions = {
	/** Test Case name, written as `name:`. */
	name?: string | null;
};

/** Every Action type; a Branch is read from its own item key. */
type ActionType = Exclude<CaseScriptActionType, "branch">;

const ACTION_TYPES = (Object.keys(caseScriptActionSchemaByType) as CaseScriptActionType[]).filter(
	(type): type is ActionType => type !== "branch",
);

/** The item key of a Branch (`- if:`); its model type is `branch`. */
const BRANCH_KEY = "if";

/** Everything a Case Script file item can be named. */
const ITEM_NAMES = [...ACTION_TYPES, BRANCH_KEY];

/** Fields of an `if:` map, in exported order (`label` is read as `text`, never written). */
const BRANCH_FIELDS = ["text", "label", "id", "assertion", "timeoutMs", "then", "else", "reason"];

/** The field a scalar short form (`tap: Home`) fills, per action. */
const SHORT_FORM_FIELD: Partial<Record<CaseScriptActionType, string>> = {
	tap: "label",
	type: "text",
	wait: "ms",
	assert: "text",
	alert: "alertAction",
	"open-url": "url",
	"activate-app": "appId",
	"terminate-app": "appId",
	"restart-app": "appId",
	"background-app": "seconds",
	key: "key",
};

/** Short-form fields that hold text, so a bare number or boolean is read as text. */
const TEXT_SHORT_FORM_FIELDS = new Set(["label", "text", "alertAction", "url", "appId", "key"]);

/** Exported key order inside a long-form action. */
const FIELD_ORDER = [
	"label",
	"id",
	"text",
	"appId",
	"url",
	"key",
	"modifiers",
	"assertion",
	"alertAction",
	"x",
	"y",
	"x2",
	"y2",
	"ms",
	"seconds",
	"timeoutMs",
	"double",
	"durationMs",
	"reason",
];

const TOP_LEVEL_KEYS = new Set(["version", "name", "sourceRunId", "savedAt", "actions"]);

function isActionType(value: unknown): value is ActionType {
	return typeof value === "string" && (ACTION_TYPES as string[]).includes(value);
}

function actionFieldNames(type: ActionType): Set<string> {
	const schema = caseScriptActionSchemaByType[type];
	const object = schema instanceof z.ZodEffects ? schema.innerType() : schema;
	return new Set(Object.keys(object.shape).filter((key) => key !== "type"));
}

function lineOf(node: YamlNode | null | undefined, lineCounter: LineCounter): number | null {
	const start = node?.range?.[0];
	return start == null ? null : lineCounter.linePos(start).line;
}

function zodMessage(error: z.ZodError): string {
	return error.issues
		.map((issue) =>
			issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
		)
		.join("; ");
}

type ActionReadResult = { ok: true; action: CaseScriptAction } | { ok: false; message: string };

function readAction(raw: unknown, legacy: boolean): ActionReadResult {
	if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
		return { ok: false, message: "expected an action such as `- tap: Home`" };
	}
	const entries = Object.entries(raw as Record<string, unknown>);

	let type: ActionType;
	let fields: Record<string, unknown>;
	if (legacy) {
		const declared = (raw as Record<string, unknown>).type;
		if (!isActionType(declared)) {
			return { ok: false, message: `unknown action type ${JSON.stringify(declared)}` };
		}
		type = declared;
		fields = Object.fromEntries(entries.filter(([key]) => key !== "type"));
	} else {
		if (entries.length !== 1) {
			return {
				ok: false,
				message: `an action has exactly one key (its name); found ${entries.map(([key]) => key).join(", ") || "none"}`,
			};
		}
		const [key, value] = entries[0] as [string, unknown];
		if (!isActionType(key)) {
			return {
				ok: false,
				message: `unknown action "${key}" (expected one of: ${ITEM_NAMES.join(", ")})`,
			};
		}
		type = key;
		if (value == null) {
			fields = {};
		} else if (typeof value === "object" && !Array.isArray(value)) {
			fields = value as Record<string, unknown>;
		} else if (Array.isArray(value)) {
			return { ok: false, message: `${type}: expected a value or a map of fields, not a list` };
		} else {
			const field = SHORT_FORM_FIELD[type];
			if (!field) {
				return { ok: false, message: `${type} has no short form; write it as a map of fields` };
			}
			fields = {
				[field]:
					TEXT_SHORT_FORM_FIELDS.has(field) && typeof value !== "string" ? String(value) : value,
			};
		}
	}

	const allowed = actionFieldNames(type);
	const unknown = Object.keys(fields).filter((key) => !allowed.has(key));
	if (unknown.length > 0) {
		return {
			ok: false,
			message: `${type}: unknown field ${unknown.map((key) => `"${key}"`).join(", ")} (allowed: ${[...allowed].join(", ")})`,
		};
	}

	const parsed = caseScriptActionSchemaByType[type].safeParse({ type, ...fields });
	if (!parsed.success) {
		return { ok: false, message: `${type}: ${zodMessage(parsed.error)}` };
	}
	return { ok: true, action: parsed.data as CaseScriptAction };
}

type ItemReader = {
	doc: Document;
	lineCounter: LineCounter;
	legacy: boolean;
	errors: CaseScriptFileError[];
};

/** Where an item sits: its top-level action and, inside Branches, the path down to it. */
type ItemPosition = { action: number; nested: CaseScriptFileErrorNesting[] };

function pushItemError(
	reader: ItemReader,
	line: number | null,
	at: ItemPosition,
	message: string,
): void {
	reader.errors.push({
		line,
		action: at.action,
		...(at.nested.length > 0 ? { nested: at.nested } : {}),
		message,
	});
}

/** The value of a Branch item (`- if: …`, or a legacy `type: branch`), or null for an Action. */
function branchValue(item: unknown, legacy: boolean): { value: unknown } | null {
	if (!isMap(item)) return null;
	if (legacy) return item.get("type") === "branch" ? { value: item } : null;
	const only = item.items.length === 1 ? item.items[0] : undefined;
	const key = only && isScalar(only.key) ? only.key.value : null;
	return key === BRANCH_KEY ? { value: only?.value ?? null } : null;
}

/** Read one list item (an Action or a Branch), recording its errors. Null when it has any. */
function readItem(reader: ItemReader, item: unknown, at: ItemPosition): CaseScriptAction | null {
	const line = lineOf(item as YamlNode, reader.lineCounter);
	const branch = branchValue(item, reader.legacy);
	if (branch) return readBranch(reader, branch.value, line, at);
	const raw = isNode(item) ? item.toJS(reader.doc) : item;
	const result = readAction(raw, reader.legacy);
	if (result.ok) return result.action;
	pushItemError(reader, line, at, result.message);
	return null;
}

function readBranch(
	reader: ItemReader,
	value: unknown,
	itemLine: number | null,
	at: ItemPosition,
): CaseScriptAction | null {
	const name = reader.legacy ? "branch" : BRANCH_KEY;
	if (!isMap(value)) {
		pushItemError(
			reader,
			itemLine,
			at,
			`${name} has no short form; write it as a map with \`text:\` and \`then:\``,
		);
		return null;
	}
	let ok = true;
	const fail = (line: number | null, message: string) => {
		pushItemError(reader, line ?? itemLine, at, `${name}: ${message}`);
		ok = false;
	};
	const keyLine = (key: string) => {
		const pair = value.items.find((item) => isScalar(item.key) && item.key.value === key);
		return lineOf(pair?.key as YamlNode | undefined, reader.lineCounter);
	};
	const field = (key: string): unknown => {
		const node = value.get(key, true);
		return isNode(node) ? node.toJS(reader.doc) : node;
	};

	const unknown = value.items
		.map((item) => (isScalar(item.key) ? item.key.value : item.key))
		.filter((key) => !(reader.legacy && key === "type"))
		.filter((key) => typeof key !== "string" || !BRANCH_FIELDS.includes(key));
	if (unknown.length > 0) {
		fail(
			keyLine(String(unknown[0])),
			`unknown field ${unknown.map((key) => `"${String(key)}"`).join(", ")} (allowed: ${BRANCH_FIELDS.join(", ")})`,
		);
	}

	const text = field("text");
	const label = field("label");
	const id = field("id");
	if (text != null && label != null) fail(keyLine("label"), "write `text` or `label`, not both");
	const textTarget = text ?? label;
	if (textTarget != null && id != null) fail(keyLine("id"), "write `text` or `id`, not both");
	if (textTarget == null && id == null) {
		fail(itemLine, "needs `text:` or `id:` (what to look for on the Screen)");
	}

	const readSide = (side: "then" | "else"): CaseScriptAction[] | undefined => {
		const node = value.get(side, true);
		if (node == null || (isScalar(node) && node.value == null)) return undefined;
		if (!isSeq(node)) {
			fail(keyLine(side), `${side} must be a list of actions (each item starts with \`- \`)`);
			return undefined;
		}
		const actions: CaseScriptAction[] = [];
		node.items.forEach((item, index) => {
			const action = readItem(reader, item, {
				action: at.action,
				nested: [...at.nested, { side, action: index + 1 }],
			});
			if (action) actions.push(action);
			else ok = false;
		});
		return actions;
	};
	const then = readSide("then");
	if (ok && (then == null || then.length === 0)) {
		fail(then == null ? itemLine : keyLine("then"), "needs `then:` with at least one action");
	}
	const otherwise = readSide("else");
	if (!ok) return null;

	const fields = Object.fromEntries(
		["assertion", "timeoutMs", "reason"]
			.map((key) => [key, field(key)] as const)
			.filter(([, fieldValue]) => fieldValue !== undefined),
	);
	const parsed = caseScriptActionSchemaByType.branch.safeParse({
		type: "branch",
		...(id != null ? { id: String(id) } : { text: String(textTarget) }),
		...fields,
		then,
		...(otherwise ? { else: otherwise } : {}),
	});
	if (!parsed.success) {
		pushItemError(reader, itemLine, at, `${name}: ${zodMessage(parsed.error)}`);
		return null;
	}
	const { else: elseActions, ...branch } = parsed.data;
	return elseActions ? { ...branch, else: elseActions } : branch;
}

function documentErrors(doc: Document, lineCounter: LineCounter): CaseScriptFileError[] {
	return doc.errors.map((error) => ({
		line: lineCounter.linePos(error.pos[0]).line,
		action: null,
		message: error.message,
	}));
}

/**
 * Read a Case Script file: YAML (`*.yoqa.yaml`) or a legacy `.yoqa.json` export
 * (JSON is valid YAML). A legacy file is one with `savedAt`; its actions carry `type`.
 */
export function parseCaseScriptFile(
	text: string,
	options: ParseCaseScriptFileOptions = {},
): ParseCaseScriptFileResult {
	const lineCounter = new LineCounter();
	const doc = parseDocument(text, { lineCounter, prettyErrors: false });
	if (doc.errors.length > 0) {
		return { ok: false, errors: documentErrors(doc, lineCounter) };
	}

	const root = doc.contents;
	if (!isMap(root)) {
		return {
			ok: false,
			errors: [
				{
					line: lineOf(root, lineCounter) ?? 1,
					action: null,
					message: "expected a Case Script with `version: 1` and `actions:`",
				},
			],
		};
	}

	const errors: CaseScriptFileError[] = [];
	const top = root.toJS(doc) as Record<string, unknown>;
	for (const pair of root.items) {
		const key = isScalar(pair.key) ? pair.key.value : pair.key;
		if (typeof key !== "string" || !TOP_LEVEL_KEYS.has(key)) {
			errors.push({
				line: lineOf(pair.key as YamlNode, lineCounter),
				action: null,
				message: `unknown key "${String(key)}" (allowed: ${[...TOP_LEVEL_KEYS].join(", ")})`,
			});
		}
	}

	const versionNode = root.get("version", true) as YamlNode | undefined;
	if (top.version !== 1) {
		errors.push({
			line: lineOf(versionNode, lineCounter) ?? 1,
			action: null,
			message:
				top.version === undefined
					? "missing `version: 1`"
					: `unsupported version ${JSON.stringify(top.version)} (expected 1)`,
		});
	}

	const name = top.name;
	if (name != null && typeof name !== "string") {
		errors.push({
			line: lineOf(root.get("name", true) as YamlNode, lineCounter),
			action: null,
			message: "name must be text",
		});
	}
	const sourceRunId = top.sourceRunId;
	if (sourceRunId != null && (typeof sourceRunId !== "string" || sourceRunId.length === 0)) {
		errors.push({
			line: lineOf(root.get("sourceRunId", true) as YamlNode, lineCounter),
			action: null,
			message: "sourceRunId must be text",
		});
	}
	const savedAt = top.savedAt;
	const legacy = savedAt !== undefined;
	if (legacy && (typeof savedAt !== "number" || !Number.isInteger(savedAt) || savedAt < 0)) {
		errors.push({
			line: lineOf(root.get("savedAt", true) as YamlNode, lineCounter),
			action: null,
			message: "savedAt must be a non-negative whole number",
		});
	}

	const actionsNode = root.get("actions", true) as YamlNode | undefined;
	const actions: CaseScriptAction[] = [];
	const actionLines: number[] = [];
	if (actionsNode != null && !(isScalar(actionsNode) && actionsNode.value == null)) {
		if (!isSeq(actionsNode)) {
			errors.push({
				line: lineOf(actionsNode, lineCounter),
				action: null,
				message: "actions must be a list (each item starts with `- `)",
			});
		} else {
			const reader: ItemReader = { doc, lineCounter, legacy, errors };
			actionsNode.items.forEach((item, index) => {
				const action = readItem(reader, item, { action: index + 1, nested: [] });
				if (action) {
					actions.push(action);
					actionLines.push(lineOf(item as YamlNode, lineCounter) ?? 0);
				}
			});
		}
	} else if (!root.has("actions")) {
		errors.push({ line: null, action: null, message: "missing `actions:`" });
	}

	if (errors.length === 0 && actions.length === 0 && !options.allowEmpty) {
		errors.push({
			line: lineOf(actionsNode, lineCounter),
			action: null,
			message: "actions: add at least one action",
		});
	}

	if (errors.length > 0) {
		return {
			ok: false,
			errors: errors.sort(
				(a, b) => (a.line ?? Number.POSITIVE_INFINITY) - (b.line ?? Number.POSITIVE_INFINITY),
			),
		};
	}

	return {
		ok: true,
		name: typeof name === "string" && name.trim().length > 0 ? name.trim() : null,
		actionLines,
		script: {
			version: 1,
			...(typeof sourceRunId === "string" ? { sourceRunId } : {}),
			savedAt: typeof savedAt === "number" ? savedAt : (options.savedAt ?? Date.now()),
			actions,
		},
	};
}

/** `Line 4, action 2: tap: …` (or `action 2 → then → action 1` inside a Branch) — one line per error. */
export function formatCaseScriptFileErrors(errors: CaseScriptFileError[]): string {
	return errors
		.map((error) => {
			const nested = (error.nested ?? [])
				.map((step) => ` → ${step.side} → action ${step.action}`)
				.join("");
			const where = [
				error.line != null ? `Line ${error.line}` : null,
				error.action != null ? `action ${error.action}${nested}` : null,
			]
				.filter(Boolean)
				.join(", ");
			return where ? `${where}: ${error.message}` : error.message;
		})
		.join("\n");
}

const FLOW_OPTIONS = {
	collectionStyle: "flow",
	lineWidth: 0,
	blockQuote: false,
	flowCollectionPadding: false,
} as const;

/**
 * One scalar, quoted so it is safe both as a block value and inside a `{ … }` action map
 * (where `,` `[` `]` `{` `}` are indicators). Text with line breaks is double-quoted on one line.
 */
function yamlScalar(value: unknown): string {
	if (typeof value === "string" && /[\n\r\t]/.test(value)) return JSON.stringify(value);
	return stringify([value], FLOW_OPTIONS).trim().slice(1, -1);
}

function orderedFields(
	action: Exclude<CaseScriptAction, CaseScriptBranch>,
): Array<[string, unknown]> {
	const fields = Object.entries(action).filter(
		([key, value]) => key !== "type" && value !== undefined,
	);
	// Defaults read back the same, so leave them out of a long-form map.
	const meaningful = fields.filter(
		([key, value]) =>
			!(action.type === "assert" && key === "assertion" && value === "visible") &&
			!(action.type === "alert" && key === "alertAction" && value === "accept"),
	);
	const rank = (key: string) => {
		const at = FIELD_ORDER.indexOf(key);
		return at < 0 ? FIELD_ORDER.length : at;
	};
	return meaningful.sort(([a], [b]) => rank(a) - rank(b));
}

/** A Branch's own fields, in exported order, defaults left out. */
function branchFields(branch: CaseScriptBranch): Array<[string, unknown]> {
	const fields: Array<[string, unknown]> =
		branch.id != null ? [["id", branch.id]] : [["text", branch.text]];
	if (branch.assertion === "not-visible") fields.push(["assertion", branch.assertion]);
	if (branch.timeoutMs != null) fields.push(["timeoutMs", branch.timeoutMs]);
	if (branch.reason != null) fields.push(["reason", branch.reason]);
	return fields;
}

/**
 * One canonical YAML line for an action, without the list indent: `tap: Home`.
 * A Branch comes out as one flow map (`if: { text: A, then: [{ tap: A }] }`), for logs and summaries.
 */
export function formatCaseScriptFileAction(action: CaseScriptAction): string {
	if (action.type === "branch") {
		const sides = (["then", "else"] as const).flatMap((side) => {
			const actions = action[side];
			if (!actions?.length) return [];
			return `${side}: [${actions.map((inner) => `{ ${formatCaseScriptFileAction(inner)} }`).join(", ")}]`;
		});
		const body = [
			...branchFields(action).map(([key, value]) => `${key}: ${yamlScalar(value)}`),
			...sides,
		].join(", ");
		return `${BRANCH_KEY}: { ${body} }`;
	}
	const fields = orderedFields(action);
	const shortField = SHORT_FORM_FIELD[action.type];

	if (action.type === "alert" && fields.length === 0) {
		return `alert: ${action.alertAction}`;
	}
	const only = fields[0];
	if (fields.length === 1 && only && only[0] === shortField) {
		return `${action.type}: ${yamlScalar(only[1])}`;
	}
	if (fields.length === 0) {
		return `${action.type}: {}`;
	}
	const body = fields.map(([key, value]) => `${key}: ${yamlScalar(value)}`).join(", ");
	return `${action.type}: { ${body} }`;
}

/**
 * The list item lines for an action at `indent`: one line for an Action, and for a Branch
 * its fields and `then:` / `else:` block lists, one action per line.
 */
function formatCaseScriptFileItemLines(action: CaseScriptAction, indent: string): string[] {
	if (action.type !== "branch") return [`${indent}- ${formatCaseScriptFileAction(action)}`];
	const fieldIndent = `${indent}    `;
	const lines = [`${indent}- ${BRANCH_KEY}:`];
	for (const [key, value] of branchFields(action)) {
		lines.push(`${fieldIndent}${key}: ${yamlScalar(value)}`);
	}
	for (const side of ["then", "else"] as const) {
		const actions = action[side];
		if (!actions?.length) continue;
		lines.push(`${fieldIndent}${side}:`);
		for (const inner of actions) {
			lines.push(...formatCaseScriptFileItemLines(inner, `${fieldIndent}  `));
		}
	}
	return lines;
}

/** The list item line for an action, as it appears under `actions:` (several lines for a Branch). */
export function formatCaseScriptFileActionLine(action: CaseScriptAction): string {
	return formatCaseScriptFileItemLines(action, "  ").join("\n");
}

/** Canonical Case Script file: one action per line, stable key order, short forms where possible. */
export function formatCaseScriptFile(
	script: CaseScript,
	options: FormatCaseScriptFileOptions = {},
): string {
	const lines = ["version: 1"];
	const name = options.name?.trim();
	if (name) lines.push(`name: ${yamlScalar(name)}`);
	if (script.sourceRunId) lines.push(`sourceRunId: ${yamlScalar(script.sourceRunId)}`);
	lines.push("actions:");
	for (const action of script.actions) {
		lines.push(...formatCaseScriptFileItemLines(action, "  "));
	}
	return `${lines.join("\n")}\n`;
}

/** An empty Case Script file, ready for actions to be appended under `actions:`. */
export function emptyCaseScriptFile(name?: string | null): string {
	const lines = ["version: 1"];
	const trimmed = name?.trim();
	if (trimmed) lines.push(`name: ${yamlScalar(trimmed)}`);
	lines.push("actions:");
	return `${lines.join("\n")}\n`;
}

/** True for text written as a `yoqa` shell script rather than a Case Script file. */
export function looksLikeShellScript(text: string): boolean {
	const lines = text.split(/\r?\n/).map((line) => line.trim());
	const first = lines.find((line) => line.length > 0);
	if (first?.startsWith("#!")) return true;
	return lines.some((line) => /^(yoqa\s+(action|assert|screenshot)\b|sleep\s+\d)/.test(line));
}

export type ShellToCaseScriptActionsResult = {
	actions: CaseScriptAction[];
	/** Shell comments (`# Tap "Home"`), by the index of the action they precede. */
	comments: Array<{ beforeAction: number; text: string }>;
	warnings: string[];
};

/**
 * Convert legacy `yoqa` shell lines into Case Script actions, keeping comments.
 * Lines that cannot become a Case Script action are reported in `warnings`.
 */
export function shellToCaseScriptActions(
	text: string,
	options: { elements?: ScreenElement[] } = {},
): ShellToCaseScriptActionsResult {
	const actions: CaseScriptAction[] = [];
	const comments: ShellToCaseScriptActionsResult["comments"] = [];
	const warnings: string[] = [];
	const lines = text.split(/\r?\n/);
	lines.forEach((raw, i) => {
		const line = raw.trim();
		if (line.length === 0 || line.startsWith("#!") || line === "set -euo pipefail") return;
		if (line.startsWith("#")) {
			const comment = line.replace(/^#+\s*/, "");
			if (
				comment &&
				!/^(Yoqa |Requires an active device session|Prefer JSON|Prefer the Case Script file)/.test(
					comment,
				)
			) {
				comments.push({ beforeAction: actions.length, text: comment });
			}
			return;
		}
		const converted = shellToCaseScript(line, { elements: options.elements });
		for (const error of converted.errors) {
			warnings.push(`L${i + 1}: ${error.message} — skipped`);
		}
		for (const warning of converted.warnings) {
			warnings.push(warning.replace(/^L1:/, `L${i + 1}:`));
		}
		if (converted.script) actions.push(...converted.script.actions);
	});
	return { actions, comments, warnings };
}

/** YAML list lines (comments included) for converted shell, ready to append under `actions:`. */
export function caseScriptFileLinesFromShell(
	text: string,
	options: { elements?: ScreenElement[] } = {},
): { lines: string[]; actionCount: number; warnings: string[] } {
	const converted = shellToCaseScriptActions(text, options);
	const lines: string[] = [];
	converted.actions.forEach((action, index) => {
		for (const comment of converted.comments) {
			if (comment.beforeAction === index) lines.push(`  # ${comment.text}`);
		}
		lines.push(formatCaseScriptFileActionLine(action));
	});
	return { lines, actionCount: converted.actions.length, warnings: converted.warnings };
}

/** A whole legacy shell script as a Case Script file. */
export function shellToCaseScriptFile(
	text: string,
	options: { elements?: ScreenElement[]; name?: string | null } = {},
): { text: string | null; warnings: string[] } {
	const { lines, actionCount, warnings } = caseScriptFileLinesFromShell(text, options);
	if (actionCount === 0) return { text: null, warnings };
	return { text: `${emptyCaseScriptFile(options.name)}${lines.join("\n")}\n`, warnings };
}

/**
 * Read any supported file text into Case Script file YAML: YAML is kept as written,
 * a legacy JSON export is rewritten as canonical YAML, and shell is converted.
 */
export function toCaseScriptFileText(
	text: string,
	options: { elements?: ScreenElement[]; name?: string | null } = {},
): { text: string | null; warnings: string[]; errors: CaseScriptFileError[] } {
	if (looksLikeShellScript(text)) {
		const converted = shellToCaseScriptFile(text, options);
		return {
			text: converted.text,
			warnings: converted.warnings,
			errors: converted.text
				? []
				: [
						{
							line: null,
							action: null,
							message: "No shell lines could become Case Script actions",
						},
					],
		};
	}
	const parsed = parseCaseScriptFile(text);
	if (!parsed.ok) return { text: null, warnings: [], errors: parsed.errors };
	if (text.trimStart().startsWith("{")) {
		return {
			text: formatCaseScriptFile(parsed.script, { name: parsed.name ?? options.name }),
			warnings: [],
			errors: [],
		};
	}
	return { text, warnings: [], errors: [] };
}
