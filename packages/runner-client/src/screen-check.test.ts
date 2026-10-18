import { describe, expect, test } from "bun:test";
import type { ScreenElement } from "./schemas";
import { type CheckScreenOptions, checkScreen } from "./screen-check";

function element(label: string): ScreenElement {
	return { label, type: "Button", x: 0, y: 0, width: 10, height: 10 } as ScreenElement;
}

/** A Screen that answers each read with the next entry (a string list, or an error to throw). */
function fakeScreen(reads: Array<string[] | Error>) {
	let clock = 0;
	let count = 0;
	const sleeps: number[] = [];
	return {
		reads: () => count,
		sleeps,
		options: (
			overrides: Partial<CheckScreenOptions> = {},
		): Omit<CheckScreenOptions, "text" | "assertion" | "timeoutMs"> => ({
			readScreen: async () => {
				const read = reads[Math.min(count, reads.length - 1)] ?? [];
				count += 1;
				if (read instanceof Error) throw read;
				return { elements: read.map(element) };
			},
			sleep: async (ms) => {
				sleeps.push(ms);
				clock += ms;
			},
			now: () => clock,
			...overrides,
		}),
	};
}

class DeadSession extends Error {}

describe("checkScreen", () => {
	test("is met at once when the text is already on the Screen", async () => {
		const screen = fakeScreen([["Welcome back"]]);
		const result = await checkScreen({
			...screen.options(),
			text: "welcome",
			assertion: "visible",
			timeoutMs: 1_000,
		});
		expect(result).toEqual({ met: true });
		expect(screen.reads()).toBe(1);
		expect(screen.sleeps).toEqual([]);
	});

	test("polls until the text appears", async () => {
		const screen = fakeScreen([[], [], ["Welcome back"]]);
		const result = await checkScreen({
			...screen.options({ pollMs: 100 }),
			text: "Welcome",
			assertion: "visible",
			timeoutMs: 5_000,
		});
		expect(result).toEqual({ met: true });
		expect(screen.sleeps).toEqual([100, 100]);
	});

	test("polls every 400ms by default", async () => {
		const screen = fakeScreen([[], ["Home"]]);
		await checkScreen({
			...screen.options(),
			text: "Home",
			assertion: "visible",
			timeoutMs: 1_000,
		});
		expect(screen.sleeps).toEqual([400]);
	});

	test("is met for not-visible once the text is gone", async () => {
		const screen = fakeScreen([["Loading"], ["Loading"], ["Home"]]);
		const result = await checkScreen({
			...screen.options(),
			text: "Loading",
			assertion: "not-visible",
			timeoutMs: 5_000,
		});
		expect(result).toEqual({ met: true });
		expect(screen.reads()).toBe(3);
	});

	test("is not met when the deadline passes, after one last read", async () => {
		const screen = fakeScreen([["Error"]]);
		const result = await checkScreen({
			...screen.options(),
			text: "Error",
			assertion: "not-visible",
			timeoutMs: 1_000,
		});
		expect(result).toEqual({ met: false });
		expect(screen.reads()).toBe(4);
	});

	test("reads once with a zero timeout", async () => {
		const screen = fakeScreen([[]]);
		const result = await checkScreen({
			...screen.options(),
			text: "Home",
			assertion: "visible",
			timeoutMs: 0,
		});
		expect(result).toEqual({ met: false });
		expect(screen.reads()).toBe(1);
	});

	test("keeps polling through failed Screen reads", async () => {
		const screen = fakeScreen([
			new Error("no frontmost app"),
			new Error("no frontmost app"),
			["Home"],
		]);
		const result = await checkScreen({
			...screen.options(),
			text: "Home",
			assertion: "visible",
			timeoutMs: 5_000,
		});
		expect(result).toEqual({ met: true });
		expect(screen.reads()).toBe(3);
	});

	test("fails with the read error when the last read at the deadline still failed", async () => {
		const screen = fakeScreen([[], new Error("no frontmost app")]);
		await expect(
			checkScreen({ ...screen.options(), text: "Home", assertion: "visible", timeoutMs: 1_000 }),
		).rejects.toThrow("Could not read the screen within 1s: no frontmost app");
	});

	test("a failed read is not met for not-visible either", async () => {
		const screen = fakeScreen([new Error("no frontmost app"), []]);
		const result = await checkScreen({
			...screen.options(),
			text: "Error",
			assertion: "not-visible",
			timeoutMs: 1_000,
		});
		expect(result).toEqual({ met: true });
		expect(screen.reads()).toBe(2);
	});

	test("ends at once on a Dead Session", async () => {
		const screen = fakeScreen([new DeadSession("Device session ended")]);
		await expect(
			checkScreen({
				...screen.options({ isDeadSession: (error) => error instanceof DeadSession }),
				text: "Home",
				assertion: "visible",
				timeoutMs: 5_000,
			}),
		).rejects.toBeInstanceOf(DeadSession);
		expect(screen.reads()).toBe(1);
	});

	test("stops with an AbortError once aborted", async () => {
		const screen = fakeScreen([[]]);
		let aborted = false;
		const check = checkScreen({
			...screen.options({
				sleep: async () => {
					aborted = true;
				},
				isAborted: () => aborted,
			}),
			text: "Home",
			assertion: "visible",
			timeoutMs: 5_000,
		});
		await expect(check).rejects.toMatchObject({ name: "AbortError", message: "Aborted" });
		expect(screen.reads()).toBe(1);
	});
});
