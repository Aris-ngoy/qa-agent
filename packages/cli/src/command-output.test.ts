/**
 * How a commander command reaches the Agent output seam: the name the ledger records.
 *
 * Driven through real `Command` objects rather than stand-ins, because the thing under test is
 * exactly what commander hands an action handler.
 */

import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { commandPath } from "./command-output";

/** Runs `argv` against a small program and returns the path its action saw. */
async function pathFor(build: (program: Command) => void, ...argv: string[]): Promise<string> {
	let seen = "";
	const program = new Command();
	program.name("yoqa").exitOverride();
	build(program);
	for (const command of program.commands) {
		for (const node of [command, ...command.commands]) {
			node.action((...args: unknown[]) => {
				seen = commandPath(args.at(-1) as Command);
			});
		}
	}
	await program.parseAsync(["bun", "yoqa", ...argv]);
	return seen;
}

describe("the command name the ledger records", () => {
	test("is the bare name for a top-level command, not prefixed with the program", async () => {
		expect(await pathFor((program) => program.command("status"), "status")).toBe("status");
	});

	test("joins a subcommand to its parent, the way a caller typed it", async () => {
		const build = (program: Command) => program.command("devices").command("ios");

		expect(await pathFor(build, "devices", "ios")).toBe("devices ios");
	});

	test("survives a command that takes arguments, where the Command arrives last", async () => {
		const build = (program: Command) => program.command("apps").command("show").argument("<id>");

		expect(await pathFor(build, "apps", "show", "com.demo")).toBe("apps show");
	});
});
