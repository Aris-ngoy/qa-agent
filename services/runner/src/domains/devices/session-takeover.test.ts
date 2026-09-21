import { describe, expect, test } from "bun:test";
import { withDeviceInUseTakeover } from "./session";

describe("withDeviceInUseTakeover", () => {
	test("passes through on Argent (no named sessions to steal)", async () => {
		const result = await withDeviceInUseTakeover(async () => "opened");
		expect(result).toBe("opened");
	});
});
