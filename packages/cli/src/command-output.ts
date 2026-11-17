/**
 * The bridge from a commander command to the Agent output seam.
 *
 * Its own module so `program.ts` gains one call per command rather than one copy of the emit
 * plumbing per command, and so the seam never has to know what commander is.
 */

import type { Command } from "commander";
import { sessionIdOnce } from "./active-session";
import { type AgentOutputOptions, emitAgentOutput } from "./agent-output";

/**
 * The command as a caller typed it — `devices ios`, `action tap`, `status` — which is the name the
 * Emitted usage ledger records.
 *
 * Derived from commander rather than written out per command, because forty hand-typed names go
 * stale the first time one is renamed, and a ledger that attributes tokens to a command nobody can
 * run is worse than no breakdown. The walk stops before the root: its name is the program's, taken
 * from argv, so including it would put the invoked binary's name in the ledger.
 */
export function commandPath(cmd: Command): string {
	const names: string[] = [];
	for (let node: Command | undefined = cmd; node?.parent; node = node.parent ?? undefined) {
		names.unshift(node.name());
	}
	return names.join(" ") || cmd.name();
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

/** What `emitJson` needs from the command: where the runner is, and how to shape the output. */
export type EmitJsonOptions = JsonOptions & { baseUrl?: string };

/**
 * Write one command's result as Agent output: compact JSON unless `--pretty`, accounted to the
 * active Device Session under the command's own name.
 *
 * The one call every `--json` path makes, so the shape of machine-readable output is decided in
 * one place rather than per command. A command with no `--base-url` has no runner to ask about a
 * Device Session, so it emits and records nothing — accounting is best-effort, and a command that
 * never touches a device has nothing to account to.
 */
export async function emitJson(
	body: unknown,
	options: EmitJsonOptions,
	cmd: Command,
	output: Pick<AgentOutputOptions, "limit"> = {},
): Promise<void> {
	await emitAgentOutput(
		{ kind: "json", body },
		{ ...output, json: true, pretty: options.pretty },
		{
			command: commandPath(cmd),
			session: () => (options.baseUrl ? sessionIdOnce(options.baseUrl) : Promise.resolve(null)),
		},
	);
}
