/**
 * **Agent output**: everything `yoqa` writes to stdout for a calling agent.
 *
 * One seam, so no command can emit unbounded text by accident. `formatAgentOutput` is pure —
 * it takes what the runner answered plus the output options the caller passed, and returns the
 * exact text to write. `writeAgentOutput` is the only thing that writes it.
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
import { type EmittedImage, estimateImageTokens, estimateTextTokens } from "./emitted-usage";
import { type LedgerOptions, appendEmittedUsage } from "./emitted-usage-ledger";

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
	/** The exact text to write, with no trailing newline. */
	text: string;
	/** Cleaned-tree elements the cap left out; 0 when nothing was trimmed. */
	omitted: number;
	/** Estimated **Emitted usage** for this output: the text, plus any Agent image it names. */
	tokens: number;
};

/** A command's result, before it is shaped into Agent output. */
type AgentOutputBody = { kind: "screen"; screen: ScreenResponse };

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

/** Compact unless a human asked to read it, because indentation is tokens with no content. */
function asJson(body: unknown, options: AgentOutputOptions): string {
	return options.pretty ? JSON.stringify(body, null, 2) : JSON.stringify(body);
}

/** One output's Emitted usage: what was written, plus any Agent image it pointed the agent at. */
function priced(text: string, omitted: number, payload: AgentOutputPayload): AgentOutput {
	return { text, omitted, tokens: estimateTextTokens(text) + estimateImageTokens(payload.image) };
}

export function formatAgentOutput(
	payload: AgentOutputPayload,
	options: AgentOutputOptions = {},
): AgentOutput {
	const screen = payload.screen;

	// The raw tree is the escape hatch for a hard problem: never trimmed, only ever compacted.
	if (screen.full) return priced(asJson(screen, options), 0, payload);

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
		return priced(asJson(body, options), omitted, payload);
	}

	const lines = screen.source ? [screenSourceLine(screen.source)] : [];
	lines.push(...shown.map(screenRow));
	if (omitted > 0) lines.push(screenRowsOmittedLine(omitted));
	return priced(lines.join("\n"), omitted, payload);
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
	const output = formatAgentOutput(payload, options);
	if (output.text) console.log(output.text);
	if (output.tokens > 0) await record(output, context);
	return output;
}

/** Best-effort accounting: resolving the session is as optional as writing the line. */
async function record(output: AgentOutput, context: AgentOutputContext): Promise<void> {
	try {
		const session = await context.session();
		if (!session) return;
		await appendEmittedUsage(
			{ session, command: context.command, tokens: output.tokens },
			context.ledger ?? {},
		);
	} catch {
		// Accounting never fails the command it is accounting for.
	}
}
