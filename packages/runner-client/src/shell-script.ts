import type {
	ActionKind,
	ActionRequest,
	ActionResponse,
	CaseScript,
	CaseScriptAction,
	ScreenElement,
	ScreenResponse,
	ScreenshotRequest,
	ScreenshotResponse,
} from "./schemas";
import { actionKindSchema } from "./schemas";

export type ShellScriptSleepStep = {
	kind: "sleep";
	seconds: number;
	lineNumber: number;
	raw: string;
};

export type ShellScriptActionStep = {
	kind: "action";
	action: ActionRequest;
	lineNumber: number;
	raw: string;
};

export type AssertVisibility = "visible" | "not-visible";

export type ShellScriptAssertStep = {
	kind: "assert";
	assertion: AssertVisibility;
	text: string;
	timeoutSeconds: number;
	lineNumber: number;
	raw: string;
};

export type ShellScriptScreenshotStep = {
	kind: "screenshot";
	path: string | null;
	lineNumber: number;
	raw: string;
};

export type ShellScriptStep =
	| ShellScriptSleepStep
	| ShellScriptActionStep
	| ShellScriptAssertStep
	| ShellScriptScreenshotStep;

export type ParseYoqaShellScriptResult = {
	steps: ShellScriptStep[];
	/** Lines that could not be parsed (1-based). */
	errors: Array<{ lineNumber: number; raw: string; message: string }>;
};

export type RunYoqaShellScriptOptions = {
	signal?: AbortSignal;
	onStep?: (event: {
		index: number;
		total: number;
		step: ShellScriptStep;
		status: "running" | "ok" | "error" | "skipped";
		error?: string;
	}) => void | Promise<void>;
	/** Delay after each successful action before continuing (ms). Default 0. */
	pauseAfterActionMs?: number;
};

type ScriptClient = {
	performAction: (request: ActionRequest) => Promise<ActionResponse>;
	getScreen: (options?: { full?: boolean; pauseMjpeg?: boolean }) => Promise<ScreenResponse>;
	takeScreenshot: (request?: ScreenshotRequest) => Promise<ScreenshotResponse>;
};

function shellSingleQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Tokenize a shell-ish command line (supports single/double quotes). */
export function tokenizeShellLine(line: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch == null) continue;
		if (quote === "'") {
			if (ch === "'") {
				quote = null;
			} else {
				current += ch;
			}
			continue;
		}
		if (quote === '"') {
			if (ch === "\\") {
				const next = line[i + 1];
				if (next != null) {
					current += next;
					i++;
				}
				continue;
			}
			if (ch === '"') {
				quote = null;
			} else {
				current += ch;
			}
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			continue;
		}
		if (/\s/.test(ch)) {
			if (current.length > 0) {
				tokens.push(current);
				current = "";
			}
			continue;
		}
		current += ch;
	}
	if (quote != null) {
		throw new Error("Unclosed quote");
	}
	if (current.length > 0) {
		tokens.push(current);
	}
	return tokens;
}

function parseFlagMap(tokens: string[]): Map<string, string | true> {
	const flags = new Map<string, string | true>();
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (token == null || !token.startsWith("-")) continue;
		const eq = token.indexOf("=");
		if (eq > 0) {
			flags.set(token.slice(0, eq), token.slice(eq + 1));
			continue;
		}
		const next = tokens[i + 1];
		if (next != null && !next.startsWith("-")) {
			flags.set(token, next);
			i++;
		} else {
			flags.set(token, true);
		}
	}
	return flags;
}

function flagString(flags: Map<string, string | true>, ...names: string[]): string | undefined {
	for (const name of names) {
		const value = flags.get(name);
		if (typeof value === "string") return value;
	}
	return undefined;
}

function flagNumber(flags: Map<string, string | true>, ...names: string[]): number | undefined {
	const raw = flagString(flags, ...names);
	if (raw == null) return undefined;
	const n = Number(raw);
	return Number.isFinite(n) ? n : undefined;
}

function parseActionFromTokens(
	tokens: string[],
	lineNumber: number,
	raw: string,
): ShellScriptActionStep {
	// Expected: yoqa action <kind> [flags...]
	if (tokens[0] !== "yoqa" || tokens[1] !== "action") {
		throw new Error("Expected `yoqa action <kind> …`");
	}
	const kindRaw = tokens[2];
	if (!kindRaw) {
		throw new Error("Missing action kind");
	}
	const kindParsed = actionKindSchema.safeParse(kindRaw);
	if (!kindParsed.success) {
		throw new Error(`Unknown action kind: ${kindRaw}`);
	}
	const kind: ActionKind = kindParsed.data;
	const flags = parseFlagMap(tokens.slice(3));
	const action: ActionRequest = { kind };

	const description = flagString(flags, "-d", "--description");
	if (description != null) action.description = description;

	const label = flagString(flags, "--label");
	if (label != null) action.label = label;

	const id = flagString(flags, "--id");
	if (id != null) action.id = id;

	const x = flagNumber(flags, "--x");
	const y = flagNumber(flags, "--y");
	const x2 = flagNumber(flags, "--x2");
	const y2 = flagNumber(flags, "--y2");
	const durationMs = flagNumber(flags, "--duration");
	const text = flagString(flags, "--text");
	const appId = flagString(flags, "--app-id", "--bundle-id");
	const url = flagString(flags, "--url");
	const seconds = flagNumber(flags, "--seconds");

	if (x != null) action.x = x;
	if (y != null) action.y = y;
	if (x2 != null) action.x2 = x2;
	if (y2 != null) action.y2 = y2;
	if (durationMs != null) action.durationMs = durationMs;
	if (text != null) action.text = text;
	if (appId != null) action.appId = appId;
	if (url != null) action.url = url;
	if (seconds != null) action.seconds = seconds;
	if (flags.has("--double")) action.double = true;

	if (flags.has("--dismiss")) {
		action.alertAction = "dismiss";
	} else if (flags.has("--accept") || kind === "alert") {
		const alertAction = flagString(flags, "--action");
		if (alertAction === "dismiss") action.alertAction = "dismiss";
		else if (alertAction === "accept" || kind === "alert") action.alertAction = "accept";
	}

	return { kind: "action", action, lineNumber, raw };
}

function parseScreenshotFromTokens(
	tokens: string[],
	lineNumber: number,
	raw: string,
): ShellScriptScreenshotStep {
	// Expected: yoqa screenshot [path]
	if (tokens[0] !== "yoqa" || tokens[1] !== "screenshot") {
		throw new Error("Expected `yoqa screenshot [path]`");
	}
	const pathToken = tokens[2];
	if (pathToken?.startsWith("-")) {
		throw new Error("`yoqa screenshot` accepts an optional output path only");
	}
	if (tokens.length > 3) {
		throw new Error("`yoqa screenshot` accepts at most one path argument");
	}
	const path = pathToken?.trim() ? pathToken.trim() : null;
	return { kind: "screenshot", path, lineNumber, raw };
}

function parseAssertFromTokens(
	tokens: string[],
	lineNumber: number,
	raw: string,
): ShellScriptAssertStep {
	// Expected: yoqa assert visible|not-visible --text '…' [--timeout N]
	if (tokens[0] !== "yoqa" || tokens[1] !== "assert") {
		throw new Error("Expected `yoqa assert <visible|not-visible> …`");
	}
	const assertionRaw = tokens[2];
	if (assertionRaw !== "visible" && assertionRaw !== "not-visible") {
		throw new Error("Assert kind must be `visible` or `not-visible`");
	}
	const flags = parseFlagMap(tokens.slice(3));
	const text = flagString(flags, "--text", "-t");
	if (!text || text.trim().length === 0) {
		throw new Error("assert requires --text");
	}
	const timeout = flagNumber(flags, "--timeout") ?? 5;
	if (timeout < 0) {
		throw new Error("--timeout must be non-negative");
	}
	return {
		kind: "assert",
		assertion: assertionRaw,
		text: text.trim(),
		timeoutSeconds: timeout,
		lineNumber,
		raw,
	};
}

function isIgnorableLine(trimmed: string): boolean {
	if (trimmed.length === 0) return true;
	if (trimmed.startsWith("#")) return true;
	if (trimmed === "set -euo pipefail" || trimmed === "set -e" || trimmed === "set -eu") return true;
	return false;
}

export function parseYoqaShellScript(text: string): ParseYoqaShellScriptResult {
	const lines = text.split(/\r?\n/);
	const steps: ShellScriptStep[] = [];
	const errors: ParseYoqaShellScriptResult["errors"] = [];

	for (let i = 0; i < lines.length; i++) {
		const lineNumber = i + 1;
		const raw = lines[i] ?? "";
		const trimmed = raw.trim();
		if (isIgnorableLine(trimmed)) continue;

		try {
			const tokens = tokenizeShellLine(trimmed);
			if (tokens.length === 0) continue;

			if (tokens[0] === "sleep") {
				const seconds = Number(tokens[1]);
				if (!Number.isFinite(seconds) || seconds < 0) {
					throw new Error("`sleep` requires a non-negative number of seconds");
				}
				steps.push({ kind: "sleep", seconds, lineNumber, raw: trimmed });
				continue;
			}

			if (tokens[0] === "yoqa" && tokens[1] === "assert") {
				steps.push(parseAssertFromTokens(tokens, lineNumber, trimmed));
				continue;
			}

			if (tokens[0] === "yoqa" && tokens[1] === "screenshot") {
				steps.push(parseScreenshotFromTokens(tokens, lineNumber, trimmed));
				continue;
			}

			if (tokens[0] === "yoqa") {
				steps.push(parseActionFromTokens(tokens, lineNumber, trimmed));
				continue;
			}

			throw new Error(`Unsupported command: ${tokens[0]}`);
		} catch (error) {
			errors.push({
				lineNumber,
				raw: trimmed,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return { steps, errors };
}

export function formatActionShellLine(action: ActionRequest): string {
	const parts = ["yoqa", "action", action.kind];

	if (action.id) {
		parts.push("--id", shellSingleQuote(action.id));
	}
	if (action.label) {
		parts.push("--label", shellSingleQuote(action.label));
	}
	if (action.description) {
		parts.push("-d", shellSingleQuote(action.description));
	}
	if (action.x != null) parts.push("--x", String(Math.round(action.x)));
	if (action.y != null) parts.push("--y", String(Math.round(action.y)));
	if (action.x2 != null) parts.push("--x2", String(Math.round(action.x2)));
	if (action.y2 != null) parts.push("--y2", String(Math.round(action.y2)));
	if (action.durationMs != null) parts.push("--duration", String(Math.round(action.durationMs)));
	if (action.double) parts.push("--double");
	if (action.text != null) parts.push("--text", shellSingleQuote(action.text));
	if (action.appId != null) parts.push("--app-id", shellSingleQuote(action.appId));
	if (action.url != null) parts.push("--url", shellSingleQuote(action.url));
	if (action.seconds != null) parts.push("--seconds", String(action.seconds));
	if (action.kind === "alert") {
		if (action.alertAction === "dismiss") parts.push("--dismiss");
	}

	return parts.join(" ");
}

export function formatSleepShellLine(seconds: number): string {
	const safe = Math.max(0, seconds);
	const rounded = Number.isInteger(safe) ? String(safe) : String(Number(safe.toFixed(3)));
	return `sleep ${rounded}`;
}

export function formatScreenshotShellLine(path?: string | null): string {
	const trimmed = path?.trim();
	if (!trimmed) return "yoqa screenshot";
	return `yoqa screenshot ${shellSingleQuote(trimmed)}`;
}

export function formatAssertShellLine(input: {
	assertion: AssertVisibility;
	text: string;
	timeoutSeconds?: number;
}): string {
	const parts = ["yoqa", "assert", input.assertion, "--text", shellSingleQuote(input.text.trim())];
	const timeout = input.timeoutSeconds ?? 5;
	if (timeout !== 5) {
		parts.push("--timeout", String(timeout));
	}
	return parts.join(" ");
}

export const DEFAULT_SHELL_SCRIPT_HEADER = [
	"#!/usr/bin/env bash",
	"# YoQA inspector script",
	"# Requires an active device session: yoqa devices connect <id>",
	"set -euo pipefail",
	"",
].join("\n");

function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export function screenHasText(elements: ScreenElement[] | undefined, text: string): boolean {
	const needle = text.trim().toLowerCase();
	if (!needle) return false;
	return (elements ?? []).some((el) => {
		const label = el.label?.toLowerCase() ?? "";
		const type = el.type?.toLowerCase() ?? "";
		return label.includes(needle) || type.includes(needle);
	});
}

/** Prefer exact label match, then substring; pick the smallest matching box. */
export function findElementByLabel(
	elements: ScreenElement[] | undefined,
	label: string,
): ScreenElement | null {
	const needle = label.trim().toLowerCase();
	if (!needle) return null;
	const list = elements ?? [];
	const exact = list.filter((el) => (el.label?.trim().toLowerCase() ?? "") === needle);
	const pool =
		exact.length > 0
			? exact
			: list.filter((el) => (el.label?.toLowerCase() ?? "").includes(needle));
	if (pool.length === 0) return null;
	pool.sort((a, b) => a.width * a.height - b.width * b.height);
	return pool[0] ?? null;
}

/** Prefer exact id match, then suffix/substring; pick the smallest matching box. */
export function findElementById(
	elements: ScreenElement[] | undefined,
	id: string,
): ScreenElement | null {
	const needle = id.trim().toLowerCase();
	if (!needle) return null;
	const list = elements ?? [];
	const exact = list.filter((el) => (el.id?.trim().toLowerCase() ?? "") === needle);
	if (exact.length > 0) {
		exact.sort((a, b) => a.width * a.height - b.width * b.height);
		return exact[0] ?? null;
	}
	// Allow short id: "get_bonus" matching "com.app:id/get_bonus"
	const partial = list.filter((el) => {
		const value = el.id?.toLowerCase() ?? "";
		return value === needle || value.endsWith(`/${needle}`) || value.endsWith(`:id/${needle}`);
	});
	if (partial.length === 0) return null;
	partial.sort((a, b) => a.width * a.height - b.width * b.height);
	return partial[0] ?? null;
}

export function elementCenterNorm(element: ScreenElement): { x: number; y: number } {
	return {
		x: Math.round(element.x + element.width / 2),
		y: Math.round(element.y + element.height / 2),
	};
}

async function runAssertStep(
	client: ScriptClient,
	step: ShellScriptAssertStep,
	signal?: AbortSignal,
): Promise<void> {
	const deadline = Date.now() + step.timeoutSeconds * 1000;
	for (;;) {
		if (signal?.aborted) {
			throw Object.assign(new Error("Aborted"), { name: "AbortError" });
		}
		const screen = await client.getScreen();
		const found = screenHasText(screen.elements, step.text);
		if (step.assertion === "visible" && found) return;
		if (step.assertion === "not-visible" && !found) return;
		if (Date.now() >= deadline) {
			throw new Error(
				step.assertion === "visible"
					? `Expected visible text not found within ${step.timeoutSeconds}s: ${step.text}`
					: `Unexpected text still visible after ${step.timeoutSeconds}s: ${step.text}`,
			);
		}
		await sleepMs(400, signal);
	}
}

export async function runYoqaShellScript(
	client: ScriptClient,
	text: string,
	options: RunYoqaShellScriptOptions = {},
): Promise<{ ok: boolean; completed: number; total: number; error?: string }> {
	const parsed = parseYoqaShellScript(text);
	if (parsed.errors.length > 0) {
		const first = parsed.errors[0];
		if (!first) {
			return { ok: false, completed: 0, total: parsed.steps.length, error: "Parse error" };
		}
		return {
			ok: false,
			completed: 0,
			total: parsed.steps.length,
			error: `Line ${first.lineNumber}: ${first.message}`,
		};
	}

	const { steps } = parsed;
	const total = steps.length;
	if (total === 0) {
		return { ok: true, completed: 0, total: 0 };
	}

	for (let index = 0; index < steps.length; index++) {
		if (options.signal?.aborted) {
			return { ok: false, completed: index, total, error: "Aborted" };
		}
		const step = steps[index];
		if (!step) continue;
		await options.onStep?.({ index, total, step, status: "running" });
		try {
			if (step.kind === "sleep") {
				await sleepMs(step.seconds * 1000, options.signal);
			} else if (step.kind === "assert") {
				await runAssertStep(client, step, options.signal);
			} else if (step.kind === "screenshot") {
				await client.takeScreenshot(step.path ? { path: step.path } : {});
			} else {
				await client.performAction(step.action);
				if (options.pauseAfterActionMs) {
					await sleepMs(options.pauseAfterActionMs, options.signal);
				}
			}
			await options.onStep?.({ index, total, step, status: "ok" });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await options.onStep?.({ index, total, step, status: "error", error: message });
			return {
				ok: false,
				completed: index,
				total,
				error: `Line ${step.lineNumber}: ${message}`,
			};
		}
	}

	return { ok: true, completed: total, total };
}

export type ShellToCaseScriptOptions = {
	/** Live accessibility tree — resolves `--id` / `--label` taps to coordinates. */
	elements?: ScreenElement[];
	savedAt?: number;
};

export type ShellToCaseScriptResult = {
	script: CaseScript | null;
	/** Steps that could not be represented in CaseScript (assert, swipe, unresolved id, …). */
	warnings: string[];
	/** Parse errors from the shell script. */
	errors: Array<{ lineNumber: number; raw: string; message: string }>;
};

function clampNorm(n: number): number {
	return Math.min(1000, Math.max(0, Math.round(n)));
}

function clampWaitMs(seconds: number): number {
	return Math.min(10_000, Math.max(0, Math.round(seconds * 1000)));
}

function resolveTapPoint(
	action: ActionRequest,
	elements: ScreenElement[] | undefined,
): { x: number; y: number } | null {
	if (action.x != null && action.y != null) {
		return { x: clampNorm(action.x), y: clampNorm(action.y) };
	}
	if (action.id) {
		const match = findElementById(elements, action.id);
		if (match) return elementCenterNorm(match);
	}
	if (action.label) {
		const match = findElementByLabel(elements, action.label);
		if (match) return elementCenterNorm(match);
	}
	return null;
}

/**
 * Convert an inspector / yoqa shell script into a CaseScript for catalog replay.
 * Supports tap (x/y or resolvable id/label), input→type (+ focus tap when coords known), sleep→wait.
 * Skips assert, swipe, drag, double/long-press nuances, and unresolved selectors (reported as warnings).
 */
export function shellToCaseScript(
	text: string,
	options: ShellToCaseScriptOptions = {},
): ShellToCaseScriptResult {
	const parsed = parseYoqaShellScript(text);
	const warnings: string[] = [];
	const actions: CaseScriptAction[] = [];
	const elements = options.elements;

	for (const step of parsed.steps) {
		if (step.kind === "sleep") {
			const ms = clampWaitMs(step.seconds);
			if (ms <= 0) {
				warnings.push(`L${step.lineNumber}: skipped zero-length wait`);
				continue;
			}
			if (step.seconds * 1000 > 10_000) {
				warnings.push(`L${step.lineNumber}: wait clamped to 10s (CaseScript max)`);
			}
			actions.push({ type: "wait", ms });
			continue;
		}

		if (step.kind === "assert") {
			warnings.push(`L${step.lineNumber}: assert not supported in CaseScript — skipped`);
			continue;
		}

		if (step.kind === "screenshot") {
			warnings.push(`L${step.lineNumber}: screenshot not supported in CaseScript — skipped`);
			continue;
		}

		const { action } = step;
		if (action.kind === "tap") {
			if (action.double) {
				warnings.push(`L${step.lineNumber}: double-tap saved as a single tap`);
			}
			if (action.durationMs != null && action.durationMs > 50) {
				warnings.push(`L${step.lineNumber}: long-press saved as a normal tap`);
			}
			const point = resolveTapPoint(action, elements);
			if (!point) {
				warnings.push(
					`L${step.lineNumber}: tap needs --x/--y or a resolvable --id/--label — skipped`,
				);
				continue;
			}
			actions.push({ type: "tap", x: point.x, y: point.y });
			continue;
		}

		if (action.kind === "input") {
			const textValue = action.text?.trim() ?? "";
			if (!textValue) {
				warnings.push(`L${step.lineNumber}: input missing --text — skipped`);
				continue;
			}
			const point = resolveTapPoint(action, elements);
			if (point) {
				actions.push({ type: "tap", x: point.x, y: point.y });
			} else if (action.id || action.label) {
				warnings.push(`L${step.lineNumber}: input focus id/label unresolved — typing without tap`);
			}
			actions.push({ type: "type", text: textValue });
			continue;
		}

		warnings.push(`L${step.lineNumber}: \`${action.kind}\` not supported in CaseScript — skipped`);
	}

	if (actions.length === 0) {
		return {
			script: null,
			warnings,
			errors: parsed.errors,
		};
	}

	return {
		script: {
			version: 1,
			savedAt: options.savedAt ?? Date.now(),
			actions,
		},
		warnings,
		errors: parsed.errors,
	};
}
