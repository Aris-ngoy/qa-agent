/**
 * Compile packaged desktop resources for Electrobun:
 * - Hono runner sidecar (`yoqa-runner`)
 * - CLI binary (`yoqa`)
 * - Agent skill archive (`yoqa-testing.tar.gz`)
 *
 * Invoked via electrobun `scripts.preBuild` (cwd = apps/desktop).
 *
 * WebdriverIO loads its protocol driver via `import(options.automationProtocol || "webdriver")`.
 * That expression is not a string literal, so `bun build --compile` leaves it as a runtime
 * package resolve against `/$bunfs/root/…`, which fails with:
 *   ResolveMessage: Cannot find package 'webdriver' from '/$bunfs/root/yoqa-runner'
 * The plugin below rewrites those imports to `import("webdriver")` so Bun embeds the package.
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

const forceWebdriverLiteralImport: Bun.BunPlugin = {
	name: "force-webdriver-literal-import",
	setup(build) {
		build.onLoad({ filter: /webdriverio\/build\/node\.js$/ }, async (args) => {
			let source = await Bun.file(args.path).text();
			const before = source;
			source = source.replace(
				/await import\(\s*\/\* @vite-ignore \*\/\s*options\.automationProtocol \|\| ["']webdriver["']\s*\)/g,
				'await import("webdriver")',
			);
			source = source.replace(
				/await import\(\s*\/\* @vite-ignore \*\/\s*this\.options\.automationProtocol\s*\)/g,
				'await import("webdriver")',
			);
			if (source === before) {
				throw new Error(
					"webdriverio patch did not match; compiled yoqa-runner would fail to resolve 'webdriver'",
				);
			}
			return { contents: source, loader: "js" };
		});
	},
};

async function compileBinary(
	entry: string,
	outfile: string,
	label: string,
	identifier: string,
	plugins: Bun.BunPlugin[] = [],
): Promise<void> {
	console.log(`[yoqa desktop] compiling ${label} → ${outfile}`);
	const result = await Bun.build({
		entrypoints: [entry],
		target: "bun",
		plugins,
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
	[forceWebdriverLiteralImport],
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

console.log(`[yoqa desktop] packaged resources ready (${dirname(runnerOutfile)})`);
