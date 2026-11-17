/**
 * The CLI's one Agent output seam. Everything `yoqa` writes to stdout for a calling agent is
 * shaped here, so these tests are the contract for what lands in that agent's context window.
 *
 * Shaping is pure — no runner, no device, no clock. Only the emitting tests at the bottom touch a
 * ledger, and they inject its path.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_SCREEN_ROWS, type ScreenResponse } from "@yoqa/runner-client";
import {
	emitAgentOutput,
	formatAgentOutput,
	parseScreenLimit,
	resolveScreenRows,
} from "./agent-output";
import { readEmittedUsage } from "./emitted-usage-ledger";

/** A cleaned Screen holding `count` elements, laid out one per row down the screen. */
function cleanedScreen(count: number): ScreenResponse {
	return {
		full: false,
		window: { width: 390, height: 844 },
		elements: Array.from({ length: count }, (_, index) => ({
			type: "Button",
			label: `Row ${index}`,
			id: `row_${index}`,
			x: 10,
			y: index * 10,
			width: 30,
			height: 40,
		})),
	};
}

/** The signature and IHDR chunk of a PNG of the given size — all a size read looks at. */
function pngHeader(width: number, height: number): Uint8Array {
	const bytes = Buffer.alloc(33);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
	bytes.writeUInt32BE(13, 8);
	bytes.write("IHDR", 12, "ascii");
	bytes.writeUInt32BE(width, 16);
	bytes.writeUInt32BE(height, 20);
	return bytes;
}

const screenOutput = (screen: ScreenResponse, options = {}) =>
	formatAgentOutput({ kind: "screen", screen }, options);

describe("a cleaned Screen read", () => {
	test("trims a dense tree to the row cap and says how many elements it left out", () => {
		const out = screenOutput(cleanedScreen(100));
		const lines = out.text.split("\n");

		expect(lines).toHaveLength(81);
		expect(lines.at(-1)).toBe("… 20 more elements omitted");
		expect(out.omitted).toBe(20);
	});

	test("caps at the same row count as the Decide loop's screen snapshot", () => {
		expect(screenOutput(cleanedScreen(MAX_SCREEN_ROWS)).omitted).toBe(0);
		expect(screenOutput(cleanedScreen(MAX_SCREEN_ROWS + 1)).omitted).toBe(1);
	});
});

describe("a Screen that fits", () => {
	test("emits every row and no omitted line", () => {
		const out = screenOutput(cleanedScreen(3));

		expect(out.text.split("\n")).toEqual([
			"  10,   0  30x40  Row 0",
			"  10,  10  30x40  Row 1",
			"  10,  20  30x40  Row 2",
		]);
		expect(out.omitted).toBe(0);
	});

	test("says nothing at all, and costs nothing, for an empty tree", () => {
		expect(screenOutput(cleanedScreen(0))).toEqual({ text: "", omitted: 0, tokens: 0 });
	});

	test("leads with the app the tree was read from, so a SpringBoard tree is not taken for the app's", () => {
		const read = (source: ScreenResponse["source"]) =>
			screenOutput({ ...cleanedScreen(1), source }).text.split("\n")[0];

		expect(read({ kind: "target", bundleId: "com.demo" })).toBe("Read from com.demo (target app)");
		expect(read({ kind: "foreground", bundleId: "com.other" })).toBe(
			"Read from com.other (foreground app)",
		);
		expect(read({ kind: "system" })).toBe("Read from the system (SpringBoard), not an app");
		expect(read(undefined)).toBe("  10,   0  30x40  Row 0");
	});
});

describe("the row limit a caller asks for", () => {
	test("lowers the cap, and still reports what it left out", () => {
		const out = screenOutput(cleanedScreen(100), { limit: 5 });

		expect(out.text.split("\n")).toHaveLength(6);
		expect(out.omitted).toBe(95);
	});

	test("raises the cap past the default, so a dense tree can be read in full", () => {
		const out = screenOutput(cleanedScreen(100), { limit: 100 });

		expect(out.text.split("\n")).toHaveLength(100);
		expect(out.omitted).toBe(0);
	});

	test("is a whole number of rows, or the command fails before reading anything", () => {
		expect(parseScreenLimit("1")).toBe(1);
		expect(parseScreenLimit("250")).toBe(250);
		for (const bad of ["0", "-5", "2.5", "all", ""]) {
			expect(() => parseScreenLimit(bad)).toThrow(
				"--limit must be a whole number of rows, 1 or more",
			);
		}
	});

	test("unset leaves the shared cap in charge", () => {
		expect(parseScreenLimit(undefined)).toBeUndefined();
		expect(screenOutput(cleanedScreen(100), { limit: undefined }).omitted).toBe(20);
	});
});

describe("the row cap the environment sets", () => {
	test("leaves the shared cap in charge when nothing overrides it", () => {
		expect(resolveScreenRows({})).toBe(MAX_SCREEN_ROWS);
	});

	test("takes a whole number of rows from YOQA_SCREEN_ROWS", () => {
		expect(resolveScreenRows({ YOQA_SCREEN_ROWS: "20" })).toBe(20);
		expect(resolveScreenRows({ YOQA_SCREEN_ROWS: "500" })).toBe(500);
	});

	test("keeps the shared cap rather than guessing at an unusable row count", () => {
		for (const bad of ["0", "-5", "2.5", "lots", ""]) {
			expect(resolveScreenRows({ YOQA_SCREEN_ROWS: bad })).toBe(MAX_SCREEN_ROWS);
		}
	});
});

describe("a Screen read as JSON", () => {
	test("is one line, because indentation is tokens a calling agent pays for", () => {
		const out = screenOutput(cleanedScreen(2), { json: true });

		expect(out.text.split("\n")).toHaveLength(1);
		expect(JSON.parse(out.text).elements).toHaveLength(2);
	});

	test("carries the source the formatted listing leads with", () => {
		const screen = { ...cleanedScreen(1), source: { kind: "system" } as const };

		expect(JSON.parse(screenOutput(screen, { json: true }).text).source).toEqual({
			kind: "system",
		});
	});

	test("caps its elements like the listing does, and says so in the payload", () => {
		const out = screenOutput(cleanedScreen(100), { json: true });
		const body = JSON.parse(out.text);

		expect(body.elements).toHaveLength(80);
		expect(body.omittedElements).toBe(20);
		expect(out.omitted).toBe(20);
	});

	test("leaves out the omitted marker when nothing was trimmed", () => {
		const body = JSON.parse(screenOutput(cleanedScreen(2), { json: true }).text);

		expect(body).not.toHaveProperty("omittedElements");
	});

	test("--pretty indents it again without changing what it says", () => {
		const screen = cleanedScreen(2);
		const compact = screenOutput(screen, { json: true });
		const pretty = screenOutput(screen, { json: true, pretty: true });

		expect(pretty.text.split("\n").length).toBeGreaterThan(1);
		expect(JSON.parse(pretty.text)).toEqual(JSON.parse(compact.text));
	});
});

describe("the raw accessibility tree", () => {
	const rawScreen: ScreenResponse = {
		full: true,
		window: { width: 390, height: 844 },
		raw: "<hierarchy><node/></hierarchy>",
	};

	test("is emitted as compact JSON rather than indented", () => {
		const out = screenOutput(rawScreen);

		expect(out.text.split("\n")).toHaveLength(1);
		expect(JSON.parse(out.text).raw).toBe(rawScreen.raw);
	});

	test("is never trimmed, because it is the escape hatch for a genuinely hard problem", () => {
		const out = screenOutput(rawScreen, { limit: 1 });

		expect(JSON.parse(out.text).raw).toBe(rawScreen.raw);
		expect(out.omitted).toBe(0);
	});
});

describe("what the seam says one command cost", () => {
	test("estimates the text it is about to write", () => {
		// Three `  10,   0  30x40  Row 0` rows of 23 characters, plus 2 newlines: 71 characters,
		// 18 tokens at the estimator's 4 characters to the token.
		const out = screenOutput(cleanedScreen(3));

		expect(out.text).toHaveLength(71);
		expect(out.tokens).toBe(18);
	});

	test("rises with the payload, and is the same every time for the same payload", () => {
		const small = screenOutput(cleanedScreen(3)).tokens;
		const large = screenOutput(cleanedScreen(50)).tokens;

		expect(large).toBeGreaterThan(small);
		expect(screenOutput(cleanedScreen(3)).tokens).toBe(small);
	});

	test("charges a trimmed tree for what it emitted, not for the tree it read", () => {
		const dense = cleanedScreen(1000);
		const capped = screenOutput(dense).tokens;
		const whole = screenOutput(dense, { limit: 1000 }).tokens;

		// The cap is what keeps a dense screen from being a large fraction of the window.
		expect(capped).toBeLessThan(whole / 10);
	});

	test("adds the Agent image the output names, because the agent pays on reading it", () => {
		const screen = cleanedScreen(3);
		const text = formatAgentOutput({ kind: "screen", screen }).tokens;
		const withImage = formatAgentOutput({
			kind: "screen",
			screen,
			image: { width: 1000, height: 750 },
		}).tokens;

		expect(withImage).toBe(text + 1000);
	});
});

describe("emitting a command's output", () => {
	let dir = "";
	let path = "";
	const log = console.log;
	let printed: string[] = [];

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "yoqa-emit-"));
		path = join(dir, "emitted-usage.jsonl");
		printed = [];
		console.log = (...args: unknown[]) => printed.push(args.join(" "));
	});

	afterEach(async () => {
		console.log = log;
		await rm(dir, { recursive: true, force: true });
	});

	test("writes the output, then records what it cost against the Device Session", async () => {
		const out = await emitAgentOutput(
			{ kind: "screen", screen: cleanedScreen(3) },
			{},
			{ command: "screen", session: async () => "ios-sim-ABC@1000", ledger: { path } },
		);

		expect(printed).toEqual([out.text]);
		expect(await readEmittedUsage("ios-sim-ABC@1000", { path })).toEqual({
			session: "ios-sim-ABC@1000",
			total: out.tokens,
			byCommand: [{ command: "screen", tokens: out.tokens, calls: 1 }],
		});
	});

	test("still writes the output when the Device Session cannot be resolved", async () => {
		const out = await emitAgentOutput(
			{ kind: "screen", screen: cleanedScreen(3) },
			{},
			{
				command: "screen",
				session: async () => {
					throw new Error("runner is down");
				},
				ledger: { path },
			},
		);

		expect(printed).toEqual([out.text]);
	});

	test("prices the Agent image a command names by path, once its output is written", async () => {
		const image = join(dir, "result_agent.png");
		const lines = [`screenshot ${image}`];
		const text = formatAgentOutput({ kind: "text", lines }).tokens;
		// The image only exists once the line naming it is on stdout, so it is priced only if the
		// seam reads it after writing — an agent never waits on accounting for its answer.
		console.log = (...args: unknown[]) => {
			printed.push(args.join(" "));
			writeFileSync(image, pngHeader(1000, 750));
		};

		const out = await emitAgentOutput(
			{ kind: "text", lines, imagePath: image },
			{},
			{ command: "action tap", session: async () => "ios-sim-ABC@1000", ledger: { path } },
		);

		// 1000 × 750 px at 750 px to the token.
		expect(out.tokens).toBe(text + 1000);
		expect(printed).toEqual(lines);
		expect((await readEmittedUsage("ios-sim-ABC@1000", { path })).total).toBe(text + 1000);
	});

	test("prices a named image it cannot open as no image, and still writes the output", async () => {
		const lines = [`screenshot ${join(dir, "elsewhere.png")}`];
		const text = formatAgentOutput({ kind: "text", lines }).tokens;

		const out = await emitAgentOutput(
			{ kind: "text", lines, imagePath: join(dir, "elsewhere.png") },
			{},
			{ command: "action tap", session: async () => "ios-sim-ABC@1000", ledger: { path } },
		);

		expect(out.tokens).toBe(text);
		expect(printed).toEqual(lines);
	});

	test("records nothing for a command that emitted nothing", async () => {
		await emitAgentOutput(
			{ kind: "screen", screen: cleanedScreen(0) },
			{},
			{ command: "screen", session: async () => "ios-sim-ABC@1000", ledger: { path } },
		);

		expect(printed).toEqual([]);
		expect((await readEmittedUsage("ios-sim-ABC@1000", { path })).total).toBe(0);
	});
});

describe("warning when the Output budget threshold is crossed", () => {
	const log = console.log;
	const error = console.error;
	const env = { ...process.env };
	let dir = "";
	let path = "";
	let printed: string[] = [];
	let warned: string[] = [];

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "yoqa-warn-"));
		path = join(dir, "emitted-usage.jsonl");
		printed = [];
		warned = [];
		console.log = (...args: unknown[]) => printed.push(args.join(" "));
		console.error = (...args: unknown[]) => warned.push(args.join(" "));
		// A 100-token budget warning at 10% puts the high-water mark at 10 tokens, so one
		// three-row tree (18) crosses it. The real defaults would need a whole QA session.
		process.env.YOQA_OUTPUT_BUDGET = "100";
		process.env.YOQA_OUTPUT_WARN_AT = "10";
	});

	afterEach(async () => {
		console.log = log;
		console.error = error;
		process.env = { ...env };
		await rm(dir, { recursive: true, force: true });
	});

	const emit = (session = "ios-sim-ABC@1000") =>
		emitAgentOutput(
			{ kind: "screen", screen: cleanedScreen(3) },
			{},
			{ command: "screen", session: async () => session, ledger: { path } },
		);

	test("writes exactly one line, and writes it to stderr", async () => {
		const out = await emit();

		expect(warned).toEqual([
			"Yoqa has emitted 18 of 100 tokens (18%) into this context — delegate further exploration to a sub-agent, or compact.",
		]);
		// stdout carries the command's answer and nothing else: a warning there could corrupt it.
		expect(printed).toEqual([out.text]);
	});

	test("leaves stdout byte-identical whether or not it fires", async () => {
		// Two Device Sessions rather than two thresholds: each has its own running total, so one
		// crosses and one never will, and the only difference between them is the stderr line.
		process.env.YOQA_NO_OUTPUT_WARNING = "1";
		const quiet = (await emit("ios-sim-QUIET@1000")).text;
		expect(warned).toEqual([]);

		Reflect.deleteProperty(process.env, "YOQA_NO_OUTPUT_WARNING");
		const loud = (await emit("ios-sim-LOUD@1000")).text;
		expect(warned).toHaveLength(1);

		expect(loud).toBe(quiet);
		expect(printed).toEqual([quiet, loud]);
	});

	test("says nothing at all when the environment suppresses it", async () => {
		process.env.YOQA_NO_OUTPUT_WARNING = "1";
		const out = await emit();

		expect(warned).toEqual([]);
		expect(printed).toEqual([out.text]);
	});

	test("caps at the environment's row count, so every command through the seam honours it", async () => {
		process.env.YOQA_SCREEN_ROWS = "5";
		const out = await emitAgentOutput(
			{ kind: "screen", screen: cleanedScreen(100) },
			{},
			{ command: "screen", session: async () => null, ledger: { path } },
		);

		expect(out.text.split("\n")).toHaveLength(6);
		expect(out.omitted).toBe(95);
	});

	test("lets a caller's own limit outrank the environment's row count", async () => {
		process.env.YOQA_SCREEN_ROWS = "5";
		const out = await emitAgentOutput(
			{ kind: "screen", screen: cleanedScreen(100) },
			{ limit: 20 },
			{ command: "screen", session: async () => null, ledger: { path } },
		);

		expect(out.omitted).toBe(80);
	});

	test("never warns about a session it could not account to", async () => {
		await emitAgentOutput(
			{ kind: "screen", screen: cleanedScreen(3) },
			{},
			{ command: "screen", session: async () => null, ledger: { path } },
		);

		expect(warned).toEqual([]);
	});
});

describe("a command's JSON result", () => {
	const body = { ok: true, device: { id: "sim-ABC", platform: "ios" }, apps: ["a", "b"] };
	const jsonOutput = (options: Parameters<typeof formatAgentOutput>[1] = {}) =>
		formatAgentOutput({ kind: "json", body }, options);

	test("emits one line, because indentation is tokens with no content", () => {
		const out = jsonOutput();

		expect(out.text.split("\n")).toHaveLength(1);
		expect(out.text).toBe(
			'{"ok":true,"device":{"id":"sim-ABC","platform":"ios"},"apps":["a","b"]}',
		);
	});

	test("indents for a human who asked to read it", () => {
		expect(jsonOutput({ pretty: true }).text.split("\n").length).toBeGreaterThan(1);
	});

	test("parses to the same content either way, which is the whole promise", () => {
		expect(JSON.parse(jsonOutput().text)).toEqual(body);
		expect(JSON.parse(jsonOutput({ pretty: true }).text)).toEqual(body);
	});

	test("costs what it wrote, so a pretty result is dearer than a compact one", () => {
		expect(jsonOutput().tokens).toBeGreaterThan(0);
		expect(jsonOutput({ pretty: true }).tokens).toBeGreaterThan(jsonOutput().tokens);
	});

	test("trims nothing: a result is not a tree, and the row cap has no meaning for it", () => {
		expect(jsonOutput({ limit: 1 }).omitted).toBe(0);
		expect(JSON.parse(jsonOutput({ limit: 1 }).text)).toEqual(body);
	});
});

describe("a command's human-readable listing", () => {
	const textOutput = (lines: string[], options: Parameters<typeof formatAgentOutput>[1] = {}) =>
		formatAgentOutput({ kind: "text", lines }, options);

	/** What one emission of `lines` put on stdout, one entry per `console.log` call. */
	const printedBy = async (lines: string[], command: string) => {
		const log = console.log;
		const printed: string[] = [];
		console.log = (...args: unknown[]) => printed.push(args.join(" "));
		try {
			await emitAgentOutput({ kind: "text", lines }, {}, { command, session: async () => null });
		} finally {
			console.log = log;
		}
		return printed;
	};

	test("is the lines a caller gave, in order, joined by one newline each", () => {
		expect(textOutput(["prefix: DEMO", "name: Demo app"]).text).toBe(
			"prefix: DEMO\nname: Demo app",
		);
	});

	test("carries no trailing newline, because the seam terminates the line it writes", () => {
		expect(textOutput(["ok tap"]).text).toBe("ok tap");
	});

	test("still writes a line that happens to be empty, as console.log always did", async () => {
		// A flow with no instructions prints a blank line. Dropping it would shift every line after
		// it, and the promise of this batch is byte-identical output.
		expect(await printedBy([""], "flows get")).toEqual([""]);
	});

	test("writes nothing at all for a listing with no lines, as an empty loop always did", async () => {
		expect(await printedBy([], "cases list")).toEqual([]);
	});

	test("writes each line as its own line, the way the command always wrote it", async () => {
		// One emission for the ledger, but the same writes on stdout: a caller watching line by
		// line sees exactly what it saw before the seam existed.
		expect(await printedBy(["prefix: DEMO", "name: Demo app"], "apps get")).toEqual([
			"prefix: DEMO",
			"name: Demo app",
		]);
	});

	test("keeps a blank line a formatter put between sections", () => {
		expect(textOutput(["doctor  ok", "", "• Bun"]).text.split("\n")).toHaveLength(3);
	});

	test("costs what it wrote, so a listing shows up in the breakdown like any other output", () => {
		expect(textOutput(["ok tap"]).tokens).toBeGreaterThan(0);
	});

	test("ignores the shaping options a listing has no use for", () => {
		// `--json`, `--pretty` and `--limit` all belong to other shapes: a command that has already
		// chosen to print for a human must not have its lines re-shaped underneath it.
		const out = textOutput(["ok tap", "resolved 10,20"], { json: true, pretty: true, limit: 1 });

		expect(out.text).toBe("ok tap\nresolved 10,20");
		expect(out.omitted).toBe(0);
	});
});

describe("a document a command writes to stdout", () => {
	const documentOutput = (text: string) => formatAgentOutput({ kind: "document", text });

	test("is the text exactly as it came, terminator and all", () => {
		// A Case Script file ends in one newline; the shell form ends in none. Both are the file's
		// own bytes, so neither is a line the seam may terminate for it.
		expect(documentOutput("version: 1\nactions: []\n").text).toBe("version: 1\nactions: []\n");
		expect(documentOutput("#!/bin/sh\nyoqa action tap --label Open").text).toBe(
			"#!/bin/sh\nyoqa action tap --label Open",
		);
	});

	test("costs what it wrote, so an exported script shows up in the breakdown", () => {
		expect(documentOutput("version: 1\n").tokens).toBeGreaterThan(0);
	});
});
