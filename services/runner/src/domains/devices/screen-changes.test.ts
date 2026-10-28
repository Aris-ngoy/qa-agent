import { describe, expect, test } from "bun:test";
import { debounceScreenChanges } from "./screen-changes";

describe("debounceScreenChanges", () => {
	test("a burst of changes is one signal, once the page goes quiet", async () => {
		let signals = 0;
		const changes = debounceScreenChanges(
			() => {
				signals += 1;
			},
			{ quietMs: 30, maxWaitMs: 1000 },
		);
		changes.changed();
		await Bun.sleep(10);
		changes.changed();
		await Bun.sleep(10);
		changes.changed();
		expect(signals).toBe(0);
		await Bun.sleep(60);
		expect(signals).toBe(1);
		changes.stop();
	});

	test("a page that never goes quiet still signals about every maxWaitMs", async () => {
		let signals = 0;
		const changes = debounceScreenChanges(
			() => {
				signals += 1;
			},
			{ quietMs: 30, maxWaitMs: 60 },
		);
		const started = performance.now();
		while (performance.now() - started < 200) {
			changes.changed();
			await Bun.sleep(10);
		}
		expect(signals).toBeGreaterThanOrEqual(2);
		changes.stop();
	});

	test("no change, no signal; and nothing after stop", async () => {
		let signals = 0;
		const changes = debounceScreenChanges(
			() => {
				signals += 1;
			},
			{ quietMs: 10, maxWaitMs: 50 },
		);
		await Bun.sleep(30);
		expect(signals).toBe(0);
		changes.changed();
		changes.stop();
		await Bun.sleep(30);
		expect(signals).toBe(0);
		changes.changed();
		await Bun.sleep(30);
		expect(signals).toBe(0);
	});
});
