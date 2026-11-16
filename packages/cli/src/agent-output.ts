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
	MAX_SCREEN_SNAPSHOT_ROWS,
	type ScreenElement,
	type ScreenResponse,
	type ScreenSource,
	screenRowsOmittedLine,
} from "@yoqa/runner-client";

/** How the caller asked for this command's output to be shaped. */
export type AgentOutputOptions = {
	/** Emit JSON instead of the formatted listing. */
	json?: boolean;
	/** Indent the JSON for a human reading it. Compact otherwise, because agents pay for it. */
	pretty?: boolean;
	/** Rows of cleaned Screen tree to emit, in place of the shared cap. */
	limit?: number;
};

/** What one command emitted, and what the cap kept out of it. */
export type AgentOutput = {
	/** The exact text to write, with no trailing newline. */
	text: string;
	/** Cleaned-tree elements the cap left out; 0 when nothing was trimmed. */
	omitted: number;
};

/** A command's result, before it is shaped into Agent output. */
export type AgentOutputPayload = { kind: "screen"; screen: ScreenResponse };

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
function json(body: unknown, options: AgentOutputOptions): string {
	return options.pretty ? JSON.stringify(body, null, 2) : JSON.stringify(body);
}

export function formatAgentOutput(
	payload: AgentOutputPayload,
	options: AgentOutputOptions = {},
): AgentOutput {
	const screen = payload.screen;

	// The raw tree is the escape hatch for a hard problem: never trimmed, only ever compacted.
	if (screen.full) return { text: json(screen, options), omitted: 0 };

	const elements = screen.elements ?? [];
	const cap = options.limit ?? MAX_SCREEN_SNAPSHOT_ROWS;
	const shown = elements.slice(0, cap);
	const omitted = elements.length - shown.length;

	if (options.json) {
		// The marker keeps a trimmed payload honest: a caller hunting an `--id` can see it is short.
		const body = {
			...screen,
			elements: shown,
			...(omitted > 0 ? { omittedElements: omitted } : {}),
		};
		return { text: json(body, options), omitted };
	}

	const lines = screen.source ? [screenSourceLine(screen.source)] : [];
	lines.push(...shown.map(screenRow));
	if (omitted > 0) lines.push(screenRowsOmittedLine(omitted));
	return { text: lines.join("\n"), omitted };
}

/**
 * `--limit` as commander should read it. Rejecting a nonsense value here fails the command
 * before it touches the device, rather than quietly reading the whole tree.
 */
export function parseScreenLimit(value: string): number {
	const rows = Number(value);
	if (!Number.isInteger(rows) || rows < 1) {
		throw new Error("--limit must be a whole number of rows, 1 or more");
	}
	return rows;
}

/** The one place a command's Agent output reaches stdout. */
export function writeAgentOutput(
	payload: AgentOutputPayload,
	options: AgentOutputOptions = {},
): AgentOutput {
	const output = formatAgentOutput(payload, options);
	if (output.text) console.log(output.text);
	return output;
}
