import { describe, expect, test } from "bun:test";
import { remember } from "./once";

describe("remember", () => {
	test("the second call does not hit the fetcher", async () => {
		let calls = 0;
		const get = remember(async () => {
			calls += 1;
			return { width: 390, height: 844 };
		});
		expect(await get()).toEqual({ width: 390, height: 844 });
		expect(await get()).toEqual({ width: 390, height: 844 });
		expect(calls).toBe(1);
	});

	test("a failed fetch is not cached", async () => {
		let calls = 0;
		const get = remember(async () => {
			calls += 1;
			if (calls === 1) throw new Error("window busy");
			return { width: 1, height: 2 };
		});
		await expect(get()).rejects.toThrow("window busy");
		expect(await get()).toEqual({ width: 1, height: 2 });
		expect(calls).toBe(2);
	});
});
