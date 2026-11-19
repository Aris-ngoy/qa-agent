/**
 * Release Desktop's file bookkeeping (`.github/workflows/release-desktop.yml`).
 *
 *   bun apps/desktop/scripts/release-artifacts.ts build
 *     Before the build: which Electrobun channel to build and whether the patch is required.
 *   bun apps/desktop/scripts/release-artifacts.ts collect <macos-arm64|win-x64> <channel> <requirePatch>
 *     After the build: check `apps/desktop/artifacts/` and list the files to upload and publish.
 *     Fails a stable tag build that has no delta patch.
 *
 * Results go to `$GITHUB_OUTPUT` (stdout when run locally).
 */
import { appendFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
	type ReleaseChannel,
	type ReleasePlatform,
	collectReleaseFiles,
	releaseBuildFor,
} from "../src/bun/features/release-artifacts";

/** Workflow-relative paths: the build jobs upload from here, and `publish` downloads into `dist/`. */
const ARTIFACTS_PATH = "apps/desktop/artifacts";
const PUBLISH_PATH = "dist";

function writeOutputs(outputs: Record<string, string | string[]>) {
	const lines = Object.entries(outputs).map(([key, value]) =>
		Array.isArray(value) ? `${key}<<YOQA_EOF\n${value.join("\n")}\nYOQA_EOF` : `${key}=${value}`,
	);
	const text = `${lines.join("\n")}\n`;
	const outputFile = process.env.GITHUB_OUTPUT;
	if (outputFile) appendFileSync(outputFile, text);
	else process.stdout.write(text);
}

function fail(message: string): never {
	console.log(`::error::${message}`);
	process.exit(1);
}

const [command, ...args] = process.argv.slice(2);

if (command === "build") {
	const build = releaseBuildFor(process.env.GITHUB_REF ?? "");
	console.log(
		`Building ${build.channel} (${build.buildScript}); patch ${build.requirePatch ? "required" : "optional"}`,
	);
	writeOutputs({
		channel: build.channel,
		"require-patch": String(build.requirePatch),
		"build-script": build.buildScript,
	});
} else if (command === "collect") {
	const [platform, channel, requirePatch] = args;
	if (platform !== "macos-arm64" && platform !== "win-x64") fail(`Unknown platform: ${platform}`);
	if (channel !== "stable" && channel !== "canary") fail(`Unknown channel: ${channel}`);
	const artifactsDir = resolve(import.meta.dir, "../artifacts");
	const result = collectReleaseFiles({
		channel: channel as ReleaseChannel,
		platform: platform as ReleasePlatform,
		requirePatch: requirePatch === "true",
		artifacts: existsSync(artifactsDir) ? readdirSync(artifactsDir) : [],
	});
	if (!result.ok) fail(result.error);
	for (const warning of result.warnings) console.log(`::warning::${warning}`);
	console.log(`Release files: ${result.files.join(", ")}`);
	writeOutputs({
		files: result.files.map((name) => `${ARTIFACTS_PATH}/${name}`),
		"release-files": result.files.map((name) => `${PUBLISH_PATH}/${name}`),
		installer: result.installer,
		launch: result.launch,
	});
} else {
	fail("Usage: release-artifacts.ts build | collect <platform> <channel> <requirePatch>");
}
