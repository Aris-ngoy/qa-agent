/**
 * Compact JSON across the CLI: every command that offers `--json` emits one line through the one
 * output seam, `--pretty` restores indentation, and the parsed content is the same either way.
 *
 * Driven through `buildProgram()` against a fake runner, because the promise is about what a
 * calling agent receives on stdout, not about how any one command builds its body.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import { buildProgram } from "./program";

const ACTIVE = { deviceId: "sim-ABC", platform: "ios", connectedAt: 1_700_000_000_000 };

/** A runner that answers the handful of reads these commands make. */
function fakeRunner() {
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: (request) => {
			const path = new URL(request.url).pathname;
			if (path === "/health") {
				return Response.json({ ok: true, service: "yoqa-runner", version: "1.0.7", uptimeMs: 42 });
			}
			if (path === "/status") {
				return Response.json({
					runner: { ok: true, version: "1.0.7" },
					provider: { configured: true, kind: "anthropic", label: "Claude" },
					activeDevice: ACTIVE,
				});
			}
			if (path === "/devices/active") return Response.json(ACTIVE);
			if (path === "/devices") {
				return Response.json({
					platform: "ios",
					devices: [
						{
							id: "sim-ABC",
							name: "iPhone 15",
							osVersion: "17.0",
							platform: "ios",
							kind: "simulator",
							state: "Booted",
						},
					],
				});
			}
			if (path === "/ios/signing") {
				return Response.json({
					team: "ABCDE12345",
					source: "saved",
					saved: "ABCDE12345",
					envOverride: null,
					bundleId: "dev.yoqa.runner",
					teams: [],
				});
			}
			return Response.json({ error: "not found" }, { status: 404 });
		},
	});
	return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

describe("every command's JSON output", () => {
	const runner = fakeRunner();
	const log = console.log;
	const error = console.error;
	const env = { ...process.env };
	let printed: string[] = [];
	let failed: string[] = [];
	let dir = "";

	beforeAll(() => {
		process.env.YOQA_NO_AUTOSTART = "1";
		console.log = (...args: unknown[]) => printed.push(args.join(" "));
		console.error = (...args: unknown[]) => failed.push(args.join(" "));
	});

	afterAll(() => {
		runner.stop();
		console.log = log;
		console.error = error;
		process.env = env;
	});

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "yoqa-json-"));
		process.env.YOQA_EMITTED_USAGE_PATH = join(dir, "emitted-usage.jsonl");
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	/** One command's stdout, as a calling agent would receive it. */
	async function yoqa(...args: string[]): Promise<string> {
		printed = [];
		failed = [];
		await buildProgram().parseAsync(["bun", "yoqa", ...args, "--base-url", runner.url]);
		// A command that failed would otherwise look like a command that emitted nothing.
		if (failed.length > 0) throw new Error(failed.join("\n"));
		return printed.join("\n");
	}

	/** The promise, for one command: one line, indentable, and identical once parsed. */
	async function expectCompactAndPretty(...args: string[]): Promise<unknown> {
		const compact = await yoqa(...args, "--json");
		const pretty = await yoqa(...args, "--json", "--pretty");

		expect(compact.split("\n")).toHaveLength(1);
		expect(pretty.split("\n").length).toBeGreaterThan(1);
		expect(JSON.parse(compact)).toEqual(JSON.parse(pretty));
		return JSON.parse(compact);
	}

	test("yoqa status", async () => {
		expect(await expectCompactAndPretty("status")).toMatchObject({
			runner: { ok: true, version: "1.0.7" },
		});
	});

	test("yoqa devices ios — a subcommand, named for the ledger as a caller typed it", async () => {
		expect(await expectCompactAndPretty("devices", "ios")).toMatchObject({
			devices: [{ id: "sim-ABC" }],
		});
	});

	test("yoqa signing — a command whose other half is a human rendering", async () => {
		expect(await expectCompactAndPretty("signing")).toMatchObject({ team: "ABCDE12345" });
	});

	test("yoqa health — which has only ever printed JSON, so --pretty is its only switch", async () => {
		const compact = await yoqa("health");
		const pretty = await yoqa("health", "--pretty");

		expect(compact.split("\n")).toHaveLength(1);
		expect(JSON.parse(compact)).toEqual(JSON.parse(pretty));
		expect(JSON.parse(compact)).toMatchObject({ ok: true, service: "yoqa-runner" });
	});

	test("the human rendering is untouched — this ticket moved the JSON, not the text", async () => {
		expect(await yoqa("status")).toBe(
			["runner: ok (1.0.7)", "provider: Claude", "active device: ios sim-ABC"].join("\n"),
		);
	});

	test("every migrated command contributes to Emitted usage", async () => {
		await yoqa("status", "--json");
		await yoqa("devices", "ios", "--json");

		const report = await yoqa("usage", "--json");
		const { byCommand } = JSON.parse(report) as {
			byCommand: { command: string; tokens: number }[];
		};

		// Named as a caller typed them, which is what makes the breakdown worth reading.
		expect(byCommand.map((entry) => entry.command).sort()).toEqual(["devices ios", "status"]);
		expect(byCommand.every((entry) => entry.tokens > 0)).toBe(true);
	});
});

describe("the options every JSON command carries", () => {
	/** Every command in the built tree, by the name a caller would type. */
	function allCommands(): { path: string; flags: string[] }[] {
		const walk = (cmd: Command, prefix: string[]): { path: string; flags: string[] }[] => {
			const path = [...prefix, cmd.name()];
			const here = {
				path: path.join(" "),
				flags: cmd.options.map((option) => option.long ?? option.short ?? ""),
			};
			return [here, ...cmd.commands.flatMap((child) => walk(child, path))];
		};
		return buildProgram().commands.flatMap((cmd) => walk(cmd, []));
	}

	test("a command offering --json always offers --pretty", () => {
		// Walks the real tree rather than trusting a helper every new command must remember to
		// call: before this ticket, forty commands offered JSON a person could not read.
		const unpaired = allCommands()
			.filter((cmd) => cmd.flags.includes("--json") && !cmd.flags.includes("--pretty"))
			.map((cmd) => cmd.path);

		expect(unpaired).toEqual([]);
	});

	test("and there are enough of them that this is worth guarding", () => {
		const withJson = allCommands().filter((cmd) => cmd.flags.includes("--json"));

		expect(withJson.length).toBeGreaterThan(35);
	});
});
