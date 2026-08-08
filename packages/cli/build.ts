/**
 * Bundle the CLI for npm: Node-compatible ESM with inlined workspace deps.
 */
const result = await Bun.build({
	entrypoints: ["./src/main.ts"],
	outdir: "./dist",
	target: "node",
	format: "esm",
	minify: false,
	sourcemap: "none",
	packages: "bundle",
	banner: "#!/usr/bin/env node",
});

if (!result.success) {
	for (const log of result.logs) {
		console.error(log);
	}
	process.exit(1);
}

console.log("[yoqa] built dist/main.js (node target)");
