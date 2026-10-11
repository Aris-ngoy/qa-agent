import { describe, expect, test } from "bun:test";
import { createSidebarStore } from "./sidebar-store";

function memoryStorage(initial: Record<string, string> = {}) {
	const items = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => {
			items.set(key, value);
		},
	};
}

describe("sidebar store", () => {
	test("starts expanded when nothing is stored", () => {
		expect(createSidebarStore(memoryStorage()).get()).toBe(false);
	});

	test("starts collapsed when the stored state is collapsed", () => {
		const storage = memoryStorage({ "yoqa.sidebarCollapsed": "true" });
		expect(createSidebarStore(storage).get()).toBe(true);
	});

	test("toggle flips the state and notifies subscribers", () => {
		const store = createSidebarStore(memoryStorage());
		let calls = 0;
		store.subscribe(() => {
			calls += 1;
		});
		store.toggle();
		expect(store.get()).toBe(true);
		store.toggle();
		expect(store.get()).toBe(false);
		expect(calls).toBe(2);
	});

	test("the state survives a relaunch", () => {
		const storage = memoryStorage();
		createSidebarStore(storage).toggle();
		expect(createSidebarStore(storage).get()).toBe(true);
	});

	test("an unsubscribed listener is not notified", () => {
		const store = createSidebarStore(memoryStorage());
		let calls = 0;
		const unsubscribe = store.subscribe(() => {
			calls += 1;
		});
		unsubscribe();
		store.toggle();
		expect(calls).toBe(0);
	});
});
