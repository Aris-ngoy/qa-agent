import { describe, expect, test } from "bun:test";
import type { YoqaUpdateStatus } from "../../../shared/yoqa-update";
import {
	type YoqaUpdateCheck,
	type YoqaUpdateTimer,
	type YoqaUpdater,
	createYoqaUpdateController,
} from "./controller";

/** A timer whose clock only moves when a test calls `advance`. */
function fakeTimer() {
	let clock = 0;
	let nextId = 1;
	const pending = new Map<number, { at: number; callback: () => void }>();
	const timer: YoqaUpdateTimer = {
		setTimeout: (callback, ms) => {
			const id = nextId++;
			pending.set(id, { at: clock + ms, callback });
			return id;
		},
		clearTimeout: (handle) => {
			pending.delete(handle as number);
		},
	};
	return {
		timer,
		now: () => 1_700_000_000_000 + clock,
		/** Move the clock forward, run every timer that came due, and let their promises settle. */
		async advance(ms: number) {
			clock += ms;
			for (const [id, entry] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
				if (entry.at > clock) continue;
				pending.delete(id);
				entry.callback();
			}
			await settle();
		},
	};
}

async function settle() {
	for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** An `updater` that answers from a script and records every call. */
function fakeUpdater(script: {
	check?: () => Promise<YoqaUpdateCheck>;
	download?: () => Promise<void>;
	apply?: () => Promise<void>;
}) {
	const calls: string[] = [];
	const updater: YoqaUpdater = {
		check: async () => {
			calls.push("check");
			return script.check ? script.check() : { updateAvailable: false, version: "1.0.8" };
		},
		download: async () => {
			calls.push("download");
			return script.download?.();
		},
		apply: async () => {
			calls.push("apply");
			return script.apply?.();
		},
	};
	return { updater, calls };
}

const newer = (version: string): YoqaUpdateCheck => ({ updateAvailable: true, version });

function setup(script: Parameters<typeof fakeUpdater>[0] = {}, options: { channel?: string } = {}) {
	const clock = fakeTimer();
	const { updater, calls } = fakeUpdater(script);
	const pushed: YoqaUpdateStatus[] = [];
	const controller = createYoqaUpdateController({
		updater,
		channel: options.channel ?? "stable",
		timer: clock.timer,
		now: clock.now,
		onStatus: (status) => pushed.push(status),
	});
	return {
		controller,
		calls,
		pushed,
		clock,
		last: () => pushed.at(-1),
		states: () => pushed.map((status) => status.state),
	};
}

describe("Yoqa update controller", () => {
	test("checks for a Yoqa update shortly after launch", async () => {
		const { controller, calls, clock } = setup();
		controller.start();
		expect(calls).toEqual([]);
		await clock.advance(60_000);
		expect(calls).toEqual(["check"]);
	});

	test("downloads a newer Yoqa update and reports it ready with its version", async () => {
		const { controller, calls, states, last } = setup({ check: async () => newer("1.0.9") });
		await controller.checkNow();
		expect(calls).toEqual(["check", "download"]);
		expect(states()).toEqual(["checking", "downloading", "ready"]);
		expect(last()).toMatchObject({ state: "ready", version: "1.0.9", lastError: null });
	});

	test("goes back to idle with the check time when Yoqa is up to date", async () => {
		const { controller, calls, last, clock } = setup();
		await clock.advance(42_000);
		await controller.checkNow();
		expect(calls).toEqual(["check"]);
		expect(last()).toEqual({
			state: "idle",
			version: null,
			lastCheckedAt: 1_700_000_042_000,
			lastError: null,
			restartHeld: false,
		});
	});

	test("records a failed check as the last error and goes back to idle", async () => {
		const { controller, last, clock } = setup({
			check: async () => {
				throw new Error("Failed to fetch update info");
			},
		});
		await clock.advance(5_000);
		await controller.checkNow();
		expect(last()).toMatchObject({
			state: "idle",
			version: null,
			lastCheckedAt: 1_700_000_005_000,
			lastError: "Failed to fetch update info",
		});
	});

	test("records a failed download as the last error and goes back to idle", async () => {
		const { controller, last } = setup({
			check: async () => newer("1.0.9"),
			download: async () => {
				throw new Error("Failed to download latest version");
			},
		});
		await controller.checkNow();
		expect(last()).toMatchObject({
			state: "idle",
			version: null,
			lastError: "Failed to download latest version",
		});
		expect(last()?.lastCheckedAt).not.toBeNull();
	});

	test("keeps a ready Yoqa update when a later check fails", async () => {
		let online = true;
		const { controller, last } = setup({
			check: async () => {
				if (!online) throw new Error("Failed to fetch update info");
				return newer("1.0.9");
			},
		});
		await controller.checkNow();
		online = false;
		await controller.checkNow();
		expect(last()).toMatchObject({
			state: "ready",
			version: "1.0.9",
			lastError: "Failed to fetch update info",
		});
	});

	test("keeps a ready Yoqa update when downloading a newer one fails", async () => {
		let latest = "1.0.9";
		const { controller, last } = setup({
			check: async () => newer(latest),
			download: async () => {
				if (latest !== "1.0.9") throw new Error("Failed to download latest version");
			},
		});
		await controller.checkNow();
		latest = "1.0.10";
		await controller.checkNow();
		expect(last()).toMatchObject({
			state: "ready",
			version: "1.0.9",
			lastError: "Failed to download latest version",
		});
	});

	test("drops a ready Yoqa update once a check says Yoqa is up to date", async () => {
		let released = true;
		const { controller, last } = setup({
			check: async () => (released ? newer("1.0.9") : { updateAvailable: false, version: "1.0.8" }),
		});
		await controller.checkNow();
		released = false;
		await controller.checkNow();
		expect(last()).toMatchObject({ state: "idle", version: null, lastError: null });
	});

	test("restart applies a ready Yoqa update exactly once", async () => {
		const { controller, calls } = setup({
			check: async () => newer("1.0.9"),
			// A real apply quits Yoqa; this one never finishes, like the app going away.
			apply: () => new Promise(() => {}),
		});
		await controller.checkNow();
		void controller.restart();
		void controller.restart();
		await settle();
		expect(calls.filter((call) => call === "apply")).toHaveLength(1);
	});

	test("never applies a Yoqa update on its own", async () => {
		const { controller, calls, clock, last } = setup({ check: async () => newer("1.0.9") });
		controller.start();
		await clock.advance(7 * 24 * 60 * 60 * 1000);
		await controller.checkNow();
		expect(last()?.state).toBe("ready");
		expect(calls).not.toContain("apply");
	});

	test("restart does nothing until a Yoqa update is ready", async () => {
		const { controller, calls } = setup();
		await controller.restart();
		await controller.checkNow();
		await controller.restart();
		expect(calls).toEqual(["check"]);
	});

	test("records a failed apply as the last error and keeps the update ready to retry", async () => {
		let attempts = 0;
		const { controller, calls, last } = setup({
			check: async () => newer("1.0.9"),
			apply: async () => {
				attempts++;
				if (attempts === 1) throw new Error("Failed to replace app");
			},
		});
		await controller.checkNow();
		await controller.restart();
		expect(last()).toMatchObject({
			state: "ready",
			version: "1.0.9",
			lastError: "Failed to replace app",
		});
		await controller.restart();
		expect(calls.filter((call) => call === "apply")).toHaveLength(2);
	});

	test("never checks on Electrobun's dev channel", async () => {
		const { controller, calls, clock, pushed } = setup(
			{ check: async () => newer("1.0.9") },
			{ channel: "dev" },
		);
		controller.start();
		await clock.advance(24 * 60 * 60 * 1000);
		await controller.checkNow();
		expect(calls).toEqual([]);
		expect(pushed).toEqual([]);
		expect(controller.status().state).toBe("idle");
	});

	test("a check pressed while one is running joins it instead of starting another", async () => {
		let finishDownload = () => {};
		const { controller, calls, last } = setup({
			check: async () => newer("1.0.9"),
			download: () =>
				new Promise<void>((resolve) => {
					finishDownload = resolve;
				}),
		});
		const first = controller.checkNow();
		const second = controller.checkNow();
		await settle();
		finishDownload();
		await Promise.all([first, second]);
		expect(calls).toEqual(["check", "download"]);
		expect(last()?.state).toBe("ready");
	});
});
