import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CLI_CODE_IDENTIFIER,
	ensureAdhocCodeSignature,
	verifyMacCodeSignature,
} from "./macos-adhoc-sign";

describe("ensureAdhocCodeSignature", () => {
	test("no-ops on non-darwin platforms", async () => {
		const result = await ensureAdhocCodeSignature("/does/not/matter", CLI_CODE_IDENTIFIER, "linux");
		expect(result).toBe("skipped");
	});

	test("throws when the darwin target is missing", async () => {
		await expect(
			ensureAdhocCodeSignature("/tmp/yoqa-missing-binary", CLI_CODE_IDENTIFIER, "darwin"),
		).rejects.toThrow("Cannot codesign missing file");
	});
});

describe.skipIf(process.platform !== "darwin")("ensureAdhocCodeSignature (darwin)", () => {
	let workDir = "";

	afterAll(async () => {
		if (workDir) await rm(workDir, { recursive: true, force: true });
	});

	test("re-signs a bun --compile binary so codesign verifies and it runs", async () => {
		workDir = await mkdtemp(join(tmpdir(), "yoqa-adhoc-sign-"));
		const entry = join(workDir, "hi.ts");
		const outfile = join(workDir, "hi");
		await Bun.write(entry, 'console.log("yoqa-adhoc-ok");\n');

		const compiled = await Bun.build({
			entrypoints: [entry],
			target: "bun",
			compile: { outfile },
		});
		expect(compiled.success).toBe(true);
		expect(await Bun.file(outfile).exists()).toBe(true);

		const result = await ensureAdhocCodeSignature(outfile, CLI_CODE_IDENTIFIER);
		expect(result === "resigned" || result === "valid").toBe(true);
		expect(await verifyMacCodeSignature(outfile)).toBe(true);

		const proc = Bun.spawn([outfile], {
			stdout: "pipe",
			stderr: "pipe",
			stdin: "ignore",
		});
		const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
		expect(code).toBe(0);
		expect(stdout).toContain("yoqa-adhoc-ok");
	});
});
