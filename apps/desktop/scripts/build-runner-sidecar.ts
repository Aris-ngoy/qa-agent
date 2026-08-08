/**
 * Compile packaged desktop resources for Electrobun:
 * - Hono runner sidecar (`yoqa-runner`)
 * - CLI binary (`yoqa`)
 * - Agent skill archive (`yoqa-testing.tar.gz`)
 *
 * Invoked via electrobun `scripts.preBuild` (cwd = apps/desktop).
 */
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const desktopRoot = resolve(import.meta.dir, "..");
const repoRoot = resolve(desktopRoot, "../..");
const outDir = join(desktopRoot, "resources/runner");
const skillsOutDir = join(desktopRoot, "resources/skills");
const runnerOutfile = join(outDir, "yoqa-runner");
const cliOutfile = join(outDir, "yoqa");
const skillSourceDir = join(repoRoot, "packages/skill/yoqa-testing");
const skillArchive = join(skillsOutDir, "yoqa-testing.tar.gz");

async function compileBinary(entry: string, outfile: string, label: string): Promise<void> {
	console.log(`[yoqa desktop] compiling ${label} → ${outfile}`);
	const proc = Bun.spawn(["bun", "build", "--compile", `--outfile=${outfile}`, entry], {
		cwd: repoRoot,
		stdout: "inherit",
		stderr: "inherit",
		stdin: "ignore",
	});
	const code = await proc.exited;
	if (code !== 0) {
		throw new Error(`${label} compile failed (exit ${code})`);
	}
	if (!(await Bun.file(outfile).exists())) {
		throw new Error(`${label} binary missing after compile: ${outfile}`);
	}
}

await mkdir(outDir, { recursive: true });
await mkdir(skillsOutDir, { recursive: true });

await compileBinary(
	join(repoRoot, "services/runner/src/index.ts"),
	runnerOutfile,
	"runner sidecar",
);

await compileBinary(
	join(repoRoot, "services/runner/src/interfaces/cli/main.ts"),
	cliOutfile,
	"CLI",
);

if (!(await Bun.file(join(skillSourceDir, "SKILL.md")).exists())) {
	throw new Error(`Skill source missing: ${skillSourceDir}`);
}

await rm(skillArchive, { force: true });
console.log(`[yoqa desktop] packing skill → ${skillArchive}`);
const tar = Bun.spawn(
	["tar", "-czf", skillArchive, "-C", dirname(skillSourceDir), "yoqa-testing"],
	{
		cwd: repoRoot,
		stdout: "inherit",
		stderr: "inherit",
		stdin: "ignore",
	},
);
const tarCode = await tar.exited;
if (tarCode !== 0) {
	throw new Error(`Skill pack failed (exit ${tarCode})`);
}
if (!(await Bun.file(skillArchive).exists())) {
	throw new Error(`Skill archive missing after pack: ${skillArchive}`);
}

console.log(`[yoqa desktop] packaged resources ready (${dirname(runnerOutfile)})`);
