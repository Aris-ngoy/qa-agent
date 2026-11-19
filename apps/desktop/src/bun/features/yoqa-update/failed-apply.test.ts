import { describe, expect, test } from "bun:test";
import { type PendingYoqaApply, createFailedApplyTracker } from "./failed-apply";

/** A marker store held in memory, standing in for Yoqa's stored settings. */
function memoryStore(initial: PendingYoqaApply | null = null) {
	let saved = initial;
	return {
		read: async () => saved,
		write: async (next: PendingYoqaApply | null) => {
			saved = next;
		},
		saved: () => saved,
	};
}

describe("failed Yoqa update apply tracker", () => {
	test("reports the update when Yoqa relaunches on the hash it meant to replace", async () => {
		const store = memoryStore();
		const before = createFailedApplyTracker(store, async () => "old-hash");
		await before.beforeApply("1.0.9");

		const relaunched = createFailedApplyTracker(store, async () => "old-hash");
		expect(await relaunched.take()).toEqual({ version: "1.0.9" });
	});

	test("reports nothing when Yoqa relaunches on a new hash", async () => {
		const store = memoryStore();
		await createFailedApplyTracker(store, async () => "old-hash").beforeApply("1.0.9");

		const relaunched = createFailedApplyTracker(store, async () => "new-hash");
		expect(await relaunched.take()).toBeNull();
	});

	test("reports a failed apply only once", async () => {
		const store = memoryStore({ version: "1.0.9", fromHash: "old-hash" });
		const tracker = createFailedApplyTracker(store, async () => "old-hash");
		expect(await tracker.take()).toEqual({ version: "1.0.9" });
		expect(await tracker.take()).toBeNull();
		expect(store.saved()).toBeNull();
	});

	test("reports nothing when no apply was attempted", async () => {
		const tracker = createFailedApplyTracker(memoryStore(), async () => "old-hash");
		expect(await tracker.take()).toBeNull();
	});

	test("forgets an apply that stopped before quitting, since Yoqa reported it already", async () => {
		const store = memoryStore();
		const tracker = createFailedApplyTracker(store, async () => "old-hash");
		await tracker.beforeApply("1.0.9");
		await tracker.applyStopped();

		const relaunched = createFailedApplyTracker(store, async () => "old-hash");
		expect(await relaunched.take()).toBeNull();
	});

	test("still applies when the marker can't be saved", async () => {
		const tracker = createFailedApplyTracker(
			{
				read: async () => null,
				write: async () => {
					throw new Error("EACCES");
				},
			},
			async () => "old-hash",
		);
		await tracker.beforeApply("1.0.9");
		expect(await tracker.take()).toBeNull();
	});
});
