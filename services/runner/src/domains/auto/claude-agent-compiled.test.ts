import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The desktop app runs the runner as a `bun build --compile` binary, where the Claude Agent SDK
 * cannot find the Claude Code binary it ships (it resolves it from inside `$bunfs`). A turn there
 * must start the Provider's own Claude CLI instead, here a stub that records it ran.
 */
describe.skipIf(process.platform === "win32")("Claude chat agent in a compiled runner", () => {
	test("a turn starts the Provider's Claude CLI", async () => {
		const dir = await mkdtemp(join(tmpdir(), "yoqa-compiled-claude-"));
		const cli = join(dir, "claude");
		const ran = join(dir, "claude-ran");
		await writeFile(cli, `#!/bin/sh\ntouch "${ran}"\nexit 3\n`);
		await chmod(cli, 0o755);

		const turnBin = join(dir, "turn");
		const build = await Bun.build({
			entrypoints: [join(import.meta.dir, "fixtures/compiled-claude-turn.ts")],
			target: "bun",
			compile: { outfile: turnBin },
		});
		expect(build.success).toBe(true);

		// The outcome goes through a file: a piped stdout reads empty from a compiled child here.
		const result = join(dir, "turn-result.txt");
		const proc = Bun.spawn([turnBin], {
			cwd: dir,
			env: {
				...process.env,
				YOQA_AUTO_CHATS_DIR: join(dir, "chats"),
				YOQA_TEST_CLAUDE_BIN: cli,
				YOQA_TEST_TURN_RESULT: result,
			},
			stdout: "ignore",
			stderr: "ignore",
		});
		expect(await proc.exited).toBe(0);

		expect(await readFile(result, "utf8")).not.toContain("Native CLI binary");
		expect(existsSync(ran)).toBe(true);
	}, 60_000);
});
