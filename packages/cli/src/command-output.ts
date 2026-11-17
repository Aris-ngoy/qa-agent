/**
 * The bridge from a commander command to the Agent output seam.
 *
 * Its own module so `program.ts` gains one call per command rather than one copy of the emit
 * plumbing per command, and so the seam never has to know what commander is.
 */

import type { Command } from "commander";
import { sessionIdOnce } from "./active-session";
import { type AgentOutputContext, emitAgentOutput } from "./agent-output";

/**
 * The command as a caller typed it — `devices ios`, `action tap`, `status` — which is the name the
 * Emitted usage ledger records.
 *
 * Derived from commander rather than written out per command, because forty hand-typed names go
 * stale the first time one is renamed, and a ledger that attributes tokens to a command nobody can
 * run is worse than no breakdown. The walk stops before the root: its name is the program's, taken
 * from argv, so including it would put the invoked binary's name in the ledger — which is also why
 * there is no fallback for the root itself. The root has no action, so nothing emits from it.
 */
export function commandPath(cmd: Command): string {
	const names: string[] = [];
	for (let node = cmd; node.parent; node = node.parent) {
		names.unshift(node.name());
	}
	return names.join(" ");
}

/** The two options every command offering machine-readable output carries. */
export type JsonOptions = { json?: boolean; pretty?: boolean };

/**
 * The help text for `--pretty`, declared once for the forty commands that offer it.
 *
 * A command offering `--json` without `--pretty` is a command whose output a person cannot read,
 * which is the state all forty were in. The pairing is enforced by a test that walks the built
 * command tree rather than by a helper every new command would have to remember to call.
 */
export const PRETTY_JSON_HELP =
	"Indent the JSON (compact by default — indentation costs an agent tokens)";

/**
 * What every emit reads off the command's options: where the runner is. A command with no
 * `--base-url` has no runner to ask about a Device Session, so it emits and records nothing —
 * accounting is best-effort, and a command that never touches a device has nothing to account to.
 */
export type EmitOptions = { baseUrl?: string };

/**
 * What `emitJson` reads on top of that: whether a human asked for indentation. Deliberately not
 * `json` — the caller has already decided that by calling.
 */
export type EmitJsonOptions = EmitOptions & { pretty?: boolean };

/** Who the ledger credits this emission to, derived once for all three emit calls. */
function emitContext(options: EmitOptions, cmd: Command): AgentOutputContext {
	return {
		command: commandPath(cmd),
		session: () => (options.baseUrl ? sessionIdOnce(options.baseUrl) : Promise.resolve(null)),
	};
}

/**
 * Write one command's result as Agent output: compact JSON unless `--pretty`, accounted to the
 * active Device Session under the command's own name.
 *
 * The one call every `--json` path makes, so the shape of machine-readable output is decided in
 * one place rather than per command.
 */
export async function emitJson(
	body: unknown,
	options: EmitJsonOptions,
	cmd: Command,
): Promise<void> {
	await emitAgentOutput(
		{ kind: "json", body },
		{ json: true, pretty: options.pretty },
		emitContext(options, cmd),
	);
}

/**
 * Write what a command prints for a person: the lines it already decided on, accounted to the
 * active Device Session under the command's own name.
 *
 * One line or many — many because a command that prints a block prints it as one emission, which
 * is both what the ledger should charge for it and what keeps the block from being interleaved.
 * The lines arrive shaped: this neither wraps, trims nor re-formats them, so what a person reads
 * is byte for byte what the command wrote before the seam existed.
 */
export async function emitText(
	lines: string | string[],
	options: EmitOptions,
	cmd: Command,
): Promise<void> {
	await emitAgentOutput(
		{ kind: "text", lines: Array.isArray(lines) ? lines : [lines] },
		{},
		emitContext(options, cmd),
	);
}

/**
 * Write a file's contents to stdout — an exported Case Script — exactly as they came.
 *
 * Its own call rather than `emitText` because a document is not a listing: the newline it ends
 * with, or pointedly lacks, belongs to the file and not to the terminal.
 */
export async function emitDocument(
	text: string,
	options: EmitOptions,
	cmd: Command,
): Promise<void> {
	await emitAgentOutput({ kind: "document", text }, {}, emitContext(options, cmd));
}
