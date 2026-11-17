/**
 * The Agent output seam stays the CLI's only route to stdout.
 *
 * Read from source, the way the desktop's `no-react-state` test reads it, rather than by spying on
 * writes while commands run: the regression this guards against is a new command that no test
 * drives yet. Whole files are scanned, not lines, so an import or a `stdio` array split across
 * lines is still seen; each finding is reported at the line it starts on.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The one file allowed to write to stdout: every other write goes through it. */
const SEAM = "agent-output.ts";

/**
 * Every way found to put bytes on stdout, named so a failure says which one it was. Reading a
 * property of the stream (`process.stdout.isTTY`) is not a write; taking hold of the stream
 * itself is, because whatever holds it can write to it.
 */
const STDOUT_WRITES: Record<string, RegExp> = {
	"a console method that prints to stdout":
		/\bconsole\s*\.\s*(log|info|debug|dir|dirxml|table|group|groupCollapsed|count|timeLog)\b/g,
	"process.stdout, other than reading its size or TTY-ness":
		/\bprocess\s*(\.\s*stdout|\[\s*["']stdout["']\s*\])(?!\s*\.\s*(isTTY|columns|rows)\b)/g,
	"stdout taken out of process":
		/\{[^}]*\bstdout\b[^}]*\}\s*(=\s*process\b|from\s*["'](node:)?process["'])/g,
	"Bun's stdout": /\bBun\s*\.\s*stdout\b/g,
	"file descriptor 1": /\bwriteSync\s*\(\s*1\s*,|["']\/dev\/stdout["']/g,
	"a child process that inherits stdout":
		/\bstdio\s*:\s*(\[[^\]]*)?["']inherit["']|\bstdout\s*:\s*["']inherit["']/g,
};

/** A doc comment naming `console.log` is not a write. */
const COMMENT = /^\s*(\/\/|\/\*|\*)/;

/** One place a file reaches stdout: where it is, the code there, and which route it took. */
type StdoutWrite = { file: string; line: number; code: string; route: string };

type Exemption = { file: string; code: string; why: string };

/**
 * Routes to stdout that are deliberately not Agent output. Each covers exactly one write, so a
 * second identical line in the same file is still caught.
 */
const EXEMPT: Exemption[] = [
	{
		file: "ensure-runner.ts",
		code: 'stdio: "inherit",',
		why: "foreground `yoqa serve` is a long-lived server; its stdout is the runner's log for a person at a terminal",
	},
];

function scannedFiles(): string[] {
	return [...new Bun.Glob("**/*.ts").scanSync(import.meta.dir)].filter(
		(file) => !file.endsWith(".test.ts"),
	);
}

function writesIn(file: string): StdoutWrite[] {
	const source = readFileSync(join(import.meta.dir, file), "utf8");
	const lines = source.split("\n");
	const found = new Map<number, StdoutWrite>();
	for (const [route, pattern] of Object.entries(STDOUT_WRITES)) {
		for (const match of source.matchAll(pattern)) {
			const line = source.slice(0, match.index).split("\n").length;
			const code = lines[line - 1] ?? "";
			if (COMMENT.test(code) || found.has(line)) continue;
			found.set(line, { file, line, code: code.trim(), route });
		}
	}
	return [...found.values()].sort((a, b) => a.line - b.line);
}

/** Every stdout write outside the seam, exempt or not. */
function stdoutWrites(): StdoutWrite[] {
	return scannedFiles()
		.filter((file) => file !== SEAM)
		.flatMap(writesIn);
}

function covers(exemption: Exemption, write: StdoutWrite): boolean {
	return exemption.file === write.file && exemption.code === write.code;
}

/** Writes no exemption covers, and exemptions that covered nothing. Each exemption covers one. */
function audit(): { bypasses: StdoutWrite[]; stale: Exemption[] } {
	const unused = [...EXEMPT];
	const bypasses = stdoutWrites().filter((write) => {
		const index = unused.findIndex((exemption) => covers(exemption, write));
		if (index === -1) return true;
		unused.splice(index, 1);
		return false;
	});
	return { bypasses, stale: unused };
}

describe("Agent output", () => {
	test("commands write to stdout only through the output seam", () => {
		const bypasses = audit().bypasses.map(
			(write) =>
				`${write.file}:${write.line}  ${write.code}  — ${write.route}; write through emitText, emitJson or emitDocument in command-output.ts`,
		);
		expect(bypasses).toEqual([]);
	});

	test("every exemption still names a real write", () => {
		const stale = audit().stale.map((exemption) => `${exemption.file}  ${exemption.code}`);
		expect(stale).toEqual([]);
	});

	test("the guard is scanning the commands, not an empty directory", () => {
		expect(scannedFiles()).toContain("program.ts");
		expect(scannedFiles()).toContain(SEAM);
	});
});
