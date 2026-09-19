/**
 * Bundle the runner for npm: Bun-compatible ESM with inlined workspace deps.
 * Device automation shells out to the `agent-device` CLI (resolved at runtime
 * from node_modules/.bin, then PATH) — no native driver to bundle.
 */
const result = await Bun.build({
	entrypoints: ["./src/index.ts"],
	outdir: "./dist",
	target: "bun",
	format: "esm",
	minify: false,
	sourcemap: "none",
	packages: "bundle",
	external: ["agent-device"],
});

if (!result.success) {
	for (const log of result.logs) {
		console.error(log);
	}
	process.exit(1);
}

console.log("[yoqa-runner] built dist/index.js (bun target)");
