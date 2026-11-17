/**
 * The Emitted usage ledger: what one Device Session's commands have put into a calling agent's
 * context window so far. Clock and path are injected, so nothing here touches `~/.yoqa`.
 *
 * The ledger is accounting, and accounting must never be able to break a QA session — so the
 * cases that matter most are the ones where the file is missing, corrupt or unwritable.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	MAX_LEDGER_BYTES,
	appendEmittedUsage,
	emittedUsageLedgerPath,
	readEmittedUsage,
} from "./emitted-usage-ledger";

const SESSION = "ios-sim-ABC@1000";

describe("what one Device Session has emitted", () => {
	let dir = "";
	let path = "";

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "yoqa-ledger-"));
		path = join(dir, "emitted-usage.jsonl");
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	/** One command's emission, as the seam records it. */
	const record = (command: string, tokens: number, session = SESSION) =>
		appendEmittedUsage({ session, command, tokens }, { path, now: () => 1_700_000_000_000 });

	test("reads as nothing at all before the session has emitted anything", async () => {
		expect(await readEmittedUsage(SESSION, { path })).toEqual({
			session: SESSION,
			total: 0,
			byCommand: [],
		});
	});

	test("accumulates across commands, and counts each command's calls", async () => {
		await record("screen", 400);
		await record("screen", 350);
		await record("action tap", 120);

		expect(await readEmittedUsage(SESSION, { path })).toEqual({
			session: SESSION,
			total: 870,
			byCommand: [
				{ command: "screen", tokens: 750, calls: 2 },
				{ command: "action tap", tokens: 120, calls: 1 },
			],
		});
	});

	test("orders the breakdown by what cost the most, so the expensive command is first", async () => {
		await record("screen", 10);
		await record("action tap", 900);
		await record("devices list", 300);

		const usage = await readEmittedUsage(SESSION, { path });
		expect(usage.byCommand.map((entry) => entry.command)).toEqual([
			"action tap",
			"devices list",
			"screen",
		]);
	});

	test("starts a newly connected Device Session from zero, leaving the old one readable", async () => {
		await record("screen", 400);
		await record("screen", 90, "ios-sim-ABC@2000");

		expect((await readEmittedUsage("ios-sim-ABC@2000", { path })).total).toBe(90);
		expect((await readEmittedUsage(SESSION, { path })).total).toBe(400);
	});

	test("skips a line it cannot read rather than losing the whole total", async () => {
		await record("screen", 400);
		await writeFile(path, `${await Bun.file(path).text()}not json at all\n{"session":\n`, "utf8");
		await record("screen", 100);

		expect((await readEmittedUsage(SESSION, { path })).total).toBe(500);
	});

	/**
	 * The file is a public artifact, not an internal: an engineer debugging Yoqa reads it by hand
	 * to see which commands are expensive in practice, so its shape is part of the contract.
	 */
	test("writes one line per command, stamped from the injected clock", async () => {
		await appendEmittedUsage(
			{ session: SESSION, command: "screen", tokens: 400 },
			{ path, now: () => 1_700_000_000_000 },
		);

		const lines = (await Bun.file(path).text()).trimEnd().split("\n");
		expect(lines).toHaveLength(1);
		expect(JSON.parse(lines[0] as string)).toEqual({
			session: SESSION,
			command: "screen",
			tokens: 400,
			at: 1_700_000_000_000,
		});
	});

	test("reads as zero when the file cannot be read at all", async () => {
		expect((await readEmittedUsage(SESSION, { path: join(dir, "nope", "x.jsonl") })).total).toBe(0);
	});

	test("survives a path it cannot write, because accounting never fails a command", async () => {
		// A file where a directory would have to be: the ledger cannot be created here at all.
		await writeFile(join(dir, "blocker"), "", "utf8");
		const unwritable = join(dir, "blocker", "x.jsonl");
		await appendEmittedUsage(
			{ session: SESSION, command: "screen", tokens: 400 },
			{ path: unwritable, now: () => 1 },
		);

		expect((await readEmittedUsage(SESSION, { path: unwritable })).total).toBe(0);
	});

	test("drops other sessions once the file outgrows its cap, rather than growing forever", async () => {
		const filler = Array.from({ length: Math.ceil(MAX_LEDGER_BYTES / 60) }, (_, index) =>
			JSON.stringify({ session: `old@${index}`, command: "screen", tokens: 1, at: 1 }),
		).join("\n");
		await writeFile(path, `${filler}\n`, "utf8");

		await record("screen", 400);

		expect((await readEmittedUsage(SESSION, { path })).total).toBe(400);
		expect((await readEmittedUsage("old@0", { path })).total).toBe(0);
		expect(Bun.file(path).size).toBeLessThan(MAX_LEDGER_BYTES);
	});

	test("creates the Yoqa home directory, because the CLI can run before the runner has", async () => {
		const nested = join(dir, "fresh-home", ".yoqa", "emitted-usage.jsonl");
		await appendEmittedUsage(
			{ session: SESSION, command: "screen", tokens: 400 },
			{ path: nested, now: () => 1 },
		);

		expect((await readEmittedUsage(SESSION, { path: nested })).total).toBe(400);
	});
});

describe("where the ledger lives", () => {
	test("sits under the Yoqa home directory by default", () => {
		expect(emittedUsageLedgerPath({})).toEndWith("/.yoqa/emitted-usage.jsonl");
	});

	test("takes the environment's path, so CI keeps its accounting off a developer's own", () => {
		expect(emittedUsageLedgerPath({ YOQA_EMITTED_USAGE_PATH: "/tmp/ci.jsonl" })).toBe(
			"/tmp/ci.jsonl",
		);
	});
});
