/**
 * Compile packaged desktop resources for Electrobun:
 * - Hono runner sidecar (`yoqa-runner`)
 * - CLI binary (`yoqa`)
 * - Agent skill archive (`yoqa-testing.tar.gz`)
 * - YoqaRunner source archive (`yoqa-runner-src.tar.gz`): the runner builds the iPhone
 *   XCUITest runner from it, since a compiled binary cannot reach `native/yoqa-runner`
 *
 * Invoked via electrobun `scripts.preBuild` (cwd = apps/desktop).
 *
 * After compile, macOS binaries are adhoc-signed — Bun's bytecode append invalidates the
 * linker signature and Apple Silicon AMFI SIGKILLs the unsigned result (exit 137).
 */
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
	CLI_CODE_IDENTIFIER,
	RUNNER_CODE_IDENTIFIER,
	ensureAdhocCodeSignature,
} from "../src/bun/features/macos-adhoc-sign";

const desktopRoot = resolve(import.meta.dir, "..");
const repoRoot = resolve(desktopRoot, "../..");
const outDir = join(desktopRoot, "resources/runner");
const skillsOutDir = join(desktopRoot, "resources/skills");
const runnerOutfile = join(outDir, "yoqa-runner");
const cliOutfile = join(outDir, "yoqa");
const skillSourceDir = join(repoRoot, "packages/skill/yoqa-testing");
const skillArchive = join(skillsOutDir, "yoqa-testing.tar.gz");
const yoqaRunnerSourceDir = join(repoRoot, "native/yoqa-runner");
const yoqaRunnerArchive = join(outDir, "yoqa-runner-src.tar.gz");
/** What `xcodebuild build-for-testing` needs; SwiftPM tests and state stay behind. */
const yoqaRunnerEntries = ["YoqaRunner", "YoqaRunnerUITests", "Sources", "YoqaRunner.xcodeproj"];

async function compileBinary(
	entry: string,
	outfile: string,
	label: string,
	identifier: string,
): Promise<void> {
	console.log(`[yoqa desktop] compiling ${label} → ${outfile}`);
	const result = await Bun.build({
		entrypoints: [entry],
		target: "bun",
		compile: { outfile },
	});
	if (!result.success) {
		for (const log of result.logs) {
			console.error(log);
		}
		throw new Error(`${label} compile failed`);
	}
	if (!(await Bun.file(outfile).exists())) {
		throw new Error(`${label} binary missing after compile: ${outfile}`);
	}
	const sign = await ensureAdhocCodeSignature(outfile, identifier);
	console.log(`[yoqa desktop] codesign ${label}: ${sign}`);
}

await mkdir(outDir, { recursive: true });
await mkdir(skillsOutDir, { recursive: true });

await compileBinary(
	join(repoRoot, "services/runner/src/index.ts"),
	runnerOutfile,
	"runner sidecar",
	RUNNER_CODE_IDENTIFIER,
);

await compileBinary(
	join(repoRoot, "packages/cli/src/main.ts"),
	cliOutfile,
	"CLI",
	CLI_CODE_IDENTIFIER,
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

await rm(yoqaRunnerArchive, { force: true });
console.log(`[yoqa desktop] packing YoqaRunner source → ${yoqaRunnerArchive}`);
const runnerTar = Bun.spawn(
	[
		"tar",
		"-czf",
		yoqaRunnerArchive,
		"--exclude",
		"xcuserdata",
		"--exclude",
		".DS_Store",
		"-C",
		yoqaRunnerSourceDir,
		...yoqaRunnerEntries,
	],
	{
		stdout: "inherit",
		stderr: "inherit",
		stdin: "ignore",
		env: { ...process.env, COPYFILE_DISABLE: "1" },
	},
);
const runnerTarCode = await runnerTar.exited;
if (runnerTarCode !== 0) {
	throw new Error(`YoqaRunner source pack failed (exit ${runnerTarCode})`);
}

console.log(`[yoqa desktop] packaged resources ready (${dirname(runnerOutfile)})`);
