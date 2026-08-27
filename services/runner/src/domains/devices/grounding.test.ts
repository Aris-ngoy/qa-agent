import { describe, expect, test } from "bun:test";
import { parseGroundResult } from "./grounding";

describe("parseGroundResult", () => {
	test("clamps out-of-range grounding coords", () => {
		expect(parseGroundResult({ x: 500, y: 1006 })).toEqual({ x: 500, y: 1000 });
		expect(parseGroundResult({ x: -1, y: 10 })).toEqual({ x: 0, y: 10 });
	});
});
