/**
 * The CLI's one Agent output seam. Everything `yoqa` writes to stdout for a calling agent is
 * shaped here, so these tests are the contract for what lands in that agent's context window.
 * Pure: no runner, no device, no clock.
 */

import { describe, expect, test } from "bun:test";
import { MAX_SCREEN_ROWS, type ScreenResponse } from "@yoqa/runner-client";
import { formatAgentOutput, parseScreenLimit } from "./agent-output";

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

	test("says nothing at all for an empty tree", () => {
		expect(screenOutput(cleanedScreen(0))).toEqual({ text: "", omitted: 0 });
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
