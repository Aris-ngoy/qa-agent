/**
 * Compile the local Hono runner into a standalone binary for Electrobun packaging.
 * Invoked via electrobun `scripts.preBuild` (cwd = apps/desktop).
 *
 * WebdriverIO loads its protocol driver via `import(options.automationProtocol || "webdriver")`.
 * That expression is not a string literal, so `bun build --compile` leaves it as a runtime
 * package resolve against `/$bunfs/root/…`, which fails with:
 *   ResolveMessage: Cannot find package 'webdriver' from '/$bunfs/root/yoqa-runner'
 * The plugin below rewrites those imports to `import("webdriver")` so Bun embeds the package.
 */
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const desktopRoot = resolve(import.meta.dir, "..");
const repoRoot = resolve(desktopRoot, "../..");
const runnerEntry = join(repoRoot, "services/runner/src/index.ts");
const outDir = join(desktopRoot, "resources/runner");
const outfile = join(outDir, "yoqa-runner");

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

await mkdir(outDir, { recursive: true });

console.log(`[yoqa desktop] compiling runner sidecar → ${outfile}`);

const result = await Bun.build({
	entrypoints: [runnerEntry],
	target: "bun",
	plugins: [forceWebdriverLiteralImport],
	compile: { outfile },
});

if (!result.success) {
	for (const log of result.logs) {
		console.error(log);
	}
	throw new Error("Runner compile failed");
}

if (!(await Bun.file(outfile).exists())) {
	throw new Error(`Runner binary missing after compile: ${outfile}`);
}

console.log(`[yoqa desktop] runner sidecar ready (${dirname(outfile)})`);
