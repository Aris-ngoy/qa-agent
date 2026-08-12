/**
 * Bundle the runner for npm: Bun-compatible ESM with inlined workspace deps.
 * webdriver / webdriverio stay external (dynamic import, same as the desktop compile).
 */
const result = await Bun.build({
	entrypoints: ["./src/index.ts"],
	outdir: "./dist",
	target: "bun",
	format: "esm",
	minify: false,
	sourcemap: "none",
	packages: "bundle",
	external: ["webdriver", "webdriverio"],
});

if (!result.success) {
	for (const log of result.logs) {
		console.error(log);
	}
	process.exit(1);
}

console.log("[yoqa-runner] built dist/index.js (bun target)");
