import { describe, expect, test } from "bun:test";
import { DEFAULT_BENCHMARK_SUITE, parseBenchmarkSuite } from "./suite";

describe("parseBenchmarkSuite", () => {
	test("reads the versioned default shape", () => {
		expect(parseBenchmarkSuite(DEFAULT_BENCHMARK_SUITE)).toEqual(DEFAULT_BENCHMARK_SUITE);
	});

	test("rejects a suite with no taps", () => {
		expect(() => parseBenchmarkSuite({ version: 1, repeats: 3, taps: [] })).toThrow(/tap/);
	});

	test("defaults arms to vision and rejects unknown names", () => {
		expect(parseBenchmarkSuite({ version: 1, repeats: 1, taps: [{ x: 1, y: 1 }] }).arms).toEqual([
			"vision",
		]);
		expect(() =>
			parseBenchmarkSuite({ version: 1, repeats: 1, taps: [{ x: 1, y: 1 }], arms: ["hybrid"] }),
		).toThrow(/vision or tree/);
	});
});
