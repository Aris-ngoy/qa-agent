/**
 * Compile the local Hono runner into a standalone binary for Electrobun packaging.
 * Invoked via electrobun `scripts.preBuild` (cwd = apps/desktop).
 */
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const desktopRoot = resolve(import.meta.dir, "..");
const repoRoot = resolve(desktopRoot, "../..");
const runnerEntry = join(repoRoot, "services/runner/src/index.ts");
const outDir = join(desktopRoot, "resources/runner");
const outfile = join(outDir, "yoqa-runner");

await mkdir(outDir, { recursive: true });

console.log(`[yoqa desktop] compiling runner sidecar → ${outfile}`);

const proc = Bun.spawn(["bun", "build", "--compile", `--outfile=${outfile}`, runnerEntry], {
	cwd: repoRoot,
	stdout: "inherit",
	stderr: "inherit",
	stdin: "ignore",
});

const code = await proc.exited;
if (code !== 0) {
	throw new Error(`Runner compile failed (exit ${code})`);
}

if (!(await Bun.file(outfile).exists())) {
	throw new Error(`Runner binary missing after compile: ${outfile}`);
}

console.log(`[yoqa desktop] runner sidecar ready (${dirname(outfile)})`);
