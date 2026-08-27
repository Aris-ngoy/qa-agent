/**
 * Guards the shipped agent skill (`packages/skill/yoqa-testing`) against CLI drift.
 *
 * Every `yoqa …` line in the skill's bash blocks is parsed and checked against the real
 * commander tree: the command must exist and every flag must be one it accepts. The skill
 * is the contract an agent follows verbatim, so a stale command there is a broken agent run.
 */

import { describe, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import { buildProgram } from "./program";

const SKILL_DIR = join(import.meta.dir, "../../skill/yoqa-testing");

/** Non-yoqa tooling the skill documents for builds/installs — not our contract to check. */
const FOREIGN_COMMANDS = new Set([
	"xcrun",
	"xcodebuild",
	"codesign",
	"security",
	"adb",
	"npx",
	"bun",
	"cat",
	"unzip",
	"find",
	"plutil",
	"EOF",
]);

async function markdownFiles(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await markdownFiles(full)));
		} else if (entry.name.endsWith(".md")) {
			files.push(full);
		}
	}
	return files.sort();
}

/** Lines inside ```bash / ```sh fences, with `\` continuations joined. */
function bashLines(markdown: string): string[] {
	const lines: string[] = [];
	let inBash = false;
	let pending = "";
	for (const raw of markdown.split("\n")) {
		const fence = raw.trimStart().startsWith("```");
		if (fence) {
			const lang = raw.trim().slice(3).trim().toLowerCase();
			inBash = !inBash && (lang === "bash" || lang === "sh");
			pending = "";
			continue;
		}
		if (!inBash) continue;
		const line = raw.trim();
		if (line.endsWith("\\")) {
			pending += `${line.slice(0, -1).trim()} `;
			continue;
		}
		lines.push((pending + line).trim());
		pending = "";
	}
	return lines.filter((line) => line.length > 0);
}

/** Split on whitespace, keeping quoted spans intact. */
function tokenize(line: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: '"' | "'" | null = null;
	for (const char of line) {
		if (quote) {
			if (char === quote) quote = null;
			else current += char;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (/\s/.test(char)) {
			if (current) tokens.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	if (current) tokens.push(current);
	return tokens;
}

/** Docs write optional flags as `[--flag <value>]`; the brackets are notation, not arguments. */
function stripSynopsisBrackets(token: string): string {
	return token.replace(/^\[+/, "").replace(/\]+$/, "");
}

function stripComment(line: string): string {
	// A `#` outside quotes starts a trailing comment.
	let quote: '"' | "'" | null = null;
	for (let i = 0; i < line.length; i += 1) {
		const char = line[i];
		if (quote) {
			if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'") quote = char;
		else if (char === "#") return line.slice(0, i);
	}
	return line;
}

function subcommandNames(cmd: Command): string[] {
	return cmd.commands.flatMap((sub) => [sub.name(), ...sub.aliases()]);
}

function findSubcommand(cmd: Command, name: string): Command | undefined {
	return cmd.commands.find((sub) => sub.name() === name || sub.aliases().includes(name));
}

/** Every flag spelling the command accepts, exactly as commander would match it. */
function acceptedFlags(cmd: Command): Set<string> {
	const flags = new Set<string>(["-h", "--help"]);
	for (const option of cmd.options) {
		if (option.short) flags.add(option.short);
		if (option.long) flags.add(option.long);
	}
	return flags;
}

type DocCommand = { file: string; line: string; tokens: string[] };

async function collectDocCommands(): Promise<DocCommand[]> {
	const files = await markdownFiles(SKILL_DIR);
	const found: DocCommand[] = [];
	for (const file of files) {
		const markdown = await readFile(file, "utf8");
		for (const raw of bashLines(markdown)) {
			// Only the yoqa contract; drop pipelines and trailing comments.
			const line = stripComment(raw).split("|")[0]?.trim() ?? "";
			if (!line.startsWith("yoqa ") && line !== "yoqa") continue;
			const tokens = tokenize(line);
			if (FOREIGN_COMMANDS.has(tokens[0] ?? "")) continue;
			found.push({
				file: file.slice(SKILL_DIR.length + 1),
				line,
				tokens: tokens
					.slice(1)
					.map(stripSynopsisBrackets)
					.filter((token) => token.length > 0),
			});
		}
	}
	return found;
}

describe("skill docs match the CLI", () => {
	test("every documented yoqa command exists", async () => {
		const docCommands = await collectDocCommands();
		const failures: string[] = [];

		for (const doc of docCommands) {
			let cmd: Command = buildProgram();
			for (const token of doc.tokens) {
				if (token.startsWith("-")) break;
				// While the current command is a group, the next bare token must name a subcommand.
				if (cmd.commands.length === 0) break;
				const sub = findSubcommand(cmd, token);
				if (!sub) {
					failures.push(
						`${doc.file}: "${doc.line}" — unknown command "${token}"; ` +
							`${cmd.name()} accepts: ${subcommandNames(cmd).sort().join(", ")}`,
					);
					break;
				}
				cmd = sub;
			}
		}

		expect(failures).toEqual([]);
	});

	test("every documented flag exists on its command", async () => {
		const docCommands = await collectDocCommands();
		const failures: string[] = [];

		for (const doc of docCommands) {
			let cmd: Command = buildProgram();
			const rest: string[] = [];
			let walking = true;
			for (const token of doc.tokens) {
				if (walking && !token.startsWith("-") && cmd.commands.length > 0) {
					const sub = findSubcommand(cmd, token);
					if (!sub) break; // reported by the command test
					cmd = sub;
					continue;
				}
				walking = false;
				rest.push(token);
			}

			const flags = acceptedFlags(cmd);
			for (const token of rest) {
				if (!token.startsWith("-") || token === "-") continue;
				const flag = token.split("=")[0] ?? token;
				if (!flags.has(flag)) {
					failures.push(
						`${doc.file}: "${doc.line}" — "${flag}" is not an option of "${cmd.name()}"; ` +
							`accepts: ${[...flags].sort().join(", ")}`,
					);
				}
			}
		}

		expect(failures).toEqual([]);
	});

	test("every documented command passes the right number of arguments", async () => {
		const docCommands = await collectDocCommands();
		const failures: string[] = [];

		for (const doc of docCommands) {
			let cmd: Command = buildProgram();
			const positionals: string[] = [];
			let walking = true;
			let skipNext = false;

			for (const token of doc.tokens) {
				if (walking && !token.startsWith("-") && cmd.commands.length > 0) {
					const sub = findSubcommand(cmd, token);
					if (!sub) break; // reported by the command test
					cmd = sub;
					continue;
				}
				walking = false;
				if (skipNext) {
					skipNext = false;
					continue;
				}
				if (token.startsWith("-")) {
					// `--flag value` consumes the next token; `--flag=value` and booleans do not.
					const flag = token.split("=")[0] ?? token;
					const option = cmd.options.find((o) => o.short === flag || o.long === flag);
					skipNext = !token.includes("=") && option?.required === true;
					continue;
				}
				positionals.push(token);
			}

			const args = cmd.registeredArguments;
			const required = args.filter((arg) => arg.required).length;
			const variadic = args.some((arg) => arg.variadic);
			const shape = args.length === 0 ? "(none)" : args.map((arg) => arg.name()).join(" ");

			if (positionals.length < required) {
				failures.push(
					`${doc.file}: "${doc.line}" — "${cmd.name()}" needs ${required} argument(s) ` +
						`[${shape}], got ${positionals.length}`,
				);
			} else if (!variadic && positionals.length > args.length) {
				failures.push(
					`${doc.file}: "${doc.line}" — "${cmd.name()}" takes at most ${args.length} argument(s) ` +
						`[${shape}], got ${positionals.length} (${positionals.join(" ")})`,
				);
			}
		}

		expect(failures).toEqual([]);
	});

	test("the parser actually found the documented commands", async () => {
		const docCommands = await collectDocCommands();
		// Guards against a parser regression silently making the checks above vacuous.
		expect(docCommands.length).toBeGreaterThan(60);
		expect(docCommands.some((doc) => doc.tokens.includes("--flows-file"))).toBe(true);
	});
});
