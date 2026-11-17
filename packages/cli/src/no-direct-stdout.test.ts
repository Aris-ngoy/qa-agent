import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The one file allowed to write to stdout: every other write goes through it. */
const SEAM = "agent-output.ts";

/**
 * Anything that puts bytes on stdout. Reading a property of the stream (`process.stdout.isTTY`)
 * is not a write, so only the stream's writers count, along with handing the stream itself to
 * something that will write to it — a pipe, or a child process that inherits it.
 */
const STDOUT_WRITE =
	/\bconsole\.(log|info|debug|dir|dirxml|table|group|groupCollapsed|count|timeLog)\s*\(|\bprocess\.stdout\b(?!\.(isTTY|columns|rows|fd)\b)|\bBun\.stdout\b|\bwriteSync\(\s*1\s*,|\bstdio:.*["']inherit["']/;

/** A doc comment naming `console.log` is not a write. */
const COMMENT = /^\s*(\/\/|\/\*|\*)/;

/**
 * Routes to stdout that are deliberately not Agent output. Each names its line exactly, so a
 * second write in the same file is still caught.
 */
const EXEMPT = [
	{
		file: "ensure-runner.ts",
		line: 'stdio: "inherit",',
		why: "foreground `yoqa serve` is a long-lived server; its stdout is the runner's log for a person at a terminal",
	},
];

function scannedFiles(): string[] {
	return [...new Bun.Glob("**/*.ts").scanSync(import.meta.dir)].filter(
		(file) => !file.endsWith(".test.ts"),
	);
}

/** Every stdout write outside the seam, as `file:line  code`, exempt or not. */
function stdoutWrites(): { file: string; site: string; code: string }[] {
	const found: { file: string; site: string; code: string }[] = [];
	for (const file of scannedFiles()) {
		if (file === SEAM) continue;
		const lines = readFileSync(join(import.meta.dir, file), "utf8").split("\n");
		lines.forEach((line, index) => {
			if (COMMENT.test(line) || !STDOUT_WRITE.test(line)) return;
			found.push({ file, site: `${file}:${index + 1}`, code: line.trim() });
		});
	}
	return found;
}

function isExempt(write: { file: string; code: string }): boolean {
	return EXEMPT.some((exempt) => exempt.file === write.file && exempt.line === write.code);
}

describe("Agent output", () => {
	test("commands write to stdout only through the output seam", () => {
		const bypasses = stdoutWrites()
			.filter((write) => !isExempt(write))
			.map(
				(write) =>
					`${write.site}  ${write.code}  — write through emitText, emitJson or emitDocument in command-output.ts`,
			);
		expect(bypasses).toEqual([]);
	});

	test("every exemption still names a real write", () => {
		const writes = stdoutWrites();
		const stale = EXEMPT.filter(
			(exempt) => !writes.some((write) => write.file === exempt.file && write.code === exempt.line),
		).map((exempt) => `${exempt.file}  ${exempt.line}`);
		expect(stale).toEqual([]);
	});

	test("the guard is scanning the commands, not an empty directory", () => {
		expect(scannedFiles()).toContain("program.ts");
		expect(scannedFiles()).toContain(SEAM);
	});
});
