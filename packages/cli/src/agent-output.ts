/**
 * **Agent output**: everything `yoqa` writes to stdout for a calling agent.
 *
 * One seam, so no command can emit unbounded text by accident. `formatAgentOutput` is pure —
 * it takes what the runner answered plus the output options the caller passed, and returns the
 * exact text to write together with its **Emitted usage**. `emitAgentOutput` is the only thing
 * that writes it, and the only thing that records what it cost.
 *
 * The trimming lives here and deliberately not in the runner's shared Screen read: Case Script
 * Branches match against that same read, so capping it there would silently change which side a
 * saved script takes.
 */

import {
	MAX_SCREEN_ROWS,
	type ScreenElement,
	type ScreenResponse,
	type ScreenSource,
	screenRowsOmittedLine,
} from "@yoqa/runner-client";
import {
	type EmittedImage,
	budgetWarning,
	estimateImageTokens,
	estimateTextTokens,
	outputWarningSuppressed,
	resolveOutputBudget,
	resolveWarnAtPercent,
} from "./emitted-usage";
import { type LedgerOptions, appendEmittedUsage } from "./emitted-usage-ledger";
import { envWholeNumber } from "./env";

/** How the caller asked for this command's output to be shaped. */
export type AgentOutputOptions = {
	/** Emit JSON instead of the formatted listing. */
	json?: boolean;
	/** Indent the JSON for a human reading it. Compact otherwise, because agents pay for it. */
	pretty?: boolean;
	/** Rows of cleaned Screen tree to emit, in place of the shared cap. */
	limit?: number;
};

/** What one command emitted, what the cap kept out of it, and what it cost. */
export type AgentOutput = {
	/** The exact text to write. Every shape but `document` leaves the line's terminator to the seam. */
	text: string;
	/** Cleaned-tree elements the cap left out; 0 when nothing was trimmed. */
	omitted: number;
	/** Estimated **Emitted usage** for this output: the text, plus any Agent image it names. */
	tokens: number;
};

/**
 * A command's result, before it is shaped into Agent output.
 *
 * `screen` is its own kind because the row cap and the tree's row format live in this seam. Every
 * other command hands over a plain `json` body: there is one way to turn a result into JSON, and
 * a command that knows how to indent its own output is a command that can get it wrong.
 *
 * `text` is what a command prints for a person: lines it has already decided on, which the seam
 * writes and accounts for but never re-shapes. `document` is a file's contents — an exported Case
 * Script — written byte for byte, because a file carries its own terminator or deliberately
 * carries none, and that is not a line for the seam to finish.
 */
type AgentOutputBody =
	| { kind: "screen"; screen: ScreenResponse }
	| { kind: "json"; body: unknown }
	| { kind: "text"; lines: string[] }
	| { kind: "document"; text: string };

/**
 * Any payload may name an Agent image: the calling agent pays for it the moment it reads the
 * file, so the seam counts it where it names it. A tree read names none; `action --screenshot`
 * is the first command that will.
 */
export type AgentOutputPayload = AgentOutputBody & { image?: EmittedImage };

/** The line a cleaned-tree listing leads with, so a SpringBoard tree is not taken for the app's. */
function screenSourceLine(source: ScreenSource): string {
	if (source.kind === "system") return "Read from the system (SpringBoard), not an app";
	const app = source.bundleId ?? "an unnamed app";
	return `Read from ${app} (${source.kind === "target" ? "target app" : "foreground app"})`;
}

/** One cleaned-tree row, in the shape `yoqa screen` has always printed. */
function screenRow(element: ScreenElement): string {
	return `${String(element.x).padStart(4)},${String(element.y).padStart(4)}  ${element.width}x${element.height}  ${element.label}`;
}

/**
 * Compact unless a human asked to read it, because indentation is tokens with no content.
 * Exported so every command that offers JSON goes through one path rather than repeating the
 * `JSON.stringify(body, null, 2)` pattern per command.
 */
export function agentJson(body: unknown, options: Pick<AgentOutputOptions, "pretty">): string {
	return options.pretty ? JSON.stringify(body, null, 2) : JSON.stringify(body);
}

/** One output's Emitted usage: what was written, plus any Agent image it pointed the agent at. */
function withEmittedUsage(text: string, omitted: number, payload: AgentOutputPayload): AgentOutput {
	return { text, omitted, tokens: estimateTextTokens(text) + estimateImageTokens(payload.image) };
}

export function formatAgentOutput(
	payload: AgentOutputPayload,
	options: AgentOutputOptions = {},
): AgentOutput {
	// A result is not a tree: there is nothing to trim and no row format to keep, only the one
	// JSON path. `--limit` is meaningless here and is ignored rather than rejected.
	if (payload.kind === "json") {
		return withEmittedUsage(agentJson(payload.body, options), 0, payload);
	}

	// Lines a command already chose, and a document's own bytes: nothing to shape, so none of the
	// shaping options apply. Re-wrapping either underneath the command would change what a person
	// reading it was promised.
	if (payload.kind === "text") return withEmittedUsage(payload.lines.join("\n"), 0, payload);
	if (payload.kind === "document") return withEmittedUsage(payload.text, 0, payload);

	const screen = payload.screen;

	// The raw tree is the escape hatch for a hard problem: never trimmed, only ever compacted.
	if (screen.full) return withEmittedUsage(agentJson(screen, options), 0, payload);

	const elements = screen.elements ?? [];
	const cap = options.limit ?? MAX_SCREEN_ROWS;
	const shown = elements.slice(0, cap);
	const omitted = elements.length - shown.length;

	if (options.json) {
		// The marker keeps a trimmed payload honest: a caller hunting an `--id` can see it is short.
		const body = {
			...screen,
			elements: shown,
			...(omitted > 0 ? { omittedElements: omitted } : {}),
		};
		return withEmittedUsage(agentJson(body, options), omitted, payload);
	}

	const lines = screen.source ? [screenSourceLine(screen.source)] : [];
	lines.push(...shown.map(screenRow));
	if (omitted > 0) lines.push(screenRowsOmittedLine(omitted));
	return withEmittedUsage(lines.join("\n"), omitted, payload);
}

/**
 * The default row cap in force, from `YOQA_SCREEN_ROWS`. An unusable value leaves the shared cap
 * alone, and `--limit` outranks both.
 *
 * It moves this seam's cap and deliberately not the Decide loop's screen snapshot, though both
 * read `MAX_SCREEN_ROWS` for their default. The snapshot is model input, so shrinking it changes
 * which decisions a run makes rather than what a context window costs — and because the CLI
 * autostarts the runner, which inherits its environment, one knob for both would make that happen
 * silently.
 */
export function resolveScreenRows(env: Record<string, string | undefined> = process.env): number {
	return envWholeNumber(env.YOQA_SCREEN_ROWS, MAX_SCREEN_ROWS);
}

/**
 * `--limit` as the command should read it. Checked before the device is touched, so a nonsense
 * value fails the command rather than quietly reading the whole tree — and it throws where the
 * command's own `fail` handler reports it, not out of commander's option parser.
 */
export function parseScreenLimit(value: string | undefined): number | undefined {
	if (value == null) return undefined;
	const rows = Number(value);
	if (!Number.isInteger(rows) || rows < 1) {
		throw new Error("--limit must be a whole number of rows, 1 or more");
	}
	return rows;
}

/** What the seam needs to know beyond the payload, to account for what it writes. */
export type AgentOutputContext = {
	/** The command as a caller typed it, e.g. `screen` — this is what the ledger records. */
	command: string;
	/** The Device Session this emission belongs to. Best-effort: null, or a throw, is fine. */
	session: () => Promise<string | null>;
	/** Injected in tests, so no test writes to the real `~/.yoqa` ledger. */
	ledger?: LedgerOptions;
};

/**
 * The one place a command's Agent output reaches stdout.
 *
 * Output is written first and accounted second, so the calling agent has its answer before any
 * ledger work happens — and a ledger that cannot be read or written changes nothing about the
 * command's output or its exit code.
 */
export async function emitAgentOutput(
	payload: AgentOutputPayload,
	options: AgentOutputOptions,
	context: AgentOutputContext,
): Promise<AgentOutput> {
	// The environment's row cap is applied here, not at each command, so every command that
	// reaches this seam honours it without having to remember to.
	const output = formatAgentOutput(payload, {
		...options,
		limit: options.limit ?? resolveScreenRows(),
	});
	write(output, payload);
	if (output.tokens > 0) await record(output, context);
	return output;
}

/**
 * Putting it on stdout: a listing is a line, a document is bytes.
 *
 * `console.log` for every shape that is a listing, because terminating the line is what the
 * commands reaching this seam have always done. A `document` is written exactly as it came: it is
 * a file's contents, and the newline it ends with — or pointedly lacks — is part of the file.
 *
 * A `text` listing is one emission but still one write per line, the way its command always
 * wrote it — so it is the same on stdout down to the call, and one empty line is still a line.
 */
function write(output: AgentOutput, payload: AgentOutputPayload): void {
	if (payload.kind === "text") {
		for (const line of payload.lines) console.log(line);
		return;
	}
	if (!output.text) return;
	if (payload.kind === "document") process.stdout.write(output.text);
	else console.log(output.text);
}

/** Best-effort accounting: resolving the session is as optional as writing the line. */
async function record(output: AgentOutput, context: AgentOutputContext): Promise<void> {
	try {
		const session = await context.session();
		if (!session) return;
		const total = await appendEmittedUsage(
			{ session, command: context.command, tokens: output.tokens },
			context.ledger ?? {},
		);
		if (total != null) warnOnCrossing(total - output.tokens, total);
	} catch {
		// Accounting never fails the command it is accounting for.
	}
}

/**
 * The Output budget's one warning, on stderr.
 *
 * stderr so it can never corrupt output an agent is parsing, and here — after the write and after
 * the append — so stdout is byte-identical whether or not it fires and nothing is delayed ahead
 * of the answer the agent is waiting for. It warns and never blocks: no command is refused,
 * delayed or truncated on account of a running total.
 */
function warnOnCrossing(before: number, after: number): void {
	if (outputWarningSuppressed()) return;
	const warning = budgetWarning({
		before,
		after,
		budget: resolveOutputBudget(),
		warnAtPercent: resolveWarnAtPercent(),
	});
	if (warning) console.error(warning);
}
