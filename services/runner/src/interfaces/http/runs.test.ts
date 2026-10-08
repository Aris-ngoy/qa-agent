import { describe, expect, test } from "bun:test";
import { parseByteRange } from "./runs";

describe("parseByteRange", () => {
	test("reads closed, open-ended and suffix ranges", () => {
		expect(parseByteRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
		expect(parseByteRange("bytes=900-", 1000)).toEqual({ start: 900, end: 999 });
		expect(parseByteRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
		expect(parseByteRange("bytes=0-5000", 1000)).toEqual({ start: 0, end: 999 });
	});

	test("ignores missing or malformed ranges and flags unsatisfiable ones", () => {
		expect(parseByteRange(undefined, 1000)).toBeNull();
		expect(parseByteRange("bytes=-", 1000)).toBeNull();
		expect(parseByteRange("bytes=-0", 1000)).toBe("unsatisfiable");
		expect(parseByteRange("bytes=2000-", 1000)).toBe("unsatisfiable");
		expect(parseByteRange("bytes=0-9", 0)).toBe("unsatisfiable");
	});
});
