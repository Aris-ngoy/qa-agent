import { describe, expect, test } from "bun:test";
import { DEFAULT_BENCHMARK_SUITE, parseBenchmarkSuite } from "./suite";

describe("parseBenchmarkSuite", () => {
	test("reads the versioned default shape", () => {
		expect(parseBenchmarkSuite(DEFAULT_BENCHMARK_SUITE)).toEqual(DEFAULT_BENCHMARK_SUITE);
	});

	test("rejects a suite with no taps", () => {
		expect(() => parseBenchmarkSuite({ version: 1, repeats: 3, taps: [] })).toThrow(/tap/);
	});
});
