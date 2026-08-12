#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const { homedir } = require("node:os");
const { dirname, join } = require("node:path");

function findBun() {
	const fromEnv = process.env.BUN_INSTALL ? join(process.env.BUN_INSTALL, "bin", "bun") : null;
	const candidates = [
		fromEnv,
		join(homedir(), ".bun", "bin", "bun"),
		"/opt/homebrew/bin/bun",
		"/usr/local/bin/bun",
	].filter(Boolean);
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	return "bun";
}

const entry = join(dirname(__filename), "..", "dist", "index.js");
if (!existsSync(entry)) {
	console.error(
		`yoqa-runner: bundled entry not found at ${entry}. Reinstall @yoqa/runner or run the package build.`,
	);
	process.exit(1);
}

const bun = findBun();
const child = spawn(bun, [entry, ...process.argv.slice(2)], {
	stdio: "inherit",
	env: process.env,
});

child.on("error", (error) => {
	if (error && error.code === "ENOENT") {
		console.error(
			"yoqa-runner needs Bun to start the local runner.\nInstall: https://bun.sh  (curl -fsSL https://bun.sh/install | bash)\nOr set YOQA_RUNNER_BIN to a yoqa-runner binary.",
		);
		process.exit(1);
		return;
	}
	console.error(error);
	process.exit(1);
});

child.on("exit", (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}
	process.exit(code ?? 1);
});
