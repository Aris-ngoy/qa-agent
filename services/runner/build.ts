/**
 * Bundle the runner for npm: Bun-compatible ESM with inlined workspace deps.
 * Device automation shells out to the Argent CLI (`argent run …`, resolved at
 * runtime from global user installs then PATH) — no native driver to bundle.
 */
const result = await Bun.build({
	entrypoints: ["./src/index.ts"],
	outdir: "./dist",
	target: "bun",
	format: "esm",
	minify: false,
	sourcemap: "none",
	packages: "bundle",
});

if (!result.success) {
	for (const log of result.logs) {
		console.error(log);
	}
	process.exit(1);
}

console.log("[yoqa-runner] built dist/index.js (bun target)");
