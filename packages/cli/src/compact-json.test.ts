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
				return Response.json({ ok: true, service: "yoqa-runner", version: "1.0.7" });
			}
			if (path === "/status") {
				return Response.json({
					runner: { ok: true, version: "1.0.7" },
					provider: { configured: true, kind: "anthropic", label: "Claude" },
					activeDevice: ACTIVE,
				});
			}
			if (path === "/devices/active") return Response.json(ACTIVE);
			return Response.json({ error: "not found" }, { status: 404 });
		},
	});
	return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

describe("every command's JSON output", () => {
	const runner = fakeRunner();
	const log = console.log;
	const env = { ...process.env };
	let printed: string[] = [];
	let dir = "";

	beforeAll(() => {
		process.env.YOQA_NO_AUTOSTART = "1";
		console.log = (...args: unknown[]) => printed.push(args.join(" "));
	});

	afterAll(() => {
		runner.stop();
		console.log = log;
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
		await buildProgram().parseAsync(["bun", "yoqa", ...args, "--base-url", runner.url]);
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
});
