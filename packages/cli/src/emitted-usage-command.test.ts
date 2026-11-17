/**
 * `yoqa usage` and the accounting behind it, end to end against a fake runner: a screen read
 * emits, the ledger records it, and `yoqa usage` reports it against the Output budget.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActiveDeviceResponse, ScreenResponse } from "@yoqa/runner-client";
import { buildProgram } from "./program";

/** A runner with one Device Session and a dense screen to read. */
function fakeRunner() {
	let active: ActiveDeviceResponse | null = {
		deviceId: "sim-ABC",
		platform: "ios",
		connectedAt: 1_700_000_000_000,
	};
	const screen: ScreenResponse = {
		full: false,
		window: { width: 390, height: 844 },
		elements: [{ type: "Button", label: "Open", x: 10, y: 20, width: 30, height: 40 }],
	};
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: (request) => {
			const path = new URL(request.url).pathname;
			if (path === "/screen") return Response.json(screen);
			if (path === "/devices/active") {
				return active ? Response.json(active) : new Response(null, { status: 404 });
			}
			return Response.json({ error: "not found" }, { status: 404 });
		},
	});
	return {
		connect: (next: ActiveDeviceResponse | null) => {
			active = next;
		},
		url: `http://127.0.0.1:${server.port}`,
		stop: () => server.stop(true),
	};
}

describe("yoqa usage", () => {
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
		dir = await mkdtemp(join(tmpdir(), "yoqa-usage-"));
		// Keeps the test's accounting off a developer's own ledger under `~/.yoqa`.
		process.env.YOQA_EMITTED_USAGE_PATH = join(dir, "emitted-usage.jsonl");
		runner.connect({ deviceId: "sim-ABC", platform: "ios", connectedAt: 1_700_000_000_000 });
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	async function yoqa(...args: string[]): Promise<string[]> {
		printed = [];
		await buildProgram().parseAsync(["bun", "yoqa", ...args, "--base-url", runner.url]);
		return printed.flatMap((chunk) => chunk.split("\n"));
	}

	test("reports nothing emitted before any command has run", async () => {
		expect(await yoqa("usage")).toEqual([
			"Emitted 0 of 250,000 tokens (0%) — Device Session sim-ABC@1700000000000",
			"Nothing emitted for this Device Session yet.",
		]);
	});

	test("reports what a screen read put into the calling agent's context", async () => {
		await yoqa("screen");
		const lines = await yoqa("usage");

		// `  10,  20  30x40  Open` is 22 characters: 6 tokens at 4 to the token.
		expect(lines[0]).toBe(
			"Emitted 6 of 250,000 tokens (0%) — Device Session sim-ABC@1700000000000",
		);
		expect(lines[1]).toBe("  screen   6 (1 call)");
	});

	test("accumulates across commands and counts their calls", async () => {
		await yoqa("screen");
		await yoqa("screen");

		expect((await yoqa("usage"))[1]).toBe("  screen   12 (2 calls)");
	});

	test("starts from zero when a new Device Session connects", async () => {
		await yoqa("screen");
		runner.connect({ deviceId: "sim-ABC", platform: "ios", connectedAt: 1_700_000_009_999 });

		expect(await yoqa("usage")).toEqual([
			"Emitted 0 of 250,000 tokens (0%) — Device Session sim-ABC@1700000009999",
			"Nothing emitted for this Device Session yet.",
		]);
	});

	test("says there is nothing to account when no device is connected", async () => {
		runner.connect(null);

		expect(await yoqa("usage")).toEqual([
			"No active Device Session, so nothing is being accounted.",
		]);
	});

	test("reports against the budget the environment set", async () => {
		process.env.YOQA_OUTPUT_BUDGET = "1000000";
		try {
			expect((await yoqa("usage"))[0]).toContain("of 1,000,000 tokens");
		} finally {
			Reflect.deleteProperty(process.env, "YOQA_OUTPUT_BUDGET");
		}
	});

	test("--json gives an agent the same numbers on one line", async () => {
		await yoqa("screen");
		const lines = await yoqa("usage", "--json");

		expect(lines).toHaveLength(1);
		expect(JSON.parse(lines[0] as string)).toEqual({
			session: "sim-ABC@1700000000000",
			total: 6,
			budget: 250_000,
			byCommand: [{ command: "screen", tokens: 6, calls: 1 }],
		});
	});

	test("a screen read still succeeds when the runner has no Device Session to account to", async () => {
		runner.connect(null);

		expect(await yoqa("screen")).toEqual(["  10,  20  30x40  Open"]);
	});
});
