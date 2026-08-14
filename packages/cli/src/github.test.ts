import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendGithubFile } from "./github";
import { maybeWriteGithubRunOutput } from "./report";

describe("maybeWriteGithubRunOutput", () => {
	test("writes run_id and status when enabled", async () => {
		const dir = await mkdtemp(join(tmpdir(), "yoqa-gh-"));
		const output = join(dir, "github-output");
		await maybeWriteGithubRunOutput(
			{ id: "run_abc", status: "errored" },
			true,
			{ GITHUB_OUTPUT: output },
			appendGithubFile,
		);
		expect(await readFile(output, "utf8")).toBe("run_id=run_abc\nstatus=errored\n");
	});
});
